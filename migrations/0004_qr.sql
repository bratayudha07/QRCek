-- 0004_qr.sql — participant QR credentials, event label config, audit log.
--
-- Tahap 4 (QR peserta + cetak label). Additive only: no table is rebuilt and no
-- existing column changes, so `0003_participants.sql` rows and the CSV import
-- path keep working untouched.
--
-- Deviation from docs/DESAIN_DATABASE.md §3, recorded there: the QR columns are
-- NULLABLE. Stage 4 issues a credential lazily, on the first label print, so a
-- freshly imported participant has no token yet. The design document's
-- `CHECK (status = 'inactive' OR qr_token_hash IS NOT NULL)` therefore cannot
-- be enforced without refusing every existing row; the all-or-nothing rule is
-- enforced by `PUT` in the code that writes these five columns (see
-- `apps/api/src/domain/qr-token.ts` and its tests).
--
-- Why no table-level CHECK: SQLite cannot add a table constraint through
-- `ALTER TABLE`, and a table rebuild for cosmetics would be riskier than the
-- invariant it buys. Per-column CHECKs below still reject malformed values.

-- ───────────────────────────────────────────── QR credential columns
-- Storage shape (see docs/ARSITEKTUR.md ADR-006):
--   qr_token_hash        HMAC-SHA256(QR_PEPPER, token), base64url, 43 chars
--   qr_token_ciphertext  AES-256-GCM(token string), base64url, 43 + 16 tag = 79 chars
--   qr_token_nonce       unique 96-bit GCM nonce, base64url, 16 chars
--   qr_key_version       1-based key generation, bumped only by a rotation
--   qr_issued_at         UTC ms of first issuance; reprints never change it

ALTER TABLE participants ADD COLUMN qr_token_hash TEXT
  CHECK (qr_token_hash IS NULL OR length(qr_token_hash) = 43);

ALTER TABLE participants ADD COLUMN qr_token_ciphertext TEXT
  CHECK (qr_token_ciphertext IS NULL OR length(qr_token_ciphertext) = 79);

ALTER TABLE participants ADD COLUMN qr_token_nonce TEXT
  CHECK (qr_token_nonce IS NULL OR length(qr_token_nonce) = 16);

ALTER TABLE participants ADD COLUMN qr_key_version INTEGER
  CHECK (qr_key_version IS NULL OR qr_key_version >= 1);

ALTER TABLE participants ADD COLUMN qr_issued_at INTEGER
  CHECK (qr_issued_at IS NULL OR qr_issued_at > 0);

-- The lookup index for Stage 5 scanning: one hash identifies at most one
-- participant across the whole database. Partial so the many participants that
-- have not been printed yet do not collide on NULL.
CREATE UNIQUE INDEX uq_participant_qr_hash
  ON participants(qr_token_hash)
  WHERE qr_token_hash IS NOT NULL;

-- ───────────────────────────────────────────── per-event label config
-- Optional row: no row means "use DEFAULT_LABEL_FIELDS with event name shown".
CREATE TABLE event_label_config (
  event_id        TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  fields_json     TEXT NOT NULL CHECK (json_valid(fields_json)),
  show_event_name INTEGER NOT NULL DEFAULT 1 CHECK (show_event_name IN (0,1)),
  updated_at      INTEGER NOT NULL,
  updated_by      TEXT REFERENCES users(id) ON DELETE SET NULL
);

-- ───────────────────────────────────────────── audit_log (append-only)
-- No foreign keys on purpose: an audit row is a historical fact. It must not
-- disappear or change when an event, user, or participant is deleted later.
-- `before_json`/`after_json` hold state snapshots; for non-mutating actions such
-- as `qr.labels_exported` the `after_json` carries the action metadata
-- (count/format/field selection). Never tokens, hashes, or PII.
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
  created_at    INTEGER NOT NULL,
  CHECK (length(action) BETWEEN 3 AND 64),
  CHECK (length(entity_type) BETWEEN 3 AND 32),
  CHECK (entity_id IS NULL OR length(entity_id) <= 64),
  CHECK (reason IS NULL OR length(reason) <= 500),
  CHECK (created_at > 0)
);

CREATE INDEX idx_audit_event_time ON audit_log(event_id, created_at DESC);
CREATE INDEX idx_audit_actor_time ON audit_log(actor_user_id, created_at DESC);
CREATE INDEX idx_audit_action     ON audit_log(action, created_at DESC);

-- Append-only is a database property, not a coding convention: no client, no
-- migration script, and no future bug can rewrite history.
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
