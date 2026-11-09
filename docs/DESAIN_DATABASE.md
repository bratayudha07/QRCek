# DESAIN DATABASE — D1 (SQLite)

Database: Cloudflare D1, binding `DB`. Dialek **SQLite**, bukan Postgres.

> **Status dokumen (9 November 2026).** Dokumen ini mencatat **skema aktual**: migrasi `0001`–`0010`. `0001`–`0006` sudah diterapkan di remote dan **tidak boleh diedit**; `0007_q1_activities_sessions.sql` diterapkan di remote pada 6 November 2026 (backup: `/tmp/opencode/qrcek-backup-2026-11-06.sql`). `0008_q2_categories_custom_fields.sql` diterapkan di remote pada **8 November 2026 02:28 UTC** (`app_meta.schema_version = 8`) berdekatan dengan deploy kode Q2; verifikasi data: 80 peserta, 32 kategori, 0 peserta tanpa `category_id`, 0 kategori lintas Tema (`docs/OPERASIONAL.md`). `0009_entitlement_rules.sql` (Q3) sudah diuji di database lokal dan **sudah diterapkan di remote** pada 8 November 2026 (`app_meta.schema_version = 9`, deploy `dc8b8546`); backfill menghasilkan 0 baris. `0010_qr_identities.sql` (Q4) **sudah lulus seluruh tes lokal tetapi belum diterapkan di remote**; `schema_version` lokal/CI menjadi `10`. Model target QRCek yang tersisa (transaksi efektif, Reversal/Adjustment, kuota konsumsi) **belum punya skema**; bentuknya diputuskan lewat AQ-002–AQ-004, AQ-009 di [`ARCHITECTURE.md`](./ARCHITECTURE.md) §6 — AQ-005 sudah dijawab ADR-0016 dan menjadi `0009`, AQ-006 menjadi `0008`. `D-007` [A] menghapus kewajiban migrasi data produksi, **bukan** kewajiban regression test, dan bukan izin mengedit migrasi lama.
>
> Bagian yang bertentangan dengan keputusan produk `[A]` ditandai **Delta**: `attendance` satu baris per `(event_id, participant_id)` (target: per ruang lingkup Aktivitas/Sesi, `D-003`), koreksi via `UPDATE attendance` (target: Reversal/Adjustment, `D-006`), dan kredensial QR per baris peserta per acara (target: per Tema + Peserta, `D-004`).

Batasan platform yang membentuk skema ini (terverifikasi, lihat [`../COSTS_AND_LIMITS.md`](../COSTS_AND_LIMITS.md)):

- Maksimum **500 MB per database** pada Workers Free.
- **100.000 baris tulis/hari**, **5.000.000 baris baca/hari** pada Workers Free.
- Setiap indeks menambah **satu baris tulis** per `INSERT`/`UPDATE` pada kolom terindeks.
- Maksimum **100 kolom per tabel**, **100 parameter terikat per query**, **100 KB per statement SQL**.
- D1 tidak punya transaksi interaktif; operasi atomik multi-statement memakai `db.batch()`. Rollback batch terverifikasi lewat `spike.batch.test.ts`.

---

## 1. Konvensi

| Aspek | Aturan |
|---|---|
| Primary key | `TEXT` — ULID (monotonic, sortable, 26 karakter) |
| Timestamp | `INTEGER` milidetik epoch UTC. Nama kolom berakhiran `_at` |
| Boolean | `INTEGER` 0/1 dengan `CHECK (x IN (0,1))` |
| Enum | `TEXT` dengan `CHECK (x IN (...))` — D1 tidak punya tipe ENUM |
| JSON | `TEXT` dengan `CHECK (json_valid(x))` |
| Penamaan | `snake_case`, tabel jamak, FK `<entitas>_id` |
| Tanpa `AUTOINCREMENT` | ULID dibuat di aplikasi |
| Tanpa `CURRENT_TIMESTAMP` | Waktu selalu dari aplikasi (bisa di-inject pada tes) |

**Kenapa ULID dan bukan UUIDv4**: urutan `id` mendekati urutan waktu sehingga `ORDER BY id` berguna untuk paginasi kursor tanpa indeks tambahan.

---

## 2. Diagram relasi

```
events ──┬──< event_memberships >── users ──┬──< device_credentials
         │                                  ├──< sessions
         │                                  ├──< recovery_codes
         │                                  └──< invites (sebagai pembuat)
         ├──< activities ──< activity_sessions
         ├──< categories ──< participants ──┬──< attendance (1:1 per acara)
         │                                  └──< sheet_rows (1:1)
         ├──< custom_fields
         ├──< entitlement_rules (tema/aktivitas/sesi/peserta/kategori)
         ├──< invites
         ├──< outbox
         ├──< audit_log
         └──< sync_state (1:1)

users.role ∈ {superadmin, event_admin, officer}
event_memberships.role ∈ {event_admin, officer}   (superadmin tidak butuh membership)
```

Catatan: `superadmin` bersifat global (`users.role`), sedangkan `event_admin` dan `officer` **selalu** terikat ke satu acara lewat `event_memberships`.

---

## 3. DDL

> **Keadaan aktual per 4 November 2026:** migrasi `0001`–`0006` membuat tabel bisnis, kolom QR, attendance, audit, outbox, Sheets, dan metadata self-signup; `0007` menambahkan `activities` dan `activity_sessions` (Q1). DDL di bawah mendokumentasikan skema; file migrasi tetap sumber kebenaran untuk definisi aktual.

File migrasi: satu file per perubahan skema, diberi nomor berurutan di `migrations/`.

> Catatan: D1 menegakkan foreign key secara default, sehingga migrasi **tidak**
> mengirim `PRAGMA foreign_keys = ON` (D1 dapat menolaknya di dalam migrasi).

```sql
-- ───────────────────────────────────────────── users
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE,                     -- opsional, hanya untuk identifikasi
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
  starts_at      INTEGER,                        -- NULL = tanpa batas
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
  external_ref    TEXT,                          -- NIS/nomor undangan dari CSV
  full_name       TEXT NOT NULL,
  phone           TEXT,
  email           TEXT,
  category        TEXT,                          -- kelas/kelompok/kelas anak
  note            TEXT,
  -- Kredensial QR (ADR-006). NULL sampai label pertama dicetak.
  qr_token_hash       TEXT,                      -- HMAC-SHA256(QR_PEPPER, token), 43 char
  qr_token_ciphertext TEXT,                      -- AES-256-GCM(token), 79 char
  qr_token_nonce      TEXT,                      -- 96-bit GCM nonce, 16 char
  qr_key_version      INTEGER,                    -- versi QR_ENCRYPTION_KEY
  qr_issued_at        INTEGER,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','inactive')),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  CHECK (length(full_name) BETWEEN 1 AND 120),
  CHECK (qr_token_hash IS NULL OR length(qr_token_hash) = 43),
  CHECK (qr_token_ciphertext IS NULL OR length(qr_token_ciphertext) = 79),
  CHECK (qr_token_nonce IS NULL OR length(qr_token_nonce) = 16),
  CHECK (qr_key_version IS NULL OR qr_key_version >= 1),
  CHECK (qr_issued_at IS NULL OR qr_issued_at > 0)
);

-- Idempotensi import CSV: ref yang sama di acara yang sama = peserta yang sama
CREATE UNIQUE INDEX uq_participant_ref
  ON participants(event_id, external_ref)
  WHERE external_ref IS NOT NULL;

CREATE INDEX idx_participant_event_name ON participants(event_id, full_name);

-- Satu kredensial hanya boleh dipakai satu peserta. Partial karena NULL valid.
CREATE UNIQUE INDEX uq_participant_qr_hash
  ON participants(qr_token_hash)
  WHERE qr_token_hash IS NOT NULL;

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
  ip_hash       TEXT,                            -- HMAC dari IP, bukan IP mentah
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

-- ───────────────────────────────────────────── event_label_config
-- Konfigurasi tampilan label per acara. Tidak adanya baris = default aplikasi.
CREATE TABLE event_label_config (
  event_id        TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  fields_json     TEXT NOT NULL CHECK (json_valid(fields_json)),
  show_event_name INTEGER NOT NULL DEFAULT 1 CHECK (show_event_name IN (0,1)),
  updated_at      INTEGER NOT NULL,
  updated_by      TEXT REFERENCES users(id) ON DELETE SET NULL
);
```

File: `migrations/0002_auth.sql`

```sql
-- ───────────────────────────────────────────── device credentials
CREATE TABLE device_credentials (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,             -- HMAC-SHA256(PEPPER, token 256-bit)
  label        TEXT,                             -- "HP petugas A", dari user agent
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
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('event_admin','officer')),
  token_hash    TEXT NOT NULL UNIQUE,            -- HMAC-SHA256(PEPPER, token 128-bit)
  target_user_id TEXT REFERENCES users(id),      -- NULL = buat user baru saat redeem
  invited_name  TEXT,
  invited_phone TEXT,
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  used_at       INTEGER,
  used_by       TEXT REFERENCES users(id)
);
CREATE INDEX idx_invite_event ON invites(event_id, created_at DESC);
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
```

> **Deviasi implementasi (Tahap 2, `migrations/0002_auth.sql`).** Blok DDL di atas adalah
> desain target. Yang benar-benar berjalan berbeda di tiga hal, semuanya karena kebutuhan
> bootstrap (akun pertama ada sebelum acara pertama):
>
> 1. `invites.event_id` **nullable**, dengan `CHECK` `(role = 'superadmin' AND event_id IS
>    NULL) OR (role <> 'superadmin' AND event_id IS NOT NULL)`.
> 2. `invites.created_by` **nullable**, hanya sah untuk undangan bootstrap superadmin
>    (`CHECK (created_by IS NOT NULL OR (role = 'superadmin' AND event_id IS NULL))`).
> 3. `invites.role` menerima `'superadmin'` di samping `event_admin` dan `officer`.
>
> Konsekuensi: undangan yang dibuat admin acara selalu punya `event_id` dan `created_by`,
> jadi invariant lama tetap berlaku untuk seluruh jalur normal. Migrasi berikutnya tidak
> boleh "merapikan" kolom ini tanpa memikirkan baris bootstrap yang mungkin belum dipakai.

> **Catatan implementasi:**
>
> 1. **Kolom QR nullable, bukan `NOT NULL`.** Kredensial dibuat *lazy* saat label pertama
>    dicetak (Tahap 4). Peserta hasil import CSV dan peserta lama tetap valid tanpa QR, dan
>    tidak ada token mati yang dibuat untuk orang yang tidak pernah dicetak. Karena itu
>    `CHECK (status = 'inactive' OR qr_token_hash IS NOT NULL)` **tidak dipasang**; invariant
>    "peserta aktif yang punya kredensial selalu punya kelima kolom" ditegakkan kode
>    (`claimQrCredentialStatement` menulis kelimanya sekaligus) dan per-kolom `CHECK`.
> 2. Kolom tambahan dibanding desain awal: `qr_token_ciphertext`, `qr_token_nonce`, dan
>    `qr_key_version` (ADR-006). Tanpa ciphertext, cetak ulang harus merotasi token.
> 3. `CHECK` panjang untuk `external_ref`, `phone`, `email`, `category`, `note`, dan kelima
>    kolom QR ditambahkan agar batas API juga ditegakkan database.
> 4. Indeks: `uq_participant_ref` (partial), `idx_participant_event_name`,
>    `idx_participant_event_created (event_id, created_at DESC, id DESC)` untuk paginasi
>    kursor, dan `uq_participant_qr_hash` (partial unique). Tidak ada lagi indeks non-unik
>    terpisah pada `qr_token_hash`: unique index memenuhi lookup sekaligus menjamin keunikan.
> 5. `event_label_config` dan `audit_log` dibuat di `0004_qr.sql`, lebih awal dari Fase 4,
>    karena keduanya dibutuhkan Tahap 4 (konfigurasi label dan jejak cetak).
>
> Migrasi berikutnya tidak boleh mengedit `0003`/`0004`; perubahan skema selalu lewat file baru.

> Nomor file aktual: `0001_init.sql`, `0002_auth.sql`, `0003_participants.sql`,
> `0004_qr.sql`, `0005_attendance_sync.sql`, `0006_self_signup.sql`,
> `0007_q1_activities_sessions.sql`, `0008_q2_categories_custom_fields.sql`,
> `0009_entitlement_rules.sql`, `0010_qr_identities.sql`. Perubahan berikutnya harus memakai
> `0011_*.sql` atau nomor berurutan berikutnya.

> **ADR-007 (`0006_self_signup.sql`) dan ADR-0013.** Satu kolom baru pada `users`:
>
> ```sql
> ALTER TABLE users ADD COLUMN created_via TEXT NOT NULL DEFAULT 'invite'
>   CHECK (created_via IN ('seed', 'invite', 'self_signup'));
> CREATE INDEX idx_users_created_via ON users(created_via, created_at);
> ```
>
> `DEFAULT 'invite'` menjaga baris lama tetap valid tanpa penulisan ulang tabel. Nilai
> `seed` dipakai untuk akun bootstrap superadmin, `invite` untuk aktivasi undangan. Nilai
> `self_signup` dipertahankan hanya karena `0006` sudah diterapkan di remote dan tidak boleh
> diedit; sejak ADR-0013 tidak ada jalur aplikasi yang menulisnya. Kolom ini **bukan**
> penanda kepercayaan: otorisasi tetap dihitung dari `users.role` + `event_memberships`.

File: `migrations/0005_attendance_sync.sql`

```sql
-- ───────────────────────────────────────────── konfigurasi sync per acara
CREATE TABLE sync_state (
  event_id        TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  spreadsheet_id  TEXT NOT NULL,
  sheet_tab       TEXT NOT NULL,
  sync_enabled    INTEGER NOT NULL DEFAULT 1 CHECK (sync_enabled IN (0,1)),
  schema_version  INTEGER NOT NULL DEFAULT 1,
  header_hash     TEXT,
  last_full_sync_at INTEGER,
  last_error      TEXT,
  updated_at      INTEGER NOT NULL
);

-- ───────────────────────────────────────────── peta baris sheet (ADR-004)
CREATE TABLE sheet_rows (
  event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  row_index      INTEGER NOT NULL,               -- 1-based, baris 1 = metadata
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (event_id, participant_id),
  UNIQUE (event_id, row_index)
);

-- ───────────────────────────────────────────── outbox
CREATE TABLE outbox (
  id             TEXT PRIMARY KEY,
  event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('attendance','participant','delete')),
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','inflight','done','failed','dead')),
  attempts       INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  claimed_at     INTEGER,
  last_error     TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

-- ⚠️ Kunci coalescing: satu peserta hanya perlu satu sinkronisasi tertunda.
CREATE UNIQUE INDEX uq_outbox_pending
  ON outbox(event_id, participant_id)
  WHERE status IN ('pending','inflight','failed');

CREATE INDEX idx_outbox_due ON outbox(status, next_attempt_at);
```

File: `migrations/0007_q1_activities_sessions.sql` (Q1, ADR-0009/0010/0012)

```sql
CREATE TABLE activities (
  id               TEXT PRIMARY KEY,
  theme_id         TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  name             TEXT NOT NULL,
  description      TEXT,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('attendance','consumption')),
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','active','completed','archived')),
  location         TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  created_by       TEXT REFERENCES users(id),
  updated_at       INTEGER NOT NULL,
  updated_by       TEXT REFERENCES users(id),
  archived_at      INTEGER,
  CHECK (length(name) BETWEEN 1 AND 120),
  CHECK (description IS NULL OR length(description) <= 500),
  CHECK (location IS NULL OR length(location) <= 200),
  CHECK (created_at > 0),
  CHECK (updated_at >= created_at),
  CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE INDEX idx_activities_theme_status ON activities(theme_id, status, sort_order);
CREATE INDEX idx_activities_theme_type   ON activities(theme_id, transaction_type);

CREATE TABLE activity_sessions (
  id          TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  location    TEXT,
  starts_at   INTEGER,
  ends_at     INTEGER,
  status      TEXT NOT NULL DEFAULT 'scheduled'
              CHECK (status IN ('scheduled','in_progress','completed','disabled')),
  archived_at INTEGER,
  created_at  INTEGER NOT NULL,
  created_by  TEXT REFERENCES users(id),
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT REFERENCES users(id),
  CHECK (length(name) BETWEEN 1 AND 120),
  CHECK (location IS NULL OR length(location) <= 200),
  CHECK (starts_at IS NULL OR starts_at > 0),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at),
  CHECK (created_at > 0),
  CHECK (updated_at >= created_at),
  CHECK (archived_at IS NULL OR archived_at > 0),
  CONSTRAINT archived_session_is_finished
    CHECK (archived_at IS NULL OR status IN ('completed','disabled'))
);
CREATE INDEX idx_activity_sessions_activity_status
  ON activity_sessions(activity_id, status, starts_at);
CREATE INDEX idx_activity_sessions_activity_time
  ON activity_sessions(activity_id, starts_at);
```

> **Catatan 0007.**
>
> 1. **`theme_id` menunjuk `events.id`.** `events` adalah Tema Acara (ADR-0009); Q1 tidak
>    mengganti nama tabel dan tidak memigrasikan data (`D-007` [A]).
> 2. **`ON DELETE RESTRICT`, bukan `CASCADE`.** Produk hanya mengarsipkan Aktivitas/Sesi;
>    menghapus Tema hanya boleh saat draf kosong. `DB.batch` audit tetap atomik.
> 3. **`archived` adalah status Aktivitas**, sedangkan arsip Sesi adalah `archived_at`
>    terpisah dari status operasional (`FR-206`, `BR-078`). `CHECK` menolak arsip Sesi yang
>    belum `completed`/`disabled`.
> 4. **Nama tabel `activity_sessions`.** `sessions` sudah dipakai auth (`0002_auth.sql`);
>    mencampurnya akan membuat query sesi login dan sesi acara tidak bisa dibedakan.
> 5. **Tidak ada `UNIQUE` nama.** Dua Aktivitas boleh bernama sama; identitas adalah `id`.
> 6. `transaction_type` tidak dapat diubah lewat API (schema update tidak memuatnya); nilai
>    di database tetap satu kolom karena tidak ada riwayat transaksi di Q1.

File: `migrations/0008_q2_categories_custom_fields.sql` (Q2, ADR-0014)

```sql
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
CREATE UNIQUE INDEX idx_custom_fields_theme_key ON custom_fields(theme_id, key);
CREATE INDEX idx_custom_fields_theme_scope_status
  ON custom_fields(theme_id, scope, status, sort_order);

ALTER TABLE participants ADD COLUMN category_id TEXT
  REFERENCES categories(id) ON DELETE RESTRICT;
ALTER TABLE participants ADD COLUMN attributes_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(attributes_json));
CREATE INDEX idx_participant_event_category ON participants(event_id, category_id);
```

Backfill satu kali (sebelum trigger dibuat):

```sql
INSERT INTO categories (id, theme_id, name, sort_order, status, created_at, updated_at)
SELECT 'cat-' || lower(hex(randomblob(16))), p.event_id, MIN(TRIM(p.category)), 0,
       'active', CAST(strftime('%s','now') AS INTEGER) * 1000,
       CAST(strftime('%s','now') AS INTEGER) * 1000
FROM participants p
WHERE p.category IS NOT NULL AND TRIM(p.category) <> ''
GROUP BY p.event_id, LOWER(TRIM(p.category));
```

Baris lama tanpa kategori mendapat satu wadah `Tanpa Kategori` per Tema. Trigger yang menegakkan aturan setelah backfill:

| Trigger | Aturan |
|---|---|
| `trg_participant_category_required_insert/update` | `category_id` tidak boleh NULL |
| `trg_participant_category_same_theme_insert/update` | Kategori wajib milik Tema yang sama |
| `trg_participant_category_mirror_insert/update` | `participants.category` diisi dari `categories.name` |
| `trg_category_name_mirror_update` | Rename kategori memperbarui mirror peserta |

> **Catatan 0008.**
>
> 1. `participants.category` lama **tidak dihapus**; kolom itu menjadi mirror tampilan yang
>    dijaga trigger. Sumber kebenaran adalah `category_id` + `categories.name`.
> 2. `category_id` secara fisik nullable karena SQLite tidak bisa menambah kolom `NOT NULL`
>    pada tabel berisi data dengan nilai berbeda per baris. Kewajiban ditegakkan trigger
>    `BEFORE INSERT`/`BEFORE UPDATE OF category_id`, bukan hanya kode aplikasi.
> 3. `attributes_json` menyimpan nilai custom field per peserta sebagai satu objek JSON;
>    tidak ada tabel EAV dan tidak ada indeks per field pada Q2 (ADR-0014).
> 4. `custom_fields.key` imutabel dan unik termasuk baris terarsip; `label` yang boleh
>    di-rename. `options_json` tidak masuk audit karena berisi teks bebas.
> 5. Batas 50 field aktif dan 100 opsi ditegakkan di Worker (`422 BUSINESS_RULE`), bukan
>    constraint database.
> 6. Field `scope='activity'` boleh didefinisikan di Q2, tetapi nilainya tidak diterima di
>    `participants.attributes_json` (Q3).

File: `migrations/0009_entitlement_rules.sql` (Q3, ADR-0016, `D-005`)

```sql
CREATE TABLE entitlement_rules (
  id             TEXT PRIMARY KEY,
  theme_id       TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  activity_id    TEXT REFERENCES activities(id) ON DELETE RESTRICT,
  session_id     TEXT REFERENCES activity_sessions(id) ON DELETE RESTRICT,
  participant_id TEXT REFERENCES participants(id) ON DELETE RESTRICT,
  category_id    TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  status         TEXT NOT NULL CHECK (status IN ('inherit','allowed','denied')),
  created_at     INTEGER NOT NULL,
  created_by     TEXT REFERENCES users(id),
  updated_at     INTEGER NOT NULL,
  updated_by     TEXT REFERENCES users(id),
  CHECK (created_at > 0),
  CHECK (updated_at >= created_at),
  CHECK (session_id IS NULL OR activity_id IS NOT NULL),
  CHECK (
    (activity_id IS NULL AND session_id IS NULL
     AND participant_id IS NULL AND category_id IS NULL)          -- Theme default
    OR
    (activity_id IS NOT NULL
     AND ((participant_id IS NOT NULL) <> (category_id IS NOT NULL)))  -- level 1–4
  )
);

CREATE UNIQUE INDEX uq_ent_theme_default ON entitlement_rules(theme_id)
  WHERE activity_id IS NULL AND session_id IS NULL
    AND participant_id IS NULL AND category_id IS NULL;
CREATE UNIQUE INDEX uq_ent_individual_activity
  ON entitlement_rules(theme_id, participant_id, activity_id)
  WHERE participant_id IS NOT NULL AND activity_id IS NOT NULL AND session_id IS NULL;
CREATE UNIQUE INDEX uq_ent_category_activity
  ON entitlement_rules(theme_id, category_id, activity_id)
  WHERE category_id IS NOT NULL AND activity_id IS NOT NULL AND session_id IS NULL;
CREATE UNIQUE INDEX uq_ent_individual_session
  ON entitlement_rules(theme_id, participant_id, activity_id, session_id)
  WHERE participant_id IS NOT NULL AND activity_id IS NOT NULL AND session_id IS NOT NULL;
CREATE UNIQUE INDEX uq_ent_category_session
  ON entitlement_rules(theme_id, category_id, activity_id, session_id)
  WHERE category_id IS NOT NULL AND activity_id IS NOT NULL AND session_id IS NOT NULL;
```

Tingkat dibaca dari kombinasi kolom:

| Tingkat | `activity_id` | `session_id` | `participant_id` | `category_id` |
|---|---|---|---|---|
| Individual–Session | NOT NULL | NOT NULL | NOT NULL | NULL |
| Category–Session | NOT NULL | NOT NULL | NULL | NOT NULL |
| Individual–Activity | NOT NULL | NULL | NOT NULL | NULL |
| Category–Activity | NOT NULL | NULL | NULL | NOT NULL |
| Theme default | NULL | NULL | NULL | NULL |

Trigger `trg_entitlement_context_insert` dan
`trg_entitlement_context_update` (`BEFORE UPDATE OF theme_id, activity_id, session_id,
participant_id, category_id`) menolak: kategori/peserta/Aktivitas dari Tema lain, Sesi yang bukan
milik Aktivitas, Theme default yang membawa konteks, dan aturan Aktivitas yang tidak punya tepat
satu subjek (peserta XOR kategori). Route memvalidasi hal yang sama lebih dulu agar pesan ke
admin jelas; trigger adalah pertahanan terakhir untuk SQL langsung.

Backfill satu kali (antara penanda `-- >>> backfill` / `-- <<< backfill`, diuji apa adanya oleh
`entitlements.db.test.ts`):

```sql
INSERT INTO entitlement_rules (
  id, theme_id, activity_id, session_id, participant_id, category_id,
  status, created_at, created_by, updated_at, updated_by
)
SELECT lower(hex(randomblob(16))),
       a.theme_id, a.id, NULL, NULL, c.id, 'allowed',
       CAST(strftime('%s','now') AS INTEGER) * 1000, NULL,
       CAST(strftime('%s','now') AS INTEGER) * 1000, NULL
FROM activities a
JOIN categories c ON c.theme_id = a.theme_id
WHERE a.status = 'active'
  AND (c.status = 'active'
       OR EXISTS (SELECT 1 FROM participants p WHERE p.category_id = c.id))
  AND NOT EXISTS (
    SELECT 1 FROM entitlement_rules r
     WHERE r.theme_id = a.theme_id AND r.activity_id = a.id
       AND r.category_id = c.id AND r.session_id IS NULL
       AND r.participant_id IS NULL
  );
```

> **Catatan 0009.**
>
> 1. **Satu tabel, bukan lima.** Tingkat adalah kombinasi kolom; tidak ada kolom enum tingkat
>    yang bisa tidak sinkron dengan kolom konteks.
> 2. **Lima partial unique index**, satu per tingkat, karena SQLite menganggap `NULL` berbeda
>    di unique index. Predikatnya diulang persis oleh query resolver agar setiap cabang
>    `UNION ALL` menjadi `SEARCH ... USING INDEX`.
> 3. **Default deny bukan baris.** Tidak adanya aturan yang menentukan adalah hasil resolver,
>    bukan baris `denied` yang harus dipelihara.
> 4. **Backfill hanya Aktivitas `active`.** Aktivitas `draft` sengaja tidak di-backfill agar
>    gate `draft → active` (`FR-040`/`FR-041`) tetap bermakna. Kategori arsip yang masih punya
>    peserta ikut di-backfill agar riwayat lama tidak berubah saat Q5 menegakkan resolver.
> 5. **Backfill tidak menulis audit** karena migrasi bukan aksi admin. Ini pengecualian yang
>    dicatat, bukan pola untuk mutasi runtime.
> 6. **`ON DELETE RESTRICT`** menjaga aturan tidak kehilangan konteks; penghapusan Tema yang
>    masih punya aturan ditolak. Produk mengarsipkan, bukan menghapus.
> 7. Perubahan aturan **tidak** menyalin atau mengubah transaksi historis (`FR-199`, `BR-075`).

File: `migrations/0010_qr_identities.sql` (Q4, ADR-0017, `D-004`)

```sql
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

CREATE UNIQUE INDEX uq_qr_identity_participant
  ON qr_identities(theme_id, participant_id);
CREATE UNIQUE INDEX uq_qr_identity_hash
  ON qr_identities(token_hash);
```

Trigger `trg_qr_identity_context_insert` dan `trg_qr_identity_context_update`
(`BEFORE UPDATE OF theme_id, participant_id`) menolak peserta yang bukan milik Tema baris itu.
Route juga memvalidasi scope Tema lebih dulu agar pesan ke admin jelas.

Backfill satu kali (`-- >>> backfill` / `-- <<< backfill`), hanya kredensial lengkap:

```sql
INSERT INTO qr_identities (
  id, theme_id, participant_id, token_hash, ciphertext, nonce, key_version,
  issued_at, rotated_at, rotation_count
)
SELECT lower(hex(randomblob(16))),
       p.event_id, p.id, p.qr_token_hash, p.qr_token_ciphertext, p.qr_token_nonce,
       p.qr_key_version, p.qr_issued_at, NULL, 0
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
```

> **Catatan 0010.**
>
> 1. **Satu baris aktif per Tema + Peserta**, ditegakkan `uq_qr_identity_participant` — bukan
>    cek baca-lalu-tulis di Worker. Rotasi mengganti kredensial **di baris yang sama** sehingga
>    `id` stabil untuk referensi transaksi Q5 (`FR-060`).
> 2. **Riwayat rotasi di audit, bukan di tabel.** `rotation_count` + `rotated_at` cukup untuk
>    metadata; token lama tidak pernah disimpan (`D-023`, ADR-0008).
> 3. **Backfill menyalin token apa adanya**, jadi kartu yang sudah tercetak tetap sah. Kode
>    juga mempromosikan baris lama saat pertama kali dibaca selama jendela deploy. Backfill
>    tidak menulis audit karena migrasi bukan aksi admin.
> 4. **Kolom `participants.qr_*` belum dihapus.** Penghapusan lewat migrasi contract terpisah
>    setelah Q4 stabil (ADR-0017 sub-keputusan 5); migrasi ini additive.
> 5. **`ON DELETE RESTRICT`** menjaga kredensial yang menjadi jangkar riwayat tidak hilang saat
>    peserta/Tema dihapus. Produk mengarsipkan, bukan menghapus.
> 6. **Lookup scan** memakai `uq_qr_identity_hash`: satu `SEARCH ... USING INDEX` lalu join
>    primary-key ke `participants`. Scope Tema dibaca dari `qr_identities.theme_id`.

---

## 4. Indeks: alasan dan biaya

Setiap indeks menambah baris tulis. Indeks di bawah dipilih karena setiap halaman UI dan setiap scan bergantung padanya. **Jangan menambah indeks tanpa query yang jelas membutuhkannya.**

| Indeks | Query yang dilayani |
|---|---|
| `uq_participant_ref` (partial) | Idempotensi import CSV |
| `idx_participant_event_name` | Daftar/pencarian peserta per acara |
| `idx_participant_event_created` | Paginasi kursor `(created_at DESC, id DESC)` |
| `uq_participant_qr_hash` (partial unique) | Lookup scan + menjamin satu kredensial satu peserta |
| `idx_audit_event_time` / `idx_audit_actor_time` / `idx_audit_action` | Riwayat audit per acara/pelaku/aksi |
| `idx_attendance_event_time` | Rekap kronologis |
| `idx_attendance_event_stat` | Hitungan per status |
| `idx_membership_*` | Cek otorisasi (setiap request) |
| `idx_session_token` (UNIQUE implisit) | Verifikasi sesi |
| `idx_outbox_due` | Cron mengambil antrean |
| `uq_outbox_pending` (partial) | Coalescing + mencegah duplikasi item |
| `idx_activities_theme_status` | Daftar Aktivitas per Tema terurut |
| `idx_activities_theme_type` | Filter/kuota per tipe transaksi (dipakai Q5) |
| `idx_activity_sessions_activity_status` | Daftar Sesi per Aktivitas + status |
| `idx_activity_sessions_activity_time` | Urutan Sesi berdasarkan `starts_at` |
| `idx_categories_theme_name` (UNIQUE) | Nama kategori unik per Tema (case-insensitive) |
| `idx_categories_theme_status` | Daftar kategori per status/urutan |
| `idx_custom_fields_theme_key` (UNIQUE) | Key custom field unik per Tema |
| `idx_custom_fields_theme_scope_status` | Katalog field per scope/status/urutan |
| `idx_participant_event_category` | Jumlah peserta per kategori dan filter kategori |
| `uq_ent_*` (5 partial unique, `0009`) | Satu sel per tingkat; dipakai resolver untuk `SEARCH` per cabang `UNION ALL` |
| `uq_qr_identity_participant` (`0010`) | Satu identitas per Tema + Peserta; `ON CONFLICT` penerbitan lazy |
| `uq_qr_identity_hash` (`0010`) | Lookup scan satu `SEARCH`; menjamin hash hanya milik satu identitas |

**Wajib diverifikasi di Fase 0**: jalankan semua query utama dengan `EXPLAIN QUERY PLAN` dan pastikan memakai indeks (`SEARCH ... USING INDEX`), bukan `SCAN`.

---

## 5. Integritas: bagaimana setiap aturan ditegakkan

| Aturan | Ditegakkan oleh | Tes yang membuktikannya |
|---|---|---|
| Absensi ganda mustahil (baseline; **Delta**: target per transaksi efektif per ruang lingkup, AQ-003) | `UNIQUE (event_id, participant_id)` — jangan dilepas sebelum constraint pengganti teruji | `scan.duplicate.test.ts` — dua scan paralel, satu `present` satu `duplicate` |
| Scan lintas acara ditolak | `qr_identities.theme_id` diperiksa sebelum status peserta (Q4); jalur baseline tetap `WHERE event_id = ?` | `qr-identity.db.test.ts`, `qr-identity.api.test.ts`, `scan.test.ts` |
| Audit tidak bisa diubah | Trigger `RAISE(ABORT)` | `audit.immutable.test.ts` — `UPDATE`/`DELETE` harus error |
| Satu undangan satu pemakaian | `used_at` + cek dalam transaksi batch | `invite.replay.test.ts` |
| Import CSV idempoten | `ON CONFLICT (event_id, external_ref) WHERE external_ref IS NOT NULL DO UPDATE` | `participants.import.test.ts` |
| Peserta tidak bisa diakses lintas acara | Semua query `WHERE event_id = ? AND id = ?` | `participants.crud.test.ts` |
| Soft-delete tidak menghapus data | `UPDATE status = 'inactive'`, restore lewat PATCH | `participants.crud.test.ts` |
| Tidak ada outbox duplikat | `uq_outbox_pending` (partial unique) | `outbox.coalesce.test.ts` |
| Satu kredensial QR hanya milik satu peserta | Q4: `uq_qr_identity_participant`; baseline: `uq_participant_qr_hash` (partial unique) | `qr-identity.db.test.ts`, `qr.db.test.ts` |
| Kredensial tidak pernah ditimpa saat cetak ulang | Q4: `INSERT ... ON CONFLICT DO NOTHING` + baca ulang; baseline: `UPDATE ... WHERE qr_token_hash IS NULL` | `qr-identity.db.test.ts`, `labels.api.test.ts` — QR sama pada cetak ulang |
| Kredensial utuh (hash + ciphertext + nonce + versi) | Per-kolom `CHECK` + kode menulis kelimanya sekaligus | `qr-identity.db.test.ts`, `qr.db.test.ts` — nilai cacat ditolak |
| Import CSV tidak merotasi QR | `ON CONFLICT ... DO UPDATE` tidak menyentuh kredensial | `qr.db.test.ts`, `labels.api.test.ts` — kredensial bertahan setelah upsert |
| Audit tidak bisa diubah/dihapus | Trigger `RAISE(ABORT)` | `qr.db.test.ts` — `UPDATE`/`DELETE` gagal |
| Aktivitas/Sesi tidak bisa lintas Tema | `findActivity` scope `theme_id`, `findActivitySession` scope `activity_id` | `activities.api.test.ts`, `activity-sessions.api.test.ts` |
| Sesi hanya bisa diarsipkan setelah selesai/dinonaktifkan | `CHECK archived_session_is_finished` + `WHERE status IN (...)` | `activity-sessions.api.test.ts` |
| Tema berisi Aktivitas tidak bisa di-hard-delete | `NOT EXISTS (SELECT 1 FROM activities ...)` di statement yang sama | `activities.api.test.ts` |
| Mutasi Aktivitas/Sesi pada Tema terarsip ditolak | `requireMutableEvent` (Worker) | `activities.api.test.ts` |
| Audit hanya tertulis bila mutasi mendarat | `INSERT ... WHERE EXISTS (updated_at = ?)` dalam `db.batch` | `activities.api.test.ts`, `activity-sessions.api.test.ts`, `categories.api.test.ts`, `custom-fields.api.test.ts`, `audit.guarded-write.test.ts` |
| Peserta wajib punya kategori | Trigger `BEFORE INSERT`/`BEFORE UPDATE OF category_id` | `participants.crud.test.ts`, `participant-attributes.api.test.ts` |
| Kategori peserta tidak boleh lintas Tema | Trigger `same_theme_*` + scope `theme_id` di query | `participant-attributes.api.test.ts` |
| Nama kategori unik per Tema (case-insensitive) | `idx_categories_theme_name` + cek 409 | `categories.api.test.ts` |
| Custom field tidak bisa dihapus permanen | Tidak ada route DELETE; arsip lewat status | `custom-fields.api.test.ts`, `authz.unauthenticated.test.ts` |
| Nilai atribut tidak valid / field asing tidak tersimpan | `validateParticipantAttributes` + `CHECK json_valid` | `participant-attributes.test.ts`, `participant-attributes.api.test.ts` |
| Rename/arsip field tidak menghapus nilai peserta | Nilai hidup di `attributes_json`, katalog terpisah | `custom-fields.api.test.ts` |
| Satu sel entitlement per tingkat | `uq_ent_*` (5 partial unique) + guard `updated_at` | `entitlements.db.test.ts` — tes insert duplikat langsung |
| Aturan entitlement tidak bisa lintas Tema/Aktivitas/Sesi | Trigger `trg_entitlement_context_*` + scope `theme_id` di query | `entitlements.db.test.ts` — 4 tes trigger; `entitlements.api.test.ts` — id lintas Tema/Sesi → 404 |
| Theme default hanya satu per Tema | `uq_ent_theme_default` | `entitlements.db.test.ts` — "allows exactly one theme default per Tema" |
| Resolver selalu default deny dan prioritas tetap | `resolveEntitlement` murni + `ENTITLEMENT_PRIORITY` | `packages/shared/src/entitlements.test.ts` — tabel 5 tingkat × 3 status |
| Aktivitas aktif hanya bila semua kategori aktif punya aturan | `getEntitlementCompleteness` + gate `draft → active` | `entitlements.api.test.ts` — gate dan kategori baru fail-closed |
| Override individual tidak hilang saat kategori peserta berubah | Baris individual terpisah dari baris kategori | `entitlements.api.test.ts` — "preserves an individual override…" |
| Audit entitlement hanya tertulis bila mutasi mendarat | `INSERT ... WHERE EXISTS (updated_at = ?)` / `NOT EXISTS` di `db.batch` | `audit.guarded-write.test.ts` — update dan delete |
| Snapshot audit entitlement tanpa PII | Allowlist `entitlement_rule` (6 field) | `entitlements.api.test.ts` — "stores only rule coordinates and status" |
| Satu QR Identity per Tema + Peserta | `uq_qr_identity_participant` + `ON CONFLICT DO NOTHING` | `qr-identity.db.test.ts` — insert kedua ditolak; helper balapan `changes = 0` |
| QR tidak bisa dipakai lintas Tema | `qr_identities.theme_id` diperiksa sebelum status peserta | `qr-identity.db.test.ts`, `qr-identity.api.test.ts`, `packages/shared/src/qr.test.ts` |
| Token lama mati setelah rotasi | `UPDATE` in-place pada `uq_qr_identity_hash` | `qr-identity.db.test.ts` — hash lama tidak ditemukan; `qr-identity.api.test.ts` — scan `not_found` |
| Rotasi paralel hanya satu yang mendarat | Guard `rotation_count` + audit `WHERE token_hash = ?` | `qr-identity.api.test.ts` — satu `200`, satu `409`, satu audit |
| Riwayat transaksi tidak berubah karena rotasi | Tidak ada UPDATE/DELETE pada `attendance` | `qr-identity.api.test.ts` — jumlah absensi tetap |
| Identitas tidak bisa lintas Tema di level database | Trigger `trg_qr_identity_context_*` | `qr-identity.db.test.ts` — insert lintas Tema error |
| Metadata/rotasi tidak membocorkan kredensial | Respons & allowlist audit tanpa token/hash/ciphertext/nonce | `qr-identity.api.test.ts`, `audit-allowlist.test.ts` |

---

## 6. Outbox: perilaku detail

### Siklus status

```
                 ┌─────────── gagal (attempts < 8) ───────────┐
                 ▼                                            │
  pending ──claim──> inflight ──sukses──> done                │
     ▲                  │                                     │
     └──────────────────┴──gagal (attempts = 8)──> dead ──────┘ (manual retry)
```

- `pending`: menunggu. `next_attempt_at` menentukan kapan boleh diambil.
- `inflight`: sedang dikerjakan cron. `claimed_at` dipakai untuk **reklaim** item yang macet (cron mati di tengah jalan) setelah 10 menit tanpa progres.
- `failed`: percobaan gagal, akan dicoba lagi; tetap menempati slot unique sehingga item baru untuk peserta yang sama akan meng-*update* baris yang sama (coalescing).
- `done`: selesai. **Baris `done` dipangkas** oleh cron setelah 7 hari agar tabel tidak tumbuh tanpa batas.
- `dead`: menyerah setelah 8 percobaan. Muncul di dashboard, bisa di-retry manual oleh admin.

### Coalescing

Unique index parsial `uq_outbox_pending` membuat penulisan berikutnya memakai:

```sql
INSERT INTO outbox (...) VALUES (...)
ON CONFLICT (event_id, participant_id) WHERE status IN ('pending','inflight','failed')
DO UPDATE SET
  status = 'pending',
  attempts = 0,
  next_attempt_at = excluded.next_attempt_at,
  updated_at = excluded.updated_at;
```

> ⚠️ **Ditemukan di Fase 0 dan sudah diverifikasi**: predikat `WHERE status IN (...)`
> pada klausa `ON CONFLICT` **wajib**. Tanpa predikat itu SQLite menolak dengan
> `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`, karena
> `uq_outbox_pending` adalah indeks parsial. Dikunci oleh `spike.index.test.ts`
> (tes positif dan negatif). Lihat `docs/OPERASIONAL.md` §4.1.

Hasilnya: 10 koreksi berturut-turut pada satu peserta = **satu** item antrean, karena yang perlu disinkronkan hanyalah keadaan akhir (ADR-004: proyeksi, bukan log).

### Backoff

`delay = min(2^attempts × 30 detik, 30 menit) + jitter(0–30 detik)`

Dengan `attempts` mulai dari 1. Jitter mencegah semua item jatuh tempo bersamaan.

### Kegagalan yang tidak boleh di-retry

Error 4xx dari Google (kecuali 429 dan 403 rate-limit) menandakan masalah permanen: spreadsheet tidak ada, bukan Editor, tab tidak ada. Item langsung ditandai `dead` dengan `last_error` yang bisa dibaca manusia; retry otomatis akan sia-sia dan hanya membakar kuota.

---

## 7. Strategi migrasi

### Aturan

1. File di `migrations/` bernomor urut: `0001_init.sql`, `0002_auth.sql`,
   `0003_participants.sql`, `0004_qr.sql`, `0005_attendance_sync.sql`, dst. Nomor yang sudah dipakai
   tidak boleh dipakai ulang walau isinya dihapus dari rencana.
2. **File yang sudah pernah diaplikasikan (termasuk di lokal) tidak boleh diedit.** Perubahan selalu file baru.
3. Setiap migrasi harus **idempoten-sempurna** dalam arti: berhasil dijalankan pada database kosong.
4. Migrasi tidak boleh bergantung pada data yang dibuat di luar migrasi.
5. `wrangler d1 migrations apply` mencatat riwayat di tabel `d1_migrations` — jangan menyentuh tabel itu secara manual.

### Perubahan skema yang merusak (SQLite)

D1 memakai SQLite yang `ALTER TABLE`-nya terbatas. Untuk mengubah/menghapus kolom atau mengubah constraint, gunakan pola rebuild:

```sql
PRAGMA defer_foreign_keys = true;
CREATE TABLE attendance_new (...);
INSERT INTO attendance_new SELECT ... FROM attendance;
DROP TABLE attendance;
ALTER TABLE attendance_new RENAME TO attendance;
-- indeks harus dibuat ulang setelah rename
CREATE INDEX idx_attendance_event_time ON attendance(event_id, checked_in_at);
```

⚠️ `PRAGMA foreign_keys` tidak dapat diubah di tengah transaksi; gunakan `defer_foreign_keys` sesuai dokumentasi D1. Pola ini **wajib** diuji di lokal pada database yang sudah berisi data sebelum menyentuh remote.

### Alur kerja

```bash
# 1. buat file kosong
npx wrangler d1 migrations create absensi-db add_participant_category

# 2. isi SQL, lalu uji pada DB lokal kosong
npm run db:reset:local

# 3. uji upgrade: restore snapshot produksi terbaru ke lokal, lalu migrate
npm run db:migrate:local

# 4. jalankan seluruh tes integrasi
npm run test

# 5. HANYA setelah konfirmasi eksplisit pemilik proyek
npm run db:migrate:remote
```

### Snapshot sebelum migrasi remote

`wrangler d1 export` (atau Time Travel, retensi 7 hari pada Free) dipakai untuk mengambil cadangan sebelum `--remote`. Retensi Time Travel 7 hari adalah pengaman terakhir, bukan pengganti backup.

---

## 8. Anggaran ukuran dan pertumbuhan

Perkiraan kasar per baris (termasuk overhead indeks):

| Tabel | Ukuran/baris | 50.000 peserta | Catatan |
|---|---|---|---|
| `participants` | ~400 B + 4 indeks | ~120 MB | Indeks: token, event+name, unique ref |
| `attendance` | ~250 B + 2 indeks | ~60 MB | Satu baris per peserta |
| `audit_log` | ~600 B + 3 indeks | ~150 MB (250k baris) | **Tumbuh paling cepat** |
| `outbox` | ~350 B | kecil setelah pruning | `done` dipangkas 7 hari |
| `entitlement_rules` | ~300 B + 5 indeks parsial | kecil–sedang | Satu baris per sel yang dikonfigurasi; backfill lama = Aktivitas aktif × kategori |
| `sessions` | ~300 B | kecil | Pangkas sesi kedaluwarsa |

Kesimpulan: **satu database 500 MB cukup untuk puluhan ribu peserta**, tetapi `audit_log` adalah penentu umur database.

### Kebijakan retensi audit (wajib, bukan opsional)

- Audit log **tidak pernah** dihapus oleh aplikasi biasa (trigger melarang).
- Prosedur arsip: `superadmin` mengekspor rentang tanggal ke file JSON/NDJSON, menyimpannya di luar sistem, lalu menjalankan **satu** operasi `DELETE` khusus yang menonaktifkan trigger sementara dan mencatat entri `audit.archived` berisi jumlah baris + hash file arsip.
- ⚠️ Mekanisme mengizinkan `DELETE` selektif sambil mempertahankan sifat append-only untuk semua jalur lain perlu didesain hati-hati di Fase 4 (mis. trigger mengizinkan delete hanya jika `audit_log.allow_purge` sementara di-set lewat tabel kontrol). Alternatif yang lebih aman: **partisi per acara** — arsipkan seluruh acara lama beserta audit-nya.
- Ambang peringatan: dashboard menampilkan ukuran DB; peringatan pada 350 MB.

---

## 9. Verifikasi skema dan platform

| # | Yang perlu dibuktikan | Cara | Status terkini |
|---|---|---|---|
| 1 | `db.batch()` benar-benar atomik (rollback semua bila satu statement gagal) | Tes: batch dengan statement kedua melanggar constraint, pastikan statement pertama tidak tersimpan | ✅ Terverifikasi — `spike.batch.test.ts` (statement ke-2 gagal → statement ke-1 hilang) |
| 2 | `meta.changes` akurat untuk `INSERT ... ON CONFLICT DO NOTHING` | Tes unit + integrasi | ✅ Terverifikasi melalui tes scan/attendance yang memeriksa hasil insert idempoten |
| 3 | Partial unique index didukung D1 | Migrasi lokal + tes insert duplikat | ✅ Terverifikasi — `spike.index.test.ts` memakai tabel sekali-pakai `spike_outbox` dengan bentuk & indeks identik. **Catatan**: `ON CONFLICT` wajib mengulang predikat indeks (§6) |
| 4 | Trigger `RAISE(ABORT)` berjalan normal di D1 | `apps/api/src/test/qr.db.test.ts` | ✅ Terverifikasi; UPDATE/DELETE ditolak oleh trigger |
| 5 | `EXPLAIN QUERY PLAN` menampilkan `SEARCH` untuk semua query utama | Skrip pemeriksaan indeks | ✅ Terverifikasi — `spike.explain.test.ts`, 10/10 query memakai `SEARCH ... USING INDEX` (tabel sekali-pakai) + `app_meta` yang nyata. Query resolver entitlement: 5/5 cabang dengan Sesi dan 3/3 tanpa Sesi `SEARCH`, tanpa `SCAN` (`entitlements.db.test.ts`) |
| 6 | Ukuran nyata per baris | `SELECT SUM(pgsize) FROM dbstat` bila tersedia, atau `wrangler d1 export` + hitung file | ⬜ **Belum** — `dbstat` tidak tersedia di D1; perlu data nyata + `wrangler d1 export` (Fase 2, setelah import peserta) |

Detail angka dan quirk lingkungan ada di `docs/OPERASIONAL.md` §1–§2.
