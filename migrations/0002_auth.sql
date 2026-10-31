-- 0002_auth.sql — identity, sessions, invites, rate limiting.
--
-- Fase 1 (Tahap 2). Creates schema only; no participant/attendance/outbox
-- tables yet (those belong to Fase 2+).
--
-- Deviation from docs/DESAIN_DATABASE.md §3, recorded there and in
-- docs/OPERASIONAL.md: `invites.event_id` is nullable so the bootstrap
-- superadmin invite has no event. A CHECK keeps every other role event-bound.

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
  CHECK (length(display_name) BETWEEN 1 AND 120),
  CHECK (email IS NULL OR length(email) <= 254)
);

-- ───────────────────────────────────────────── events
-- Schema only. Event CRUD endpoints are intentionally not part of Fase 1
-- scope here; memberships need a real table to be scoped against.
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

-- ───────────────────────────────────────────── device credentials
CREATE TABLE device_credentials (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  label        TEXT,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER
);
CREATE INDEX idx_device_user ON device_credentials(user_id, revoked_at);

-- ───────────────────────────────────────────── sessions
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT REFERENCES device_credentials(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  revoked_at    INTEGER
);
CREATE INDEX idx_session_user    ON sessions(user_id, revoked_at);
CREATE INDEX idx_session_expires ON sessions(expires_at);

-- ───────────────────────────────────────────── invites
CREATE TABLE invites (
  id             TEXT PRIMARY KEY,
  -- NULL only for the bootstrap superadmin invite (no event exists yet).
  event_id       TEXT REFERENCES events(id) ON DELETE CASCADE,
  role           TEXT NOT NULL CHECK (role IN ('superadmin','event_admin','officer')),
  token_hash     TEXT NOT NULL UNIQUE,
  target_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  invited_name   TEXT,
  invited_phone  TEXT,
  -- NULL only for the bootstrap invite: no admin exists yet to be the author.
  created_by     TEXT REFERENCES users(id),
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  used_at        INTEGER,
  used_by        TEXT REFERENCES users(id),
  CHECK (
    (role = 'superadmin' AND event_id IS NULL)
    OR (role <> 'superadmin' AND event_id IS NOT NULL)
  ),
  CHECK (created_by IS NOT NULL OR (role = 'superadmin' AND event_id IS NULL))
);
CREATE INDEX idx_invite_event   ON invites(event_id, created_at DESC);
CREATE INDEX idx_invite_pending ON invites(expires_at) WHERE used_at IS NULL;

-- ───────────────────────────────────────────── recovery codes
CREATE TABLE recovery_codes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX idx_recovery_user ON recovery_codes(user_id, used_at);

-- ───────────────────────────────────────────── rate limiting
CREATE TABLE rate_limits (
  bucket       TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  counter      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);
-- Cleanup by cron later; the index keeps the sweep cheap.
CREATE INDEX idx_rate_limits_window ON rate_limits(window_start);
