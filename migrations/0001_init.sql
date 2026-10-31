-- 0001_init.sql — minimal foundation schema.
--
-- This migration intentionally contains NO business tables. Events,
-- participants, attendance, audit log, and the sync outbox arrive together
-- with the phase that needs them (see AGENTS.md "Roadmap bertahap" and
-- IMPLEMENTATION_PLAN.md). Fase 0 only has to prove that the migration
-- pipeline works against a real D1 database.
--
-- `app_meta` gives the pipeline something real to apply and provides a
-- versioned key/value anchor that later migrations can build on.
--
-- NOTE: foreign key enforcement is ON by default in D1, so no
-- `PRAGMA foreign_keys` statement is issued here.

CREATE TABLE app_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (length(key) BETWEEN 1 AND 64)
);

-- Time is stored in UTC milliseconds everywhere (AGENTS.md).
INSERT INTO app_meta (key, value, updated_at)
VALUES ('schema_version', '1', CAST(strftime('%s', 'now') AS INTEGER) * 1000);
