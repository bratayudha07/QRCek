-- 0007_q1_activities_sessions.sql — Tema → Aktivitas → Sesi foundation.
--
-- Q1 (ADR-0009, ADR-0010, ADR-0012). Additive only: no table is rebuilt and no
-- existing migration is touched.
--
-- Integrity rules enforced here, not in application code:
--   * A Sesi always belongs to exactly one Aktivitas; a Aktivitas to one Tema.
--   * `ON DELETE RESTRICT`, not CASCADE: the product only archives, never
--     deletes activities or sessions. Deleting a Tema requires it to be empty.
--   * `archived` is a real status for activities; for sessions archive is
--     `archived_at`, separate from the operational status (FR-206, BR-078).
--
-- Status values are lowercase English; the UI translates them (AGENTS.md).
-- Time is UTC milliseconds everywhere.

-- ───────────────────────────────────────────── activities
CREATE TABLE activities (
  id               TEXT PRIMARY KEY,
  theme_id         TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  name             TEXT NOT NULL,
  description      TEXT,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('attendance','consumption')),
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','active','completed','archived')),
  location         TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  created_by       TEXT REFERENCES users(id),
  updated_at       INTEGER NOT NULL,
  updated_by       TEXT REFERENCES users(id),
  archived_at      INTEGER,
  CHECK (length(name) BETWEEN 1 AND 120),
  CHECK (description IS NULL OR length(description) <= 500),
  CHECK (location IS NULL OR length(location) <= 200),
  CHECK (created_at > 0),
  CHECK (updated_at >= created_at),
  CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE INDEX idx_activities_theme_status ON activities(theme_id, status, sort_order);
CREATE INDEX idx_activities_theme_type   ON activities(theme_id, transaction_type);

-- ───────────────────────────────────────────── activity_sessions
-- Named `activity_sessions` on purpose: `sessions` is the auth session table
-- (0002_auth.sql). Never reuse that name.
CREATE TABLE activity_sessions (
  id          TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  location    TEXT,
  starts_at   INTEGER,
  ends_at     INTEGER,
  status      TEXT NOT NULL DEFAULT 'scheduled'
              CHECK (status IN ('scheduled','in_progress','completed','disabled')),
  archived_at INTEGER,
  created_at  INTEGER NOT NULL,
  created_by  TEXT REFERENCES users(id),
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT REFERENCES users(id),
  CHECK (length(name) BETWEEN 1 AND 120),
  CHECK (location IS NULL OR length(location) <= 200),
  CHECK (starts_at IS NULL OR starts_at > 0),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at),
  CHECK (created_at > 0),
  CHECK (updated_at >= created_at),
  CHECK (archived_at IS NULL OR archived_at > 0),
  CONSTRAINT archived_session_is_finished
    CHECK (archived_at IS NULL OR status IN ('completed','disabled'))
);
CREATE INDEX idx_activity_sessions_activity_status
  ON activity_sessions(activity_id, status, starts_at);
CREATE INDEX idx_activity_sessions_activity_time
  ON activity_sessions(activity_id, starts_at);

-- ───────────────────────────────────────────── housekeeping marker
UPDATE app_meta
   SET value = '7',
       updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE key = 'schema_version';
