# DESAIN DATABASE — D1 (SQLite)

Database: Cloudflare D1, binding `DB`. Dialek **SQLite**, bukan Postgres.

Batasan platform yang membentuk skema ini (terverifikasi, lihat [`../COSTS_AND_LIMITS.md`](../COSTS_AND_LIMITS.md)):

- Maksimum **500 MB per database** pada Workers Free.
- **100.000 baris tulis/hari**, **5.000.000 baris baca/hari** pada Workers Free.
- Setiap indeks menambah **satu baris tulis** per `INSERT`/`UPDATE` pada kolom terindeks.
- Maksimum **100 kolom per tabel**, **100 parameter terikat per query**, **100 KB per statement SQL**.
- D1 tidak punya transaksi interaktif; atomisitas lewat `db.batch()` ⚠️ (perilaku rollback batch harus dikonfirmasi dengan tes di Fase 0).

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
         ├──< participants ──┬──< attendance (1:1 per acara)
         │                   └──< sheet_rows (1:1)
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

> ⚠️ **Ini desain TARGET, bukan keadaan database sekarang.** Per 31 Oktober 2026,
> `migrations/0001_init.sql` hanya membuat satu tabel: `app_meta`. Semua tabel di
> bawah dibuat pada tahap yang membutuhkannya (Tahap 2: `users`, `events`,
> `event_memberships`; Tahap 3: `participants`; Tahap 4: kolom QR, `event_label_config`,
> `audit_log`; Tahap 5: `attendance`; Fase 5: `sync_state`, `sheet_rows`, `outbox`).
> Alasan pemangkasan:
> `docs/OPERASIONAL.md` §4.3. Pecah DDL ini menjadi migrasi per fase — **jangan**
> menyalin seluruh blok ini ke satu file.

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

> **Deviasi implementasi (Tahap 3–4).** Blok DDL di atas adalah desain target; yang
> berjalan sekarang, setelah `migrations/0003_participants.sql` dan `migrations/0004_qr.sql`:
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

> Nomor file aktual saat ini: `0001_init.sql`, `0002_auth.sql`, `0003_participants.sql`,
> `0004_qr.sql`. Blok sinkronisasi di bawah tetap desain target; kalau dikerjakan pada
> Tahap 5, filenya menjadi `0005_sync.sql` (nomor tidak boleh dipakai ulang).

File: `migrations/0005_sync.sql`

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

**Wajib diverifikasi di Fase 0**: jalankan semua query utama dengan `EXPLAIN QUERY PLAN` dan pastikan memakai indeks (`SEARCH ... USING INDEX`), bukan `SCAN`.

---

## 5. Integritas: bagaimana setiap aturan ditegakkan

| Aturan | Ditegakkan oleh | Tes yang membuktikannya |
|---|---|---|
| Absensi ganda mustahil | `UNIQUE (event_id, participant_id)` | `scan.duplicate.test.ts` — dua scan paralel, satu `present` satu `duplicate` |
| Scan lintas acara ditolak | Query selalu `WHERE event_id = ?` | `scan.cross-event.test.ts` |
| Audit tidak bisa diubah | Trigger `RAISE(ABORT)` | `audit.immutable.test.ts` — `UPDATE`/`DELETE` harus error |
| Satu undangan satu pemakaian | `used_at` + cek dalam transaksi batch | `invite.replay.test.ts` |
| Import CSV idempoten | `ON CONFLICT (event_id, external_ref) WHERE external_ref IS NOT NULL DO UPDATE` | `participants.import.test.ts` |
| Peserta tidak bisa diakses lintas acara | Semua query `WHERE event_id = ? AND id = ?` | `participants.crud.test.ts` |
| Soft-delete tidak menghapus data | `UPDATE status = 'inactive'`, restore lewat PATCH | `participants.crud.test.ts` |
| Tidak ada outbox duplikat | `uq_outbox_pending` (partial unique) | `outbox.coalesce.test.ts` |
| Satu kredensial QR hanya milik satu peserta | `uq_participant_qr_hash` (partial unique) | `qr.db.test.ts` — hash yang sama pada peserta lain ditolak |
| Kredensial tidak pernah ditimpa saat cetak ulang | `UPDATE ... WHERE qr_token_hash IS NULL` | `qr.db.test.ts` — klaim kedua `changes = 0`; `labels.api.test.ts` — QR sama pada cetak ulang |
| Kredensial utuh (hash + ciphertext + nonce + versi) | Per-kolom `CHECK` + kode menulis kelimanya sekaligus | `qr.db.test.ts` — nilai cacat ditolak |
| Import CSV tidak merotasi QR | `ON CONFLICT ... DO UPDATE` tidak menyentuh kolom QR | `qr.db.test.ts` — kredensial bertahan setelah upsert |
| Audit tidak bisa diubah/dihapus | Trigger `RAISE(ABORT)` | `qr.db.test.ts` — `UPDATE`/`DELETE` gagal |

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
   `0003_participants.sql`, `0004_qr.sql`, `0005_sync.sql`, dst. Nomor yang sudah dipakai
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
| `sessions` | ~300 B | kecil | Pangkas sesi kedaluwarsa |

Kesimpulan: **satu database 500 MB cukup untuk puluhan ribu peserta**, tetapi `audit_log` adalah penentu umur database.

### Kebijakan retensi audit (wajib, bukan opsional)

- Audit log **tidak pernah** dihapus oleh aplikasi biasa (trigger melarang).
- Prosedur arsip: `superadmin` mengekspor rentang tanggal ke file JSON/NDJSON, menyimpannya di luar sistem, lalu menjalankan **satu** operasi `DELETE` khusus yang menonaktifkan trigger sementara dan mencatat entri `audit.archived` berisi jumlah baris + hash file arsip.
- ⚠️ Mekanisme mengizinkan `DELETE` selektif sambil mempertahankan sifat append-only untuk semua jalur lain perlu didesain hati-hati di Fase 4 (mis. trigger mengizinkan delete hanya jika `audit_log.allow_purge` sementara di-set lewat tabel kontrol). Alternatif yang lebih aman: **partisi per acara** — arsipkan seluruh acara lama beserta audit-nya.
- Ambang peringatan: dashboard menampilkan ukuran DB; peringatan pada 350 MB.

---

## 9. Hal yang perlu diverifikasi saat implementasi

| # | Yang perlu dibuktikan | Cara | Status Fase 0 |
|---|---|---|---|
| 1 | `db.batch()` benar-benar atomik (rollback semua bila satu statement gagal) | Tes: batch dengan statement kedua melanggar constraint, pastikan statement pertama tidak tersimpan | ✅ Terverifikasi — `spike.batch.test.ts` (statement ke-2 gagal → statement ke-1 hilang) |
| 2 | `meta.changes` akurat untuk `INSERT ... ON CONFLICT DO NOTHING` | Tes unit + integrasi | ⬜ **Belum** — tabel tujuan belum ada. Diverifikasi di Fase 3 bersama `attendance`, karena itulah satu-satunya tempat pola ini dipakai |
| 3 | Partial unique index didukung D1 | Migrasi lokal + tes insert duplikat | ✅ Terverifikasi — `spike.index.test.ts` memakai tabel sekali-pakai `spike_outbox` dengan bentuk & indeks identik. **Catatan**: `ON CONFLICT` wajib mengulang predikat indeks (§6) |
| 4 | Trigger `RAISE(ABORT)` berjalan normal di D1 | Tes `audit.immutable.test.ts` | ⬜ **Belum** — trigger audit ikut dihapus saat skema dipangkas (`docs/OPERASIONAL.md` §4.3). Diverifikasi di Fase 4 |
| 5 | `EXPLAIN QUERY PLAN` menampilkan `SEARCH` untuk semua query utama | Skrip pemeriksaan indeks | ✅ Terverifikasi — `spike.explain.test.ts`, 10/10 query memakai `SEARCH ... USING INDEX` (tabel sekali-pakai) + `app_meta` yang nyata |
| 6 | Ukuran nyata per baris | `SELECT SUM(pgsize) FROM dbstat` bila tersedia, atau `wrangler d1 export` + hitung file | ⬜ **Belum** — `dbstat` tidak tersedia di D1; perlu data nyata + `wrangler d1 export` (Fase 2, setelah import peserta) |

Detail angka dan quirk lingkungan ada di `docs/OPERASIONAL.md` §1–§2.
