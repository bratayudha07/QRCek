-- 0003_sync.sql — Google Sheets projection map + persistent outbox
-- Mirrors docs/DESAIN_DATABASE.md §3 (ADR-004: upsert projection, not append).

-- ───────────────────────────────────────────── per-event sync config
CREATE TABLE sync_state (
  event_id          TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  spreadsheet_id    TEXT NOT NULL,
  sheet_tab         TEXT NOT NULL,
  sync_enabled      INTEGER NOT NULL DEFAULT 1 CHECK (sync_enabled IN (0,1)),
  schema_version    INTEGER NOT NULL DEFAULT 1,
  header_hash       TEXT,
  last_full_sync_at INTEGER,
  last_error        TEXT,
  updated_at        INTEGER NOT NULL
);

-- ───────────────────────────────────────────── participant -> sheet row map
CREATE TABLE sheet_rows (
  event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  row_index      INTEGER NOT NULL,
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
  updated_at      INTEGER NOT NULL
);

-- Coalescing key: at most one pending sync per participant.
CREATE UNIQUE INDEX uq_outbox_pending
  ON outbox(event_id, participant_id)
  WHERE status IN ('pending','inflight','failed');

CREATE INDEX idx_outbox_due ON outbox(status, next_attempt_at);
