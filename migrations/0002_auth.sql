-- 0002_auth.sql — passwordless credentials, sessions, invites, rate limiting
-- Mirrors docs/DESAIN_DATABASE.md §3.
--
-- Fase 0 creates the schema only; the endpoints land in Fase 1.

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
  event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role           TEXT NOT NULL CHECK (role IN ('event_admin','officer')),
  token_hash     TEXT NOT NULL UNIQUE,
  target_user_id TEXT REFERENCES users(id),
  invited_name   TEXT,
  invited_phone  TEXT,
  created_by     TEXT NOT NULL REFERENCES users(id),
  created_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  used_at        INTEGER,
  used_by        TEXT REFERENCES users(id)
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
