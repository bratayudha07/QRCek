-- 0001_init.sql — core domain: events, users, participants, attendance, audit
-- Mirrors docs/DESAIN_DATABASE.md §3.
--
-- NOTE: foreign key enforcement is ON by default in D1, so no `PRAGMA foreign_keys`
-- statement is issued here (D1 may reject it inside a migration).

-- ───────────────────────────────────────────── users
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'officer'
                CHECK (role IN ('superadmin','event_admin','officer')),
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','suspended')),
  created_at    INTEGER NOT NULL,
  created_by    TEXT REFERENCES users(id),
  CHECK (email IS NULL OR length(email) <= 254)
);

-- ───────────────────────────────────────────── events
CREATE TABLE events (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL,
  description    TEXT,
  timezone       TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  starts_at      INTEGER,
  ends_at        INTEGER,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','active','closed','archived')),
  allow_manual   INTEGER NOT NULL DEFAULT 0 CHECK (allow_manual IN (0,1)),
  created_at     INTEGER NOT NULL,
  created_by     TEXT NOT NULL REFERENCES users(id),
  archived_at    INTEGER,
  CHECK (length(slug) BETWEEN 3 AND 60),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX idx_events_status ON events(status, starts_at);

-- ───────────────────────────────────────────── memberships
CREATE TABLE event_memberships (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('event_admin','officer')),
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','revoked')),
  created_at  INTEGER NOT NULL,
  revoked_at  INTEGER,
  UNIQUE (event_id, user_id)
);
CREATE INDEX idx_membership_user  ON event_memberships(user_id, status);
CREATE INDEX idx_membership_event ON event_memberships(event_id, role, status);

-- ───────────────────────────────────────────── participants
CREATE TABLE participants (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  external_ref    TEXT,
  full_name       TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  category        TEXT,
  note            TEXT,
  qr_token_hash   TEXT NOT NULL UNIQUE,
  qr_issued_at    INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','inactive')),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  CHECK (length(full_name) BETWEEN 1 AND 120),
  CHECK (status = 'inactive' OR qr_token_hash IS NOT NULL)
);

-- Idempotent CSV import: same external_ref within one event = same participant.
CREATE UNIQUE INDEX uq_participant_ref
  ON participants(event_id, external_ref)
  WHERE external_ref IS NOT NULL;

CREATE INDEX idx_participant_event_name ON participants(event_id, full_name);
CREATE INDEX idx_participant_token      ON participants(qr_token_hash);

-- ───────────────────────────────────────────── attendance
CREATE TABLE attendance (
  id             TEXT PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'present'
                 CHECK (status IN ('present','late','absent','excused')),
  checked_in_at  INTEGER NOT NULL,
  recorded_by    TEXT REFERENCES users(id),
  method         TEXT NOT NULL DEFAULT 'qr_scan'
                 CHECK (method IN ('qr_scan','manual','correction')),
  note           TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,

  -- CORE double-attendance guard. Never drop this constraint.
  UNIQUE (event_id, participant_id)
);
CREATE INDEX idx_attendance_event_time ON attendance(event_id, checked_in_at);
CREATE INDEX idx_attendance_event_stat ON attendance(event_id, status);

-- ───────────────────────────────────────────── audit_log (append-only)
CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,
  event_id      TEXT,
  actor_user_id TEXT,
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  before_json   TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json    TEXT CHECK (after_json  IS NULL OR json_valid(after_json)),
  reason        TEXT,
  request_id    TEXT,
  ip_hash       TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_audit_event_time ON audit_log(event_id, created_at DESC);
CREATE INDEX idx_audit_actor_time ON audit_log(actor_user_id, created_at DESC);
CREATE INDEX idx_audit_action     ON audit_log(action, created_at DESC);

CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
