-- 0003_participants.sql — participant registry per event.
--
-- Fase 2 (Tahap 3) owns participants. QR columns are intentionally NOT here:
-- QR generation/printing belongs to a later phase, and storing a throwaway
-- token hash now would be dead data. The QR columns are added by the migration
-- that actually issues QR tokens (documented in docs/DESAIN_DATABASE.md §3).
--
-- Duplicate prevention for CSV import is enforced by the partial unique index
-- below, not by application code.

CREATE TABLE participants (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  external_ref TEXT,
  full_name    TEXT NOT NULL,
  phone        TEXT,
  email        TEXT,
  category     TEXT,
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','inactive')),
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  CHECK (length(full_name) BETWEEN 1 AND 120),
  CHECK (external_ref IS NULL OR length(external_ref) BETWEEN 1 AND 64),
  CHECK (phone IS NULL OR length(phone) <= 32),
  CHECK (email IS NULL OR length(email) <= 254),
  CHECK (category IS NULL OR length(category) <= 60),
  CHECK (note IS NULL OR length(note) <= 500)
);

-- Idempotent imports: the same external_ref in the same event is the same
-- person. NULL refs are allowed (manual entries) and do not collide.
CREATE UNIQUE INDEX uq_participant_ref
  ON participants(event_id, external_ref)
  WHERE external_ref IS NOT NULL;

-- List/search by name (prefix and exact use it; leading-wildcard searches scan
-- within the event, which is bounded and acceptable at this scale).
CREATE INDEX idx_participant_event_name ON participants(event_id, full_name);

-- Keyset pagination: newest first, id as the tie-breaker.
CREATE INDEX idx_participant_event_created
  ON participants(event_id, created_at DESC, id DESC);
