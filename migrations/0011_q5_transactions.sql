-- 0011_q5_transactions.sql — contextual transactions, corrections, and staff assignments.
--
-- Q5 (ADR-0018, ADR-0019, ADR-0020, ADR-0021). Additive on `0001`–`0010`; no
-- earlier migration is edited. `schema_version` becomes `11`.
--
-- Shape decisions:
--   * One `transactions` table carries both Attendance and Consumption; the
--     transaction type is fixed per Aktivitas and enforced by the context
--     trigger. `slot_no` is prepared for Q7 but quota is not enforced here.
--   * Reversal marks the original row (`reversed_at`/`reversed_by`) and writes a
--     `transaction_corrections` row. Adjustment supersedes the original and
--     inserts a new effective version. Neither ever overwrites history.
--   * Four partial unique indexes enforce one effective Attendance/Consumption
--     transaction per participant per scope (Aktivitas without Sesi, or Sesi).
--   * `staff_assignments` makes scanner authority context-based. Backfill keeps
--     existing officers working until Q6 can narrow assignments.
--   * The legacy `attendance` table and its `UNIQUE (event_id, participant_id)`
--     stay in place. Legacy rows are copied into `transactions` with the same
--     id; new writes never touch `attendance`.
--
-- Status values are lowercase English; time is UTC milliseconds everywhere.

-- ───────────────────────────────────────────── transactions
CREATE TABLE transactions (
  id                     TEXT PRIMARY KEY,
  theme_id               TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  activity_id            TEXT NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
  session_id             TEXT REFERENCES activity_sessions(id) ON DELETE RESTRICT,
  participant_id         TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  type                   TEXT NOT NULL CHECK (type IN ('attendance','consumption')),
  source                 TEXT NOT NULL CHECK (source IN ('qr_scan','manual')),
  status                 TEXT CHECK (status IN ('present','late','absent','excused')),
  occurred_at            INTEGER NOT NULL,
  device_ts              INTEGER,
  recorded_by            TEXT REFERENCES users(id) ON DELETE RESTRICT,
  note                   TEXT,
  slot_no                INTEGER,
  adjusts_transaction_id TEXT REFERENCES transactions(id) ON DELETE RESTRICT,
  reversed_at            INTEGER,
  reversed_by            TEXT REFERENCES users(id) ON DELETE RESTRICT,
  superseded_at          INTEGER,
  superseded_by          TEXT REFERENCES users(id) ON DELETE RESTRICT,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  CHECK ((type = 'attendance') = (status IS NOT NULL)),
  CHECK ((type = 'consumption') = (slot_no IS NOT NULL)),
  CHECK (occurred_at > 0),
  CHECK (created_at > 0),
  CHECK (updated_at >= created_at),
  CHECK ((reversed_at IS NULL) = (reversed_by IS NULL)),
  CHECK ((superseded_at IS NULL) = (superseded_by IS NULL)),
  CHECK (adjusts_transaction_id IS NULL OR adjusts_transaction_id <> id),
  CHECK (note IS NULL OR length(note) <= 500)
);

-- ───────────────────────────────────────────── transaction_corrections
CREATE TABLE transaction_corrections (
  id             TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  operation      TEXT NOT NULL CHECK (operation IN ('reversal','adjustment')),
  reason         TEXT NOT NULL,
  actor_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  before_json    TEXT,
  after_json     TEXT,
  created_at     INTEGER NOT NULL,
  CHECK (length(reason) BETWEEN 3 AND 500),
  CHECK (created_at > 0),
  CHECK ((operation = 'reversal') = (after_json IS NULL))
);

-- ───────────────────────────────────────────── effective uniqueness
-- `NULL` is distinct in SQLite, so each scope gets its own partial index.
-- Reversal/Adjustment remove a row from the predicate, freeing the slot.
CREATE UNIQUE INDEX uq_tx_attendance_activity
  ON transactions(theme_id, participant_id, activity_id)
  WHERE type = 'attendance'
    AND session_id IS NULL
    AND reversed_at IS NULL
    AND superseded_at IS NULL;

CREATE UNIQUE INDEX uq_tx_attendance_session
  ON transactions(theme_id, participant_id, activity_id, session_id)
  WHERE type = 'attendance'
    AND session_id IS NOT NULL
    AND reversed_at IS NULL
    AND superseded_at IS NULL;

CREATE UNIQUE INDEX uq_tx_consumption_activity
  ON transactions(theme_id, participant_id, activity_id, slot_no)
  WHERE type = 'consumption'
    AND session_id IS NULL
    AND reversed_at IS NULL
    AND superseded_at IS NULL;

CREATE UNIQUE INDEX uq_tx_consumption_session
  ON transactions(theme_id, participant_id, activity_id, session_id, slot_no)
  WHERE type = 'consumption'
    AND session_id IS NOT NULL
    AND reversed_at IS NULL
    AND superseded_at IS NULL;

-- Effective read path (dashboard, history, Sheets projection).
CREATE INDEX idx_tx_effective_activity
  ON transactions(theme_id, activity_id, session_id, occurred_at DESC)
  WHERE reversed_at IS NULL AND superseded_at IS NULL;

CREATE INDEX idx_tx_effective_participant
  ON transactions(theme_id, participant_id, occurred_at DESC)
  WHERE reversed_at IS NULL AND superseded_at IS NULL;

CREATE INDEX idx_tx_participant_history
  ON transactions(theme_id, participant_id, occurred_at DESC);

-- One Reversal per transaction; Adjustment may chain.
CREATE UNIQUE INDEX uq_txc_reversal
  ON transaction_corrections(transaction_id)
  WHERE operation = 'reversal';

CREATE INDEX idx_txc_transaction
  ON transaction_corrections(transaction_id, created_at);

-- ───────────────────────────────────────────── staff_assignments
CREATE TABLE staff_assignments (
  id                  TEXT PRIMARY KEY,
  theme_id            TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  activity_id         TEXT NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
  session_id          TEXT REFERENCES activity_sessions(id) ON DELETE RESTRICT,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  can_manual_check_in INTEGER NOT NULL DEFAULT 0
                      CHECK (can_manual_check_in IN (0, 1)),
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','revoked')),
  created_at          INTEGER NOT NULL,
  created_by          TEXT REFERENCES users(id) ON DELETE RESTRICT,
  updated_at          INTEGER NOT NULL,
  updated_by          TEXT REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at          INTEGER,
  CHECK (created_at > 0),
  CHECK (updated_at >= created_at),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX uq_assignment_activity
  ON staff_assignments(theme_id, activity_id, user_id)
  WHERE session_id IS NULL AND status = 'active';

CREATE UNIQUE INDEX uq_assignment_session
  ON staff_assignments(theme_id, activity_id, session_id, user_id)
  WHERE session_id IS NOT NULL AND status = 'active';

CREATE INDEX idx_assignment_user_theme
  ON staff_assignments(user_id, theme_id, status);

CREATE INDEX idx_assignment_activity_status
  ON staff_assignments(activity_id, session_id, status);

-- ───────────────────────────────────────────── default Aktivitas shim
-- Production had zero activities. Without a default, every scan would stop at
-- "no activity". One active Attendance Aktivitas is created per Tema that has
-- no Attendance Aktivitas yet (owner direction, ADR-0018).
INSERT INTO activities (
  id, theme_id, name, description, transaction_type, status, location,
  sort_order, created_at, created_by, updated_at, updated_by, archived_at
)
SELECT
  lower(hex(randomblob(16))),
  e.id,
  'Absensi',
  'Aktivitas absensi bawaan migrasi Q5',
  'attendance',
  'active',
  NULL,
  0,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  e.created_by,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  e.created_by,
  NULL
FROM events e
WHERE NOT EXISTS (
  SELECT 1 FROM activities a
   WHERE a.theme_id = e.id AND a.transaction_type = 'attendance'
);

-- Entitlement rules for every active Attendance Aktivitas, including the
-- defaults just created. This mirrors 0009 so fail-closed resolution does not
-- reject all existing participants after the model switch.
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
WHERE a.transaction_type = 'attendance'
  AND a.status = 'active'
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

-- Existing officers keep scanning the active Attendance activities of their
-- Tema. `can_manual_check_in = 0`: Q6 is where an admin opts in (ADR-0021).
INSERT INTO staff_assignments (
  id, theme_id, activity_id, session_id, user_id, can_manual_check_in,
  status, created_at, created_by, updated_at, updated_by, revoked_at
)
SELECT
  lower(hex(randomblob(16))),
  a.theme_id, a.id, NULL, m.user_id, 0,
  'active',
  CAST(strftime('%s','now') AS INTEGER) * 1000, NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000, NULL,
  NULL
FROM activities a
JOIN event_memberships m
  ON m.event_id = a.theme_id AND m.role = 'officer' AND m.status = 'active'
WHERE a.transaction_type = 'attendance'
  AND a.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM staff_assignments s
     WHERE s.theme_id = a.theme_id
       AND s.activity_id = a.id
       AND s.session_id IS NULL
       AND s.user_id = m.user_id
       AND s.status = 'active'
  );

-- ───────────────────────────────────────────── backfill legacy attendance
-- The legacy id is reused so existing links, tests, and the compatibility read
-- adapter stay stable. `recorded_by` may be NULL only for these historical rows.
INSERT INTO transactions (
  id, theme_id, activity_id, session_id, participant_id, type, source, status,
  occurred_at, device_ts, recorded_by, note, slot_no, adjusts_transaction_id,
  reversed_at, reversed_by, superseded_at, superseded_by, created_at, updated_at
)
SELECT
  a.id,
  a.event_id,
  target.id,
  NULL,
  a.participant_id,
  'attendance',
  CASE WHEN a.method = 'qr_scan' THEN 'qr_scan' ELSE 'manual' END,
  a.status,
  a.checked_in_at,
  NULL,
  a.recorded_by,
  a.note,
  NULL,
  NULL,
  NULL, NULL, NULL, NULL,
  a.created_at,
  a.updated_at
FROM attendance a
JOIN activities target
  ON target.id = (
    SELECT x.id FROM activities x
     WHERE x.theme_id = a.event_id AND x.transaction_type = 'attendance'
     ORDER BY x.sort_order, x.created_at, x.id
     LIMIT 1
  )
WHERE NOT EXISTS (SELECT 1 FROM transactions t WHERE t.id = a.id);

-- ───────────────────────────────────────────── context/lifecycle triggers
-- Created after the trusted backfill so historical rows are not rejected by the
-- lifecycle checks that apply to new transactions.
CREATE TRIGGER trg_transaction_context_insert
BEFORE INSERT ON transactions
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'activity does not belong to this theme')
   WHERE NOT EXISTS (
     SELECT 1 FROM activities a
      WHERE a.id = NEW.activity_id
        AND a.theme_id = NEW.theme_id
        AND a.transaction_type = NEW.type
   );

  SELECT RAISE(ABORT, 'participant does not belong to this theme')
   WHERE NOT EXISTS (
     SELECT 1 FROM participants p
      WHERE p.id = NEW.participant_id AND p.event_id = NEW.theme_id
   );

  SELECT RAISE(ABORT, 'session does not belong to this activity')
   WHERE NEW.session_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM activity_sessions s
        WHERE s.id = NEW.session_id AND s.activity_id = NEW.activity_id
     );

  SELECT RAISE(ABORT, 'session required for activity with sessions')
   WHERE NEW.session_id IS NULL
     AND EXISTS (
       SELECT 1 FROM activity_sessions s WHERE s.activity_id = NEW.activity_id
     );

  SELECT RAISE(ABORT, 'theme is archived')
   WHERE EXISTS (
     SELECT 1 FROM events e WHERE e.id = NEW.theme_id AND e.status = 'archived'
   );

  -- Adjustments may be recorded after an Aktivitas/Sesi finished; the context
  -- checks above still apply. New transactions obey the full lifecycle.
  SELECT RAISE(ABORT, 'theme not active')
   WHERE NEW.adjusts_transaction_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM events e WHERE e.id = NEW.theme_id AND e.status = 'active'
     );

  SELECT RAISE(ABORT, 'activity not active')
   WHERE NEW.adjusts_transaction_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM activities a
        WHERE a.id = NEW.activity_id AND a.status = 'active'
     );

  SELECT RAISE(ABORT, 'participant inactive')
   WHERE NEW.adjusts_transaction_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM participants p
        WHERE p.id = NEW.participant_id AND p.status = 'active'
     );

  SELECT RAISE(ABORT, 'session not in progress')
   WHERE NEW.adjusts_transaction_id IS NULL
     AND NEW.session_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM activity_sessions s
        WHERE s.id = NEW.session_id
          AND s.status = 'in_progress'
          AND s.archived_at IS NULL
     );
END;

CREATE TRIGGER trg_transaction_corrections_no_update
BEFORE UPDATE ON transaction_corrections
BEGIN SELECT RAISE(ABORT, 'transaction_corrections is append-only'); END;

CREATE TRIGGER trg_transaction_corrections_no_delete
BEFORE DELETE ON transaction_corrections
BEGIN SELECT RAISE(ABORT, 'transaction_corrections is append-only'); END;

CREATE TRIGGER trg_staff_assignment_context_insert
BEFORE INSERT ON staff_assignments
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'activity does not belong to this theme')
   WHERE NOT EXISTS (
     SELECT 1 FROM activities a
      WHERE a.id = NEW.activity_id AND a.theme_id = NEW.theme_id
   );

  SELECT RAISE(ABORT, 'session does not belong to this activity')
   WHERE NEW.session_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM activity_sessions s
        WHERE s.id = NEW.session_id AND s.activity_id = NEW.activity_id
     );

  SELECT RAISE(ABORT, 'user is not an active member of this theme')
   WHERE NOT EXISTS (
     SELECT 1 FROM event_memberships m
      WHERE m.event_id = NEW.theme_id
        AND m.user_id = NEW.user_id
        AND m.status = 'active'
   );
END;

CREATE TRIGGER trg_staff_assignment_context_update
BEFORE UPDATE OF theme_id, activity_id, session_id, user_id
ON staff_assignments
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'activity does not belong to this theme')
   WHERE NOT EXISTS (
     SELECT 1 FROM activities a
      WHERE a.id = NEW.activity_id AND a.theme_id = NEW.theme_id
   );

  SELECT RAISE(ABORT, 'session does not belong to this activity')
   WHERE NEW.session_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM activity_sessions s
        WHERE s.id = NEW.session_id AND s.activity_id = NEW.activity_id
     );

  SELECT RAISE(ABORT, 'user is not an active member of this theme')
   WHERE NOT EXISTS (
     SELECT 1 FROM event_memberships m
      WHERE m.event_id = NEW.theme_id
        AND m.user_id = NEW.user_id
        AND m.status = 'active'
   );
END;

-- ───────────────────────────────────────────── housekeeping marker
UPDATE app_meta
   SET value = '11',
       updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE key = 'schema_version';
