-- 0008_q2_categories_custom_fields.sql — categories, custom fields, participant values.
--
-- Q2 (ADR-0014). Additive on `0001`–`0007`; no earlier migration is edited.
--
-- Shape decisions:
--   * Category is a per-Tema entity. `participants.category` (the legacy free
--     text) stays as a denormalised display mirror, kept in sync by triggers;
--     `participants.category_id` is the authority.
--   * Custom field values live in one `attributes_json` column per participant,
--     not an EAV table. One participant write stays one row.
--   * `category_id` is required. SQLite cannot add a NOT NULL column without a
--     valid constant default, and every existing row has a different category,
--     so the requirement is enforced by BEFORE INSERT/UPDATE triggers plus the
--     one-time backfill below. The column declaration stays nullable only for
--     the duration of the migration.
--   * Activity-scoped fields are defined here but their values belong to Q3.
--
-- Status values are lowercase English; time is UTC milliseconds everywhere.

-- ───────────────────────────────────────────── categories
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  theme_id    TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL COLLATE NOCASE,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','archived')),
  created_at  INTEGER NOT NULL,
  created_by  TEXT REFERENCES users(id),
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT REFERENCES users(id),
  archived_at INTEGER,
  CHECK (length(name) BETWEEN 1 AND 60),
  CHECK (description IS NULL OR length(description) <= 200),
  CHECK (created_at > 0),
  CHECK (updated_at >= created_at),
  CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE UNIQUE INDEX idx_categories_theme_name ON categories(theme_id, name);
CREATE INDEX idx_categories_theme_status ON categories(theme_id, status, sort_order);

-- ───────────────────────────────────────────── custom_fields
CREATE TABLE custom_fields (
  id           TEXT PRIMARY KEY,
  theme_id     TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  key          TEXT NOT NULL,
  label        TEXT NOT NULL,
  description  TEXT,
  type         TEXT NOT NULL CHECK (type IN
               ('text','number','email','phone','select','multi_select','date','textarea','checkbox')),
  required     INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0,1)),
  options_json TEXT CHECK (options_json IS NULL OR json_valid(options_json)),
  scope        TEXT NOT NULL DEFAULT 'participant'
               CHECK (scope IN ('participant','activity')),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active','archived')),
  created_at   INTEGER NOT NULL,
  created_by   TEXT REFERENCES users(id),
  updated_at   INTEGER NOT NULL,
  updated_by   TEXT REFERENCES users(id),
  archived_at  INTEGER,
  CHECK (key GLOB '[a-z][a-z0-9_]*' AND length(key) <= 40),
  CHECK (length(label) BETWEEN 1 AND 80),
  CHECK (description IS NULL OR length(description) <= 300),
  CHECK (created_at > 0),
  CHECK (updated_at >= created_at),
  CHECK ((status = 'archived') = (archived_at IS NOT NULL)),
  CHECK (type NOT IN ('select','multi_select') OR options_json IS NOT NULL)
);
-- `key` is immutable and unique including archived rows: a reused key would make
-- old stored values read as values of the new field.
CREATE UNIQUE INDEX idx_custom_fields_theme_key ON custom_fields(theme_id, key);
CREATE INDEX idx_custom_fields_theme_scope_status
  ON custom_fields(theme_id, scope, status, sort_order);

-- ───────────────────────────────────────────── legacy category backfill
-- Existing `participants.category` values were entered by an admin, so turning
-- them into categories preserves data instead of inventing it. Grouping is
-- case-insensitive because the category name is COLLATE NOCASE.
INSERT INTO categories (id, theme_id, name, sort_order, status, created_at, updated_at)
SELECT
  'cat-' || lower(hex(randomblob(16))),
  p.event_id,
  MIN(TRIM(p.category)),
  0,
  'active',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM participants p
WHERE p.category IS NOT NULL AND TRIM(p.category) <> ''
GROUP BY p.event_id, LOWER(TRIM(p.category));

-- Legacy rows without a category (none in the production snapshot at migration
-- time) need a bucket so the rebuild is not blocked. This bucket is only for
-- old rows; new participants reject a missing category and never fall back to
-- it silently.
INSERT INTO categories (id, theme_id, name, sort_order, status, created_at, updated_at)
SELECT
  'cat-' || lower(hex(randomblob(16))),
  e.id,
  'Tanpa Kategori',
  0,
  'active',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM events e
WHERE EXISTS (
  SELECT 1 FROM participants p
   WHERE p.event_id = e.id
     AND (p.category IS NULL OR TRIM(p.category) = '')
);

-- ───────────────────────────────────────────── participant columns
ALTER TABLE participants ADD COLUMN category_id TEXT
  REFERENCES categories(id) ON DELETE RESTRICT;

ALTER TABLE participants ADD COLUMN attributes_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(attributes_json));

UPDATE participants
   SET category_id = (
     SELECT c.id FROM categories c
      WHERE c.theme_id = participants.event_id
        AND c.name = COALESCE(NULLIF(TRIM(participants.category), ''), 'Tanpa Kategori')
   )
 WHERE category_id IS NULL;

CREATE INDEX idx_participant_event_category ON participants(event_id, category_id);

-- Required category, enforced for every new write. The column is nullable only
-- because SQLite cannot add a NOT NULL column to a populated table.
CREATE TRIGGER trg_participant_category_required_insert
BEFORE INSERT ON participants
FOR EACH ROW
WHEN NEW.category_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'category_id is required');
END;

CREATE TRIGGER trg_participant_category_required_update
BEFORE UPDATE OF category_id ON participants
FOR EACH ROW
WHEN NEW.category_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'category_id is required');
END;

-- A category from another Tema must never be attached to a participant.
CREATE TRIGGER trg_participant_category_same_theme_insert
BEFORE INSERT ON participants
FOR EACH ROW
WHEN NEW.category_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM categories c
    WHERE c.id = NEW.category_id AND c.theme_id = NEW.event_id
 )
BEGIN
  SELECT RAISE(ABORT, 'category does not belong to this event');
END;

CREATE TRIGGER trg_participant_category_same_theme_update
BEFORE UPDATE OF category_id ON participants
FOR EACH ROW
WHEN NEW.category_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM categories c
    WHERE c.id = NEW.category_id AND c.theme_id = NEW.event_id
 )
BEGIN
  SELECT RAISE(ABORT, 'category does not belong to this event');
END;

-- Keep the legacy display mirror consistent without a second write from the
-- application. Category renames update every participant's mirror; that is a
-- rare operation and still one row per participant.
CREATE TRIGGER trg_participant_category_mirror_insert
AFTER INSERT ON participants
FOR EACH ROW
WHEN NEW.category_id IS NOT NULL
BEGIN
  UPDATE participants
     SET category = (SELECT name FROM categories WHERE id = NEW.category_id)
   WHERE id = NEW.id;
END;

CREATE TRIGGER trg_participant_category_mirror_update
AFTER UPDATE OF category_id ON participants
FOR EACH ROW
WHEN NEW.category_id IS NOT NULL
BEGIN
  UPDATE participants
     SET category = (SELECT name FROM categories WHERE id = NEW.category_id)
   WHERE id = NEW.id;
END;

CREATE TRIGGER trg_category_name_mirror_update
AFTER UPDATE OF name ON categories
FOR EACH ROW
BEGIN
  UPDATE participants SET category = NEW.name WHERE category_id = NEW.id;
END;

-- Backfill ran before the mirror triggers existed; align legacy rows once.
UPDATE participants
   SET category = (SELECT name FROM categories WHERE id = participants.category_id)
 WHERE category_id IS NOT NULL;

-- ───────────────────────────────────────────── housekeeping marker
UPDATE app_meta
   SET value = '8',
       updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE key = 'schema_version';
