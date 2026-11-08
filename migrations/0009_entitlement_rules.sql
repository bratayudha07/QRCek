-- 0009_entitlement_rules.sql — entitlement rules for the QRCek target model.
--
-- Q3 (ADR-0016, D-005). Additive on `0001`–`0008`; no earlier migration is
-- edited. `schema_version` becomes `9`.
--
-- Shape decisions:
--   * One normalised table. The entitlement level is derived from which context
--     and subject columns are filled, not stored as a separate enum:
--       Individual–Session, Category–Session, Individual–Activity,
--       Category–Activity, Theme default.
--   * SQLite treats NULLs as distinct in a unique index, so every level gets a
--     partial unique index whose predicate is repeated by `ON CONFLICT` in the
--     data layer (docs/OPERASIONAL.md §4.1).
--   * Default is deny when no rule decides. That is a resolver rule, not a row.
--   * Rules never copy or mutate transactions; history is resolved at write time
--     by Q5 (FR-199, BR-075, AC-043).
--
-- Status values are lowercase English; time is UTC milliseconds everywhere.

-- ───────────────────────────────────────────── entitlement_rules
CREATE TABLE entitlement_rules (
  id             TEXT PRIMARY KEY,
  theme_id       TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  activity_id    TEXT REFERENCES activities(id) ON DELETE RESTRICT,
  session_id     TEXT REFERENCES activity_sessions(id) ON DELETE RESTRICT,
  participant_id TEXT REFERENCES participants(id) ON DELETE RESTRICT,
  category_id    TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  status         TEXT NOT NULL CHECK (status IN ('inherit','allowed','denied')),
  created_at     INTEGER NOT NULL,
  created_by     TEXT REFERENCES users(id),
  updated_at     INTEGER NOT NULL,
  updated_by     TEXT REFERENCES users(id),
  CHECK (created_at > 0),
  CHECK (updated_at >= created_at),
  CHECK (session_id IS NULL OR activity_id IS NOT NULL),
  CHECK (
    (activity_id IS NULL AND session_id IS NULL
     AND participant_id IS NULL AND category_id IS NULL)          -- Theme default
    OR
    (activity_id IS NOT NULL
     AND ((participant_id IS NOT NULL) <> (category_id IS NOT NULL)))  -- level 1–4
  )
);

-- ───────────────────────────────────────────── partial unique indexes
-- One cell per level. The resolver query in `apps/api/src/db/entitlement-rules.ts`
-- uses the same predicates, so each UNION ALL branch is an index SEARCH.
CREATE UNIQUE INDEX uq_ent_theme_default
  ON entitlement_rules(theme_id)
  WHERE activity_id IS NULL AND session_id IS NULL
    AND participant_id IS NULL AND category_id IS NULL;

CREATE UNIQUE INDEX uq_ent_individual_activity
  ON entitlement_rules(theme_id, participant_id, activity_id)
  WHERE participant_id IS NOT NULL AND activity_id IS NOT NULL AND session_id IS NULL;

CREATE UNIQUE INDEX uq_ent_category_activity
  ON entitlement_rules(theme_id, category_id, activity_id)
  WHERE category_id IS NOT NULL AND activity_id IS NOT NULL AND session_id IS NULL;

CREATE UNIQUE INDEX uq_ent_individual_session
  ON entitlement_rules(theme_id, participant_id, activity_id, session_id)
  WHERE participant_id IS NOT NULL AND activity_id IS NOT NULL AND session_id IS NOT NULL;

CREATE UNIQUE INDEX uq_ent_category_session
  ON entitlement_rules(theme_id, category_id, activity_id, session_id)
  WHERE category_id IS NOT NULL AND activity_id IS NOT NULL AND session_id IS NOT NULL;

-- ───────────────────────────────────────────── cross-context triggers
-- The Worker validates the same rules before writing so the admin gets a clear
-- message; these triggers are the last line of defence and cover direct SQL.
CREATE TRIGGER trg_entitlement_context_insert
BEFORE INSERT ON entitlement_rules
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'category does not belong to this theme')
   WHERE NEW.category_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM categories c
        WHERE c.id = NEW.category_id AND c.theme_id = NEW.theme_id
     );

  SELECT RAISE(ABORT, 'participant does not belong to this theme')
   WHERE NEW.participant_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM participants p
        WHERE p.id = NEW.participant_id AND p.event_id = NEW.theme_id
     );

  SELECT RAISE(ABORT, 'activity does not belong to this theme')
   WHERE NEW.activity_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM activities a
        WHERE a.id = NEW.activity_id AND a.theme_id = NEW.theme_id
     );

  SELECT RAISE(ABORT, 'session does not belong to this activity')
   WHERE NEW.session_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM activity_sessions s
        WHERE s.id = NEW.session_id AND s.activity_id = NEW.activity_id
     );

  SELECT RAISE(ABORT, 'theme default must not have an activity, session, participant, or category')
   WHERE NEW.activity_id IS NULL
     AND (NEW.session_id IS NOT NULL OR NEW.participant_id IS NOT NULL
          OR NEW.category_id IS NOT NULL);

  SELECT RAISE(ABORT, 'activity rule needs exactly one subject: participant or category')
   WHERE NEW.activity_id IS NOT NULL
     AND ((NEW.participant_id IS NOT NULL) = (NEW.category_id IS NOT NULL));
END;

CREATE TRIGGER trg_entitlement_context_update
BEFORE UPDATE OF theme_id, activity_id, session_id, participant_id, category_id
ON entitlement_rules
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'category does not belong to this theme')
   WHERE NEW.category_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM categories c
        WHERE c.id = NEW.category_id AND c.theme_id = NEW.theme_id
     );

  SELECT RAISE(ABORT, 'participant does not belong to this theme')
   WHERE NEW.participant_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM participants p
        WHERE p.id = NEW.participant_id AND p.event_id = NEW.theme_id
     );

  SELECT RAISE(ABORT, 'activity does not belong to this theme')
   WHERE NEW.activity_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM activities a
        WHERE a.id = NEW.activity_id AND a.theme_id = NEW.theme_id
     );

  SELECT RAISE(ABORT, 'session does not belong to this activity')
   WHERE NEW.session_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM activity_sessions s
        WHERE s.id = NEW.session_id AND s.activity_id = NEW.activity_id
     );

  SELECT RAISE(ABORT, 'theme default must not have an activity, session, participant, or category')
   WHERE NEW.activity_id IS NULL
     AND (NEW.session_id IS NOT NULL OR NEW.participant_id IS NOT NULL
          OR NEW.category_id IS NOT NULL);

  SELECT RAISE(ABORT, 'activity rule needs exactly one subject: participant or category')
   WHERE NEW.activity_id IS NOT NULL
     AND ((NEW.participant_id IS NOT NULL) = (NEW.category_id IS NOT NULL));
END;

-- ───────────────────────────────────────────── backfill Aktivitas lama
-- Approved migration exception (FR-040/FR-041, ADR-0016): every existing
-- Aktivitas × kategori becomes an explicit `allowed` category–activity row, so
-- turning the resolver on in Q5 does not change historical check-in behaviour.
--
-- Only `active` activities are backfilled; `draft` stays incomplete on purpose
-- so the `draft → active` gate remains meaningful. Archived categories that
-- still have participants are included (FR-020/FR-024); an archived category
-- with no participants can never have a valid old transaction.
--
-- No audit row is written: this is a migration, not an admin action.
-- >>> backfill
INSERT INTO entitlement_rules (
  id, theme_id, activity_id, session_id, participant_id, category_id,
  status, created_at, created_by, updated_at, updated_by
)
SELECT
  lower(hex(randomblob(16))),
  a.theme_id, a.id, NULL, NULL, c.id,
  'allowed',
  CAST(strftime('%s','now') AS INTEGER) * 1000, NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000, NULL
FROM activities a
JOIN categories c ON c.theme_id = a.theme_id
WHERE a.status = 'active'
  AND (
    c.status = 'active'
    OR EXISTS (SELECT 1 FROM participants p WHERE p.category_id = c.id)
  )
  AND NOT EXISTS (
    SELECT 1 FROM entitlement_rules r
     WHERE r.theme_id = a.theme_id
       AND r.activity_id = a.id
       AND r.category_id = c.id
       AND r.session_id IS NULL
       AND r.participant_id IS NULL
  );
-- <<< backfill

-- ───────────────────────────────────────────── housekeeping marker
UPDATE app_meta
   SET value = '9',
       updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE key = 'schema_version';
