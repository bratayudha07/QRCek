-- 0010_qr_identities.sql — QR Identity per Tema (ADR-0017, D-004, FR-054–FR-065).
--
-- Q4. Additive on `0001`–`0009`; no earlier migration is edited.
-- `schema_version` becomes `10`.
--
-- Shape decisions:
--   * One active credential per `(theme_id, participant_id)`. Rotation updates
--     that row in place, so a future transaction reference (Q5) never changes
--     (FR-060, BR-028).
--   * Rotation history lives in `audit_log`, not in credential rows (D-023,
--     ADR-0008). The row keeps only the current credential plus counters.
--   * The legacy `participants.qr_*` columns stay until a separate contract
--     migration (ADR-0017 sub-decision 5). Both paths carry the same values for
--     rows that already had a credential; new issuance writes this table only.
--   * `ON DELETE RESTRICT` is deliberate: archiving a participant or a Tema
--     must never silently destroy the credential that anchored history.
--   * Time is UTC milliseconds everywhere, matching the rest of the schema.

-- ───────────────────────────────────────────── qr_identities
CREATE TABLE qr_identities (
  id             TEXT PRIMARY KEY,
  theme_id       TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  token_hash     TEXT NOT NULL CHECK (length(token_hash) = 43),
  ciphertext     TEXT NOT NULL CHECK (length(ciphertext) = 79),
  nonce          TEXT NOT NULL CHECK (length(nonce) = 16),
  key_version    INTEGER NOT NULL CHECK (key_version >= 1),
  issued_at      INTEGER NOT NULL CHECK (issued_at > 0),
  rotated_at     INTEGER,
  rotation_count INTEGER NOT NULL DEFAULT 0 CHECK (rotation_count >= 0),
  CHECK (rotated_at IS NULL OR rotated_at >= issued_at)
);

-- One identity per Tema + Peserta, enforced by the database rather than a
-- read-then-write check in the Worker.
CREATE UNIQUE INDEX uq_qr_identity_participant
  ON qr_identities(theme_id, participant_id);

-- Scan lookup: one hash identifies at most one identity across the database.
-- Both columns are NOT NULL, so no partial predicate is needed.
CREATE UNIQUE INDEX uq_qr_identity_hash
  ON qr_identities(token_hash);

-- ───────────────────────────────────────────── cross-context triggers
-- The Worker validates the same rule before writing so the admin gets a clear
-- message; these triggers are the last line of defence for direct SQL.
CREATE TRIGGER trg_qr_identity_context_insert
BEFORE INSERT ON qr_identities
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'participant does not belong to this theme')
   WHERE NOT EXISTS (
     SELECT 1 FROM participants p
      WHERE p.id = NEW.participant_id AND p.event_id = NEW.theme_id
   );
END;

CREATE TRIGGER trg_qr_identity_context_update
BEFORE UPDATE OF theme_id, participant_id
ON qr_identities
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'participant does not belong to this theme')
   WHERE NOT EXISTS (
     SELECT 1 FROM participants p
      WHERE p.id = NEW.participant_id AND p.event_id = NEW.theme_id
   );
END;

-- ───────────────────────────────────────────── backfill kredensial lama
-- Only complete credentials are copied: a partially written legacy row must not
-- become a half-usable identity. Printed cards stay valid because the token,
-- hash, ciphertext, nonce, key version, and issue time are copied verbatim.
--
-- No audit row is written: this is a migration, not an admin action. The guard
-- keeps the statement idempotent when it is replayed on a database copy.
-- >>> backfill
INSERT INTO qr_identities (
  id, theme_id, participant_id, token_hash, ciphertext, nonce, key_version,
  issued_at, rotated_at, rotation_count
)
SELECT
  lower(hex(randomblob(16))),
  p.event_id,
  p.id,
  p.qr_token_hash,
  p.qr_token_ciphertext,
  p.qr_token_nonce,
  p.qr_key_version,
  p.qr_issued_at,
  NULL,
  0
FROM participants p
WHERE p.qr_token_hash IS NOT NULL
  AND p.qr_token_ciphertext IS NOT NULL
  AND p.qr_token_nonce IS NOT NULL
  AND p.qr_key_version IS NOT NULL
  AND p.qr_issued_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM qr_identities q
     WHERE q.theme_id = p.event_id AND q.participant_id = p.id
  );
-- <<< backfill

-- ───────────────────────────────────────────── housekeeping marker
UPDATE app_meta
   SET value = '10',
       updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE key = 'schema_version';
