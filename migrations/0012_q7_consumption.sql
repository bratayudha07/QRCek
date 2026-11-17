-- 0012_q7_consumption.sql — consumption quotas (Q7, D-009, D-014, BR-044, BR-073).
--
-- Additive on `0001`–`0011`; no earlier migration is edited. `schema_version`
-- becomes `12`.
--
-- Shape decisions:
--   * Quota is per Aktivitas per peserta and counts every effective Consumption
--     transaction of that Aktivitas, across its Sesi (A1). A Sesi never resets
--     the quota.
--   * `activities.quota` is the default (A3: `1` for a new `consumption`
--     Aktivitas). `consumption_quotas` holds optional category/participant
--     overrides; the resolver is individual → category → Aktivitas.
--   * An `attendance` Aktivitas has no quota (`quota IS NULL`), enforced by
--     trigger so the two concepts cannot be mixed.
--   * The ceiling is enforced by a BEFORE INSERT trigger on `transactions`, not
--     by the Worker, so two parallel requests cannot both pass (T-120, BR-044).
--     `slot_no` stays Worker-computed and is protected by the Q5 partial unique
--     indexes.
--   * Reversal/Adjustment leave the effective set, so a reversed Consumption
--     frees both its slot and its quota (BR-073). Adjustments keep `slot_no` and
--     are exempt from the ceiling (A6); they never add usage.
--   * Quota changes are future-only (A2, D-005): nothing here rewrites history.
--   * No backfill: production has no `consumption` Aktivitas yet.
--
-- Time is UTC milliseconds everywhere.

-- ───────────────────────────────────────────── activities.quota
ALTER TABLE activities ADD COLUMN quota INTEGER;

-- Defensive backfill: a Consumption Aktivitas created before Q7 would otherwise
-- carry `NULL`, which the ceiling trigger reads as "no limit". Production has no
-- such Aktivitas yet; the statement keeps local and seeded databases honest.
UPDATE activities
   SET quota = 1
 WHERE transaction_type = 'consumption' AND quota IS NULL;

-- `attendance` and `consumption` must not drift into each other: the type
-- decides whether a quota is meaningful at all (D-009).
CREATE TRIGGER trg_activity_quota_insert
BEFORE INSERT ON activities
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'attendance activity must not have a quota')
   WHERE NEW.transaction_type = 'attendance' AND NEW.quota IS NOT NULL;

  SELECT RAISE(ABORT, 'consumption activity requires a quota')
   WHERE NEW.transaction_type = 'consumption' AND NEW.quota IS NULL;

  SELECT RAISE(ABORT, 'quota must not be negative')
   WHERE NEW.quota IS NOT NULL AND NEW.quota < 0;
END;

CREATE TRIGGER trg_activity_quota_update
BEFORE UPDATE OF transaction_type, quota ON activities
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'attendance activity must not have a quota')
   WHERE NEW.transaction_type = 'attendance' AND NEW.quota IS NOT NULL;

  SELECT RAISE(ABORT, 'consumption activity requires a quota')
   WHERE NEW.transaction_type = 'consumption' AND NEW.quota IS NULL;

  SELECT RAISE(ABORT, 'quota must not be negative')
   WHERE NEW.quota IS NOT NULL AND NEW.quota < 0;
END;

-- ───────────────────────────────────────────── consumption_quotas
-- One row per override cell, following the `entitlement_rules` pattern: the
-- level is derived from which subject column is filled, not stored separately.
CREATE TABLE consumption_quotas (
  id             TEXT PRIMARY KEY,
  theme_id       TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  activity_id    TEXT NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
  category_id    TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  participant_id TEXT REFERENCES participants(id) ON DELETE RESTRICT,
  quota          INTEGER NOT NULL CHECK (quota >= 0),
  created_at     INTEGER NOT NULL,
  created_by     TEXT REFERENCES users(id) ON DELETE RESTRICT,
  updated_at     INTEGER NOT NULL,
  updated_by     TEXT REFERENCES users(id) ON DELETE RESTRICT,
  CHECK (created_at > 0),
  CHECK (updated_at >= created_at),
  CHECK ((category_id IS NULL) <> (participant_id IS NULL))
);

-- `NULL` is distinct in a SQLite unique index, so each level gets its own
-- partial index whose predicate the data layer repeats in `ON CONFLICT`.
CREATE UNIQUE INDEX uq_consumption_quota_category
  ON consumption_quotas(theme_id, activity_id, category_id)
  WHERE participant_id IS NULL;

CREATE UNIQUE INDEX uq_consumption_quota_participant
  ON consumption_quotas(theme_id, activity_id, participant_id)
  WHERE category_id IS NULL;

CREATE INDEX idx_consumption_quotas_activity
  ON consumption_quotas(theme_id, activity_id, category_id, participant_id);

-- ───────────────────────────────────────────── cross-context triggers
CREATE TRIGGER trg_consumption_quota_context_insert
BEFORE INSERT ON consumption_quotas
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'activity does not belong to this theme')
   WHERE NOT EXISTS (
     SELECT 1 FROM activities a
      WHERE a.id = NEW.activity_id AND a.theme_id = NEW.theme_id
   );

  SELECT RAISE(ABORT, 'activity is not a consumption activity')
   WHERE NOT EXISTS (
     SELECT 1 FROM activities a
      WHERE a.id = NEW.activity_id AND a.transaction_type = 'consumption'
   );

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
END;

CREATE TRIGGER trg_consumption_quota_context_update
BEFORE UPDATE OF theme_id, activity_id, category_id, participant_id
ON consumption_quotas
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'activity does not belong to this theme')
   WHERE NOT EXISTS (
     SELECT 1 FROM activities a
      WHERE a.id = NEW.activity_id AND a.theme_id = NEW.theme_id
   );

  SELECT RAISE(ABORT, 'activity is not a consumption activity')
   WHERE NOT EXISTS (
     SELECT 1 FROM activities a
      WHERE a.id = NEW.activity_id AND a.transaction_type = 'consumption'
   );

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
END;

-- ───────────────────────────────────────────── quota read path
-- The quota check counts every effective Consumption row of one participant in
-- one Aktivitas (all Sesi). This partial index makes that count a covering
-- SEARCH instead of a scan of the participant's history.
CREATE INDEX idx_tx_consumption_effective
  ON transactions(theme_id, participant_id, activity_id, session_id)
  WHERE type = 'consumption'
    AND reversed_at IS NULL
    AND superseded_at IS NULL;

-- ───────────────────────────────────────────── quota ceiling
-- New Consumption transactions only (`adjusts_transaction_id IS NULL`). The
-- count predicate is exactly the effective predicate of the Q5 partial unique
-- indexes, so a Reversal frees quota and an Adjustment never consumes it.
CREATE TRIGGER trg_transaction_consumption_quota
BEFORE INSERT ON transactions
FOR EACH ROW
WHEN NEW.type = 'consumption' AND NEW.adjusts_transaction_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'consumption quota exhausted')
   WHERE (
     SELECT COUNT(*)
       FROM transactions t
      WHERE t.theme_id = NEW.theme_id
        AND t.participant_id = NEW.participant_id
        AND t.activity_id = NEW.activity_id
        AND t.type = 'consumption'
        AND t.reversed_at IS NULL
        AND t.superseded_at IS NULL
   ) >= COALESCE(
     (SELECT q.quota FROM consumption_quotas q
       WHERE q.theme_id = NEW.theme_id
         AND q.activity_id = NEW.activity_id
         AND q.participant_id = NEW.participant_id),
     (SELECT q.quota FROM consumption_quotas q
       WHERE q.theme_id = NEW.theme_id
         AND q.activity_id = NEW.activity_id
         AND q.category_id = (
           SELECT p.category_id FROM participants p WHERE p.id = NEW.participant_id
         )),
     (SELECT a.quota FROM activities a WHERE a.id = NEW.activity_id)
   );
END;

-- ───────────────────────────────────────────── housekeeping marker
UPDATE app_meta
   SET value = '12',
       updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE key = 'schema_version';
