-- 0005_attendance_sync.sql — attendance, outbox, and Google Sheets projection.
--
-- Tahap 5 (scan, attendance, recap, Sheets sync). Additive only: no table is
-- rebuilt and no Stage 4 column changes.
--
-- Integrity rules enforced here, not in application code:
--   * `UNIQUE (event_id, participant_id)` makes double attendance impossible.
--   * `uq_outbox_pending` coalesces pending work per participant, so ten
--     corrections enqueue one row and a retry can never duplicate a sheet row.
--   * `sheet_rows` maps one participant to exactly one spreadsheet row
--     (ADR-004: projection, not append-only).
--
-- Time is UTC milliseconds everywhere (AGENTS.md).

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

  -- ⚠️ INTI PENCEGAHAN ABSENSI GANDA. Jangan pernah dihapus.
  UNIQUE (event_id, participant_id),
  CHECK (checked_in_at > 0),
  CHECK (created_at > 0),
  CHECK (updated_at > 0),
  CHECK (note IS NULL OR length(note) <= 500)
);

CREATE INDEX idx_attendance_event_time ON attendance(event_id, checked_in_at);
CREATE INDEX idx_attendance_event_stat ON attendance(event_id, status);
-- Staff history is "what did this officer record", newest first.
CREATE INDEX idx_attendance_recorder_time
  ON attendance(recorded_by, checked_in_at DESC);

-- ───────────────────────────────────────────── Sheets sync config
CREATE TABLE sync_state (
  event_id          TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  spreadsheet_id    TEXT NOT NULL,
  sheet_tab         TEXT NOT NULL,
  sync_enabled      INTEGER NOT NULL DEFAULT 1 CHECK (sync_enabled IN (0,1)),
  schema_version    INTEGER NOT NULL DEFAULT 1,
  header_hash       TEXT,
  last_full_sync_at INTEGER,
  last_error        TEXT,
  updated_at        INTEGER NOT NULL,
  CHECK (length(spreadsheet_id) BETWEEN 10 AND 200),
  CHECK (length(sheet_tab) BETWEEN 1 AND 100),
  CHECK (last_error IS NULL OR length(last_error) <= 500)
);

-- ───────────────────────────────────────────── participant → sheet row map
CREATE TABLE sheet_rows (
  event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  row_index      INTEGER NOT NULL CHECK (row_index >= 3), -- 1 metadata, 2 header
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (event_id, participant_id),
  UNIQUE (event_id, row_index)
);

-- ───────────────────────────────────────────── outbox
CREATE TABLE outbox (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_id  TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('attendance','participant','delete')),
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','inflight','done','failed','dead')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  claimed_at      INTEGER,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  CHECK (attempts >= 0),
  CHECK (last_error IS NULL OR length(last_error) <= 500)
);

-- One pending row per participant: the next write updates the existing item
-- instead of enqueueing a duplicate. The predicate MUST be repeated in every
-- `ON CONFLICT` clause (verified in Fase 0, docs/OPERASIONAL.md §4.1).
CREATE UNIQUE INDEX uq_outbox_pending
  ON outbox(event_id, participant_id)
  WHERE status IN ('pending','inflight','failed');

CREATE INDEX idx_outbox_due ON outbox(status, next_attempt_at);
CREATE INDEX idx_outbox_event ON outbox(event_id, status);

-- ───────────────────────────────────────────── housekeeping marker
UPDATE app_meta
   SET value = '5',
       updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE key = 'schema_version';
