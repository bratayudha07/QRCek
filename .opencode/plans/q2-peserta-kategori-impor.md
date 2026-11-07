# Rencana Q2 — Peserta, kategori, custom field, impor CSV

Status: **dibuka 6 November 2026** oleh pemilik proyek. Dokumen ini adalah rencana eksekusi; status implementasi dicatat di bagian akhir setelah dieksekusi.

## 0. Keputusan yang mengikat rencana ini

| Sumber | Isi yang mengikat Q2 |
|---|---|
| `docs/adr/0014-categories-and-custom-fields.md` (Diterima) | Kategori = entitas per Tema; nilai custom field disimpan di `participants.attributes_json` (bukan EAV); `custom_fields.scope = participant \| activity`; nilai field Aktivitas ditunda ke Q3; `key` imutabel; 50 field aktif/Tema; 100 opsi/field; `category_id` wajib. |
| `D-003` [A] | Hierarki Tema → Aktivitas → Sesi; peserta melekat ke Tema (`events`), bukan ke Aktivitas. |
| `D-008` [A] | Tidak ada merge/perubahan peserta otomatis; impor selalu pratinjau + konfirmasi; nama/email/telepon sama hanya warning. |
| `D-020` [A] | Batas impor 2 MB / 1.000 baris data. |
| `D-023` [A], `FR-207` | Audit append-only; `before`/`after` hanya field allowlist; nilai PII tidak disimpan. |
| `D-007` [A] | Tidak ada kewajiban migrasi data produksi, tetapi data yang sudah ada tidak boleh hilang. Migrasi baru additive/rebuild terkontrol; `0001`–`0007` tidak diedit. |
| `ADR-0015` | Tema `archived` menolak seluruh mutasi anak, termasuk kategori/custom field/peserta. |

Keputusan turunan ADR-0014 yang sudah disetujui pemilik: CSV tanpa kolom kategori → **seluruh impor ditolak**; nama kategori tidak dikenal → **baris ditolak**, tidak dibuat otomatis.

## 1. Prasyarat

- Q1 selesai dan migrasi `0007` sudah ada di remote (6 November 2026).
- ADR-0014 sudah Diterima dan AQ-006 ditandai dijawab.
- Rencana ini tidak membuka Q3; resolver entitlement tetap di Q3.

## 2. Tujuan

1. Kategori menjadi entitas Tema yang bisa dikelola, dipakai peserta, dan tidak bisa dihapus permanen.
2. Custom field punya katalog lengkap (sembilan tipe, required, opsi, urutan, status) dengan nilai tersimpan per peserta tanpa EAV.
3. Peserta wajib punya kategori, memakai `attributes_json` yang divalidasi, dan tetap aman saat field di-rename/dinonaktifkan/diarsipkan/ubah tipe.
4. Impor CSV memakai kategori yang sudah ada, selalu pratinjau dulu, tidak menghapus nilai dengan sel kosong, dan menolak baris tidak valid alih-alih menyimpan setengah.

## 3. Bukan cakupan

- Resolver entitlement dan aturan kategori → Aktivitas/Sesi (Q3).
- UI kategori, custom field, tab peserta, dan halaman impor. Q2 **API-only**; UI mengikuti Q6/Q8/Q9.
- Nilai custom field per Aktivitas/Sesi (Q3).
- Pencarian/laporan per custom field (Q8) dan indeks per field.
- Export CSV yang memuat custom field (tetap kolom inti; lihat §7).
- Paginasi baru untuk kategori/custom field (daftar kecil per Tema, ikut keputusan Q1: tanpa paginasi sampai ada kebutuhan terukur).

## 4. Skema — `migrations/0008_q2_categories_custom_fields.sql`

Additive + satu rebuild terkontrol untuk `participants`. Tidak ada `ALTER` pada `0001`–`0007`.

### 4.1 `categories`

```sql
CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  theme_id    TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL COLLATE NOCASE,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
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
```

- Unik per Tema bersifat case-insensitive karena `COLLATE NOCASE` pada kolom.
- Tidak ada `DELETE` di aplikasi. Arsip menyembunyikan kategori dari pilihan baru, tetapi peserta lama tetap valid.
- Kategori `archived` menolak penugasan baru (`422 BUSINESS_RULE`); peserta yang sudah memakainya tetap bisa check-in selama peserta aktif (`FR-020`/`FR-024`).

### 4.2 `custom_fields`

```sql
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
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
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
```

- `key` imutabel dan unik termasuk baris terarsip; `label` boleh di-rename.
- `options_json` berbentuk `["Opsi A","Opsi B"]`; divalidasi juga oleh fungsi murni (bukan hanya `json_valid`).
- Batas 50 field aktif dan 100 opsi ditegakkan di Worker (`422 BUSINESS_RULE`), bukan constraint DB.

### 4.3 `participants`

`category_id` wajib dan `attributes_json` ditambahkan dengan `ALTER TABLE`; tabel **tidak** di-rebuild. Alasannya: `attendance` dan `sheet_rows` mereferensikan `participants(id)`, dan `DROP TABLE`/rename pada SQLite berisiko memicu cascade atau menulis ulang referensi FK. Batasan `NOT NULL` fisik tidak bisa dipakai lewat `ALTER` pada tabel berisi data (setiap baris punya kategori berbeda), sehingga kewajiban kategori ditegakkan oleh trigger yang setara:

```sql
ALTER TABLE participants ADD COLUMN category_id TEXT
  REFERENCES categories(id) ON DELETE RESTRICT;

ALTER TABLE participants ADD COLUMN attributes_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(attributes_json));
```

Backfill kategori dari nilai lama SEBELUM kolom dipakai:

```sql
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

UPDATE participants
   SET category_id = (
     SELECT c.id FROM categories c
      WHERE c.theme_id = participants.event_id
        AND c.name = COALESCE(NULLIF(TRIM(participants.category), ''), 'Tanpa Kategori')
   )
 WHERE category_id IS NULL;
```

Baris lama tanpa kategori (tidak ada di remote saat ini: 80 peserta, kategori `Kelas A`–`Kelas D`) mendapat satu kategori per Tema bernama `Tanpa Kategori`. Kategori ini **hanya** wadah data lama; pembuatan peserta baru tetap menolak kategori kosong dan tidak pernah memakai wadah ini sebagai default.

Trigger yang wajib ada di migrasi:

| Trigger | Tujuan |
|---|---|
| `trg_participant_category_required_insert` | `INSERT` dengan `category_id` NULL → `RAISE(ABORT)`. |
| `trg_participant_category_required_update` | `UPDATE OF category_id` ke NULL → `RAISE(ABORT)`. |
| `trg_participant_category_same_theme_insert/update` | Kategori dari Tema lain ditolak di database, bukan hanya di kode. |
| `trg_participant_category_mirror_insert/update` | Kolom `category` (mirror tampilan lama) diisi dari `categories.name`. |
| `trg_category_name_mirror_update` | Rename kategori memperbarui mirror peserta. |

- Kolom `category` lama **dipertahankan** sebagai mirror nama (bukan sumber kebenaran) agar `sheet-projection`, label, dan format export lama tidak perlu berubah sekaligus. `category_id` adalah otoritas; trigger menjaga keduanya konsisten.
- Migrasi menaikkan `app_meta.schema_version` menjadi `8`.

## 5. Tipe dan validator di `packages/shared`

Berkas baru:

- `packages/shared/src/schemas/categories.ts`
  - `CategoryIdSchema`, `CategoryStatusSchema`.
  - `CategoryCreateRequestSchema`, `CategoryUpdateRequestSchema`, `CategoryStatusRequestSchema`.
  - `CategorySummary` (`id`, `name`, `description`, `sortOrder`, `status`, `participantCount?`).
- `packages/shared/src/schemas/custom-fields.ts`
  - `CustomFieldTypeSchema` (9 nilai), `CustomFieldScopeSchema`, `CustomFieldStatusSchema`.
  - `CustomFieldCreateRequestSchema`, `CustomFieldUpdateRequestSchema`, `CustomFieldStatusRequestSchema`.
  - `CustomFieldSummary`.
- `packages/shared/src/participant-attributes.ts` (fungsi murni)
  - `validateParticipantAttributes(fields, values) → { ok: true; value: Record<string, unknown> } | { ok: false; errors: Array<{ key, message }> }`.
  - `mergeParticipantAttributes(existing, patch, fields)` untuk PATCH: `undefined` = tidak berubah, `null` = hapus nilai (hanya bila diizinkan), string kosong = tidak berubah saat impor (`BR-077`).
  - `coerceAttributeValue(type, raw)` untuk konversi CSV string → tipe target.
  - `isTypeChangeAllowed(from, to)`, `validateTypeChange(fields, field, newType, storedValues)` sesuai matriks ADR-0014.
- `packages/shared/src/schemas/participants.ts` diperluas:
  - `categoryId` wajib pada create; `attributes` opsional (default `{}`).
  - `ParticipantSummary` menambah `categoryId` dan `attributes` (nilai mentah; UI yang memformat).
  - `ImportPreviewRow` menambah `categoryId`, `category`, `attributes`.

Aturan validasi nilai (ADR-0014):

| Tipe | JSON | Validasi |
|---|---|---|
| `text`, `textarea`, `email`, `phone` | string | `email`/`phone` memakai normalizer yang sudah ada; panjang wajar (text 500, textarea 5.000). |
| `number` | number | finite; batas aman `±1e15`. |
| `checkbox` | boolean | hanya `true`/`false`. |
| `date` | integer ms epoch UTC | integer > 0; konversi dari `YYYY-MM-DD` di boundary/impor. |
| `select` | string | harus salah satu opsi aktif. |
| `multi_select` | string[] | setiap nilai harus opsi aktif; tanpa duplikat; boleh `[]`. |

Field asing (key tidak ada di katalog `scope='participant'`) **dibuang** saat validasi, bukan disimpan diam-diam. Field `required` wajib ada saat create dan saat nilai dikirim pada update/impor; sel kosong saat update/impor tidak menghapus nilai lama.

## 6. API

Semua route di bawah `/api/events/:eventId`, otomatis mendapat alias `/api/calendar` dan `/api/themes` dari `app.ts`. Semua mutasi memakai `requireEventAccess` + `requireMutableEvent` (ADR-0015), CSRF/Origin guard yang sudah ada, dan audit dalam `db.batch()` yang sama.

### 6.1 Kategori

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/categories` | officer+ | Daftar kategori (termasuk yang diarsipkan; query `status`) |
| `POST` | `/categories` | event_admin, superadmin | Buat kategori |
| `GET` | `/categories/:categoryId` | officer+ | Detail |
| `PATCH` | `/categories/:categoryId` | event_admin, superadmin | Ubah nama/deskripsi/urutan; `updatedAt` optimistis |
| `POST` | `/categories/:categoryId/status` | event_admin, superadmin | `active` ⇄ `archived`; arsip mengisi `archived_at` |

- Nama duplikat (case-insensitive) → `409 CONFLICT`.
- Kategori dengan peserta aktif tidak boleh diarsipkan? **Boleh** — arsip hanya menolak penugasan baru; peserta lama tetap valid. Tidak ada penolakan yang menghapus data.
- `GET /categories` mengembalikan `participantCount` per kategori (satu query `GROUP BY`) agar UI Q8 tidak perlu N+1.

### 6.2 Custom field

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/custom-fields` | officer+ | Daftar; query `scope`, `status` |
| `POST` | `/custom-fields` | event_admin, superadmin | Buat; validasi tipe/opsi/batas |
| `GET` | `/custom-fields/:fieldId` | officer+ | Detail |
| `PATCH` | `/custom-fields/:fieldId` | event_admin, superadmin | Label/deskripsi/required/opsi/urutan; **bukan** `key` |
| `POST` | `/custom-fields/:fieldId/status` | event_admin, superadmin | Aktif/nonaktif/arsip |
| `POST` | `/custom-fields/:fieldId/type` | event_admin, superadmin | Ubah tipe lewat validasi kompatibilitas |

- `PATCH` yang menyertakan `key` atau `type` ditolak `400 VALIDATION_ERROR` (arahkan ke endpoint `/type`).
- Perubahan tipe memakai `validateTypeChange`; bila ada nilai tersimpan yang tidak valid → `422 BUSINESS_RULE` dengan `fieldErrors` berisi `key` yang gagal. Tidak ada pemotongan data.
- Rename label, nonaktifkan, arsip, dan ubah urutan tidak menyentuh `attributes_json` (`AC-008`).
- Field `scope='activity'` boleh dibuat di Q2 (API-only) tetapi tidak boleh dipakai di `participants.attributes_json`; validasi peserta hanya memakai `scope='participant'`.
- Batas 50 field `active` per Tema dan 100 opsi per field; aktivasi field ke-51 → `422 BUSINESS_RULE`.

### 6.3 Peserta

Bentuk route tidak berubah; kontrak berubah:

- `POST /participants`: `categoryId` wajib. `category` (nama) tidak lagi diterima sebagai input; bila klien lama mengirim `category` saja → `400 VALIDATION_ERROR` dengan pesan yang menyebut `categoryId`. Ini disengaja agar tidak ada pencocokan nama diam-diam.
- `PATCH /participants/:id`: `categoryId` boleh diubah; `attributes` bersifat parsial (merge). `attributes: { "key": null }` menghapus nilai **hanya** bila field tidak `required`; field `required` → `422`.
- `GET` daftar/detail: `ParticipantSummary` memuat `categoryId`, `category` (nama hasil join), dan `attributes`. `query` pencarian tetap mencocokkan nama, `external_ref`, telepon, email, **dan nama kategori** (join).
- Export CSV: header tetap `external_ref, full_name, phone, email, category, note`; `category` diisi nama dari join. Custom field **tidak** diekspor pada Q2 (keputusan ditunda ke Q8 agar tidak menjanjikan format yang belum stabil).
- Template CSV: header `external_ref, full_name, phone, email, category, note`; kategori diisi **nama** kategori yang sudah ada. Template tidak lagi kosong untuk kolom kategori? Tetap header-only; dokumentasi menyebut isi kategori harus nama yang cocok.

### 6.4 Otorisasi

Tambahkan action di `domain/permissions.ts`:

| Action | Minimum membership |
|---|---|
| `category:read` | officer |
| `category:write` | event_admin |
| `custom_field:read` | officer |
| `custom_field:write` | event_admin |

Superadmin tetap lintas Tema. Petugas hanya membaca; tidak ada jalur tulis.

## 7. Impor CSV

### 7.1 Kontrak

- Header wajib tetap `full_name`; **`category` wajib ada sebagai header** (bukan opsional). Bila tidak ada → `400 VALIDATION_ERROR` sebelum baris diproses, pesan: `Header wajib "category" tidak ditemukan`.
- Nilai `category` dicocokkan ke `categories.name` case-insensitive **hanya** kategori `active` pada Tema yang sama. Tidak ada pembuatan otomatis.
- Nama tidak dikenal → baris masuk `invalid` dengan alasan `kategori "X" tidak ditemukan`; baris lain tetap diproses (partial import), tetapi bila **semua** baris valid gagal karena kategori, tetap hasilkan `valid: 0` dan `invalid` lengkap.
- Nama kategori `archived` dianggap tidak ditemukan (tidak boleh penugasan baru).
- Header `category` boleh kosong di baris? Tidak: baris tanpa kategori → `invalid` (`category wajib diisi`).
- Baris dengan `external_ref` yang sudah ada → `action: "update"`; tanpa ref → `"create"` dengan warning duplikat (nama/email/telepon) untuk review manual, tanpa merge.
- `BR-077`: sel kosong **tidak** mengubah nilai lama. Untuk update, hanya kolom yang terisi yang ditulis. Karena itu `upsertParticipantStatement` perlu varian yang mempertahankan nilai lama untuk kolom kosong.
- `attributes` dari CSV: kolom custom field **tidak** didukung pada Q2 (header asing tetap ditolak seperti sekarang). Nilai custom field diisi lewat API peserta setelah impor. Ini menjaga format CSV stabil dan menghindari pemetaan kolom dinamis yang belum dirancang.

### 7.2 Pratinjau dan konfirmasi

- `POST /participants/import?dry_run=true` (default) mengembalikan `created`/`updated`/`invalid`/`sample` seperti sekarang, ditambah `categoryId` per sample.
- Menulis hanya bila `dry_run=false`; rate limit tetap 10/jam per Tema.
- Semua statement impor + audit per baris (atau satu audit ringkasan?) — **keputusan**: satu baris audit `participant.imported` per request berisi `{ total, created, updated, skipped }`, bukan satu audit per peserta, untuk menghemat baris tulis. Perubahan individual tetap dapat ditelusuri dari `updated_at`/`created_at`; `FR-135` meminta audit aksi, bukan salinan setiap baris.
- Bila batch gagal karena unique violation → `409 CONFLICT` seperti sekarang; tidak ada baris yang setengah tersimpan karena `db.batch()` atomik.

## 8. Audit

Perluas `packages/shared/src/audit-allowlist.ts`:

- `AuditEntityType` menjadi `"theme" | "activity" | "session" | "category" | "custom_field" | "participant"`.
- `category`: `["name", "description", "sortOrder", "status", "archivedAt"]`.
- `custom_field`: `["key", "label", "description", "type", "required", "scope", "sortOrder", "status", "archivedAt"]` — **tanpa** `optionsJson` (bisa memuat nilai bebas) dan tanpa nilai peserta.
- `participant`: `["categoryId", "status", "fullName", "note"]`? `fullName`/`note` adalah PII. `FR-207` melarang PII di audit. Karena itu `participant` hanya mencatat `categoryId` dan `status`, dan perubahan `fullName`/`note`/`attributes` dicatat sebagai `"changed"` tanpa nilai. Untuk `attributes_json`, catat daftar `key` yang berubah saja: `{ "attributesChanged": ["nisn","kelas"] }` (bukan nilai).
- Audit mutasi kategori/custom field/peserta ditulis dalam `db.batch()` yang sama dengan statement mutasi. Untuk update, gunakan guard `updated_at` seperti Q1.
- Audit dibuat/diarsipkan: `action` = `category.created`, `category.updated`, `category.archived`, dst.; `entity_id` = id.

## 9. Reuse yang dievaluasi

| Komponen | Dipakai / diubah |
|---|---|
| `domain/csv.ts` | Dipakai apa adanya (parser RFC 4180, deteksi delimiter, escape formula). |
| `domain/participant-import.ts` | Diubah: header `category` wajib, resolusi kategori, atribut (belum ada kolom dinamis), validasi tetap murni. |
| `db/participants.ts` | Diubah: join kategori, `category_id`, `attributes_json`, upsert yang mempertahankan nilai kosong. |
| `routes/participants.ts` | Diubah: `categoryId`, `attributes`, otorisasi baru, audit. |
| `domain/permissions.ts` | Tambah empat action. |
| `db/activities.ts` pola optimistic update + audit guard | Dipakai ulang untuk kategori/custom field/peserta. |
| `pages/import.tsx`, `pages/event-participants.tsx` | **Tidak disentuh** di Q2 (UI belum dibuka). |
| `PLAN_TAB_PESERTA.md` §3–4 | Usulan lama (katalog + `attributes_json`) sudah dievaluasi di ADR-0014; tidak disalin. |

## 10. Berkas baru/berubah

Baru:

- `migrations/0008_q2_categories_custom_fields.sql`
- `packages/shared/src/schemas/categories.ts`
- `packages/shared/src/schemas/custom-fields.ts`
- `packages/shared/src/participant-attributes.ts` + test
- `apps/api/src/db/categories.ts`
- `apps/api/src/db/custom-fields.ts`
- `apps/api/src/routes/categories.ts`
- `apps/api/src/routes/custom-fields.ts`
- `apps/api/src/domain/participant-attributes.ts` (adapter D1 ↔ validator murni) + test
- `apps/api/src/test/categories.api.test.ts`
- `apps/api/src/test/custom-fields.api.test.ts`
- `apps/api/src/test/participant-attributes.api.test.ts`

Berubah:

- `packages/shared/src/index.ts`, `schemas/participants.ts`, `participant-import` terkait.
- `apps/api/src/app.ts` (registrasi route).
- `apps/api/src/db/participants.ts`, `routes/participants.ts`, `domain/participant-import.ts`, `domain/permissions.ts`.
- `apps/api/src/test/participants.crud.test.ts`, `participants.import.test.ts`, fixture migrasi.
- `packages/shared/src/audit-allowlist.ts`.
- `docs/DESAIN_DATABASE.md`, `docs/DESAIN_API.md`, `docs/RENCANA_PENGUJIAN.md`, `docs/ARCHITECTURE.md` bila perlu, `docs/IMPLEMENTATION_ROADMAP.md` status hasil.

## 11. Tes wajib

### 11.1 Kategori

- Kategori dari Tema lain → `404` pada GET/PATCH/status.
- Nama duplikat case-insensitive → `409`; nama sama di Tema lain → boleh.
- Arsip kategori: peserta lama tetap valid; penugasan baru (`POST/PATCH` peserta) → `422`.
- Kategori tidak bisa dihapus permanen (tidak ada route DELETE; cek route table).
- Petugas tidak bisa menulis kategori → `403`.
- Tema `archived` → `422` untuk semua mutasi kategori (ADR-0015).

### 11.2 Custom field

- Sembilan tipe diterima; tipe asing → `400`.
- `select`/`multi_select` tanpa `options_json` → `400`; opsi > 100 → `422`.
- Field aktif ke-51 → `422`; setelah satu field diarsipkan, field baru boleh dibuat.
- Rename label, nonaktifkan, arsip, ubah urutan → nilai peserta tetap ada (`AC-008`).
- Perubahan tipe yang valid mengubah representasi tanpa menulis ulang data; yang tidak valid → `422` dengan daftar key.
- `key` tidak bisa diubah lewat PATCH; field `scope='activity'` tidak diterima di `attributes` peserta (`FR-033`).

### 11.3 Peserta + atribut

- `categoryId` wajib pada create; `category` teks saja → `400`.
- `categoryId` milik Tema lain → `404`/`422` (pilih `404` agar tidak bocor).
- Participant ID tidak bisa diubah lewat PATCH (tidak ada field `id` di schema).
- `required` field: create tanpa nilai → `422`; update tanpa menyentuh field required tetap valid; update mengirim `null` untuk required → `422`.
- Tipe nilai salah → `422` dengan `fieldErrors` per key.
- Key asing dibuang, tidak tersimpan.
- Field nonaktif/arsip: nilai lama tetap terbaca; nilai baru untuk field arsip ditolak.
- `attributes_json` tidak valid di DB tidak mungkin lewat API; tes langsung DB memastikan `CHECK json_valid` menolak.

### 11.4 Impor

- CSV tanpa header `category` → seluruh impor `400`, tidak ada tulisan.
- Kategori tidak dikenal → baris invalid, baris valid lain tetap diproses (partial), dan `dry_run` tidak menulis.
- Kategori `archived` → baris invalid.
- Sel kosong tidak menghapus nilai lama (`BR-077`, `AC-054`).
- Baris tanpa `external_ref` → create + warning duplikat, bukan merge (`AC-042`).
- `external_ref` sama di file → invalid; `external_ref` sama di DB → update.
- 2 MB / 1.000 baris → `413`/`400` dengan pesan actionable.
- `dry_run=false` tanpa pratinjau tetap diizinkan secara teknis? **Tidak**: endpoint tetap mensyaratkan `dry_run=false`, tetapi tidak menyimpan state pratinjau; ini kontrak lama. Tes memastikan tanpa `dry_run=false` tidak ada tulisan.

### 11.5 Audit

- Mutasi kategori/custom field/peserta menulis audit dalam batch yang sama.
- Update dengan `updated_at` basi → `changes = 0`, tidak ada audit (perluas `audit.guarded-write.test.ts`).
- `attributes` tidak pernah muncul utuh di `after_json`; hanya daftar key.
- `options_json` tidak masuk audit.

### 11.6 Mutasi (gagal bila aturan dihapus)

Wajib diuji dengan merusak kode sementara:

- Hapus pengecekan `scope='participant'` → tes `FR-033` harus gagal.
- Hapus `required` saat create → tes harus gagal.
- Hapus pengecekan kategori `archived` → tes penugasan baru harus gagal.
- Hapus guard `updated_at` audit → `audit.guarded-write.test.ts` harus gagal.
- Hapus pengecekan `category` header → tes impor tanpa header harus gagal.

## 12. Urutan kerja

1. Tulis `0008` + perbarui `DESAIN_DATABASE.md`; jalankan `db:reset:local` + `db:migrate:local`; verifikasi tabel/indeks dan data lama (attendance tetap utuh).
2. `packages/shared`: skema kategori/custom field, tipe peserta, validator atribut + unit test murni.
3. `db/categories.ts`, `db/custom-fields.ts`, `db/participants.ts` (join + upsert baru).
4. `routes/categories.ts`, `routes/custom-fields.ts`, `routes/participants.ts`; registrasi di `app.ts`.
5. Audit allowlist + statement guard; tes `audit.guarded-write`.
6. Impor CSV: header kategori wajib, resolusi kategori, warning duplikat, sel kosong.
7. Tes API lengkap (kategori, field, peserta, impor, otorisasi, Tema arsip).
8. Dokumentasi: `DESAIN_API.md` §5–§6, `DESAIN_DATABASE.md` §3, `RENCANA_PENGUJIAN.md` §9, roadmap status hasil.
9. `typecheck` → `lint` → `test` → `build`; catat angka.
10. Uji mutasi §11.6; perbaiki tes yang tidak menangkap.

## 13. Perintah verifikasi

```bash
npm run typecheck
npm run lint
npm run test -- apps/api/src/test/categories.api.test.ts apps/api/src/test/custom-fields.api.test.ts apps/api/src/test/participants.crud.test.ts apps/api/src/test/participants.import.test.ts
npm run test        # suite penuh di akhir
npm run build
```

Database lokal:

```bash
npm run db:reset:local
npm run db:migrate:local
```

Remote (hanya setelah konfirmasi pemilik): backup → `npm run db:migrate:remote` → verifikasi `categories`, `custom_fields`, `category_id`, `attributes_json`, `schema_version = 8`. Jangan deploy kode Q2 sebelum migrasi remote.

## 14. Gate akhir Q2

- Semua tes §11 lulus; audit dan otorisasi terbukti.
- `AC-006`–`AC-010`, `AC-042`, `AC-054` punya tes yang sesuai.
- Tidak ada dependensi baru.
- `participants.category` lama sudah tidak ada; semua query memakai join kategori.
- Data remote 80 peserta tetap ada dan mendapat `category_id` yang benar (verifikasi hitung per kategori setelah migrasi).
- Dokumentasi diperbarui di commit yang sama.
- Review manusia sebelum Q3 dibuka.

## 15. Risiko dan catatan

| Risiko | Mitigasi |
|---|---|
| Rebuild `participants` merusak FK `attendance`/`sheet_rows` | Uji di DB lokal berisi attendance + QR; verifikasi `PRAGMA foreign_key_check`; backup remote sebelum migrasi. |
| Migrasi backfill membuat kategori dari teks lama | Nilai lama berasal dari admin, bukan karangan; dokumentasikan sebagai backfill satu kali. Baris tanpa kategori hanya dapat wadah `Tanpa Kategori` (tidak ada di remote saat ini). |
| Formulir lama mengirim `category` teks | Ditolak dengan pesan jelas; UI Q2 belum ada, jadi tidak ada klien produksi yang rusak. |
| `attributes_json` tanpa indeks | Diterima ADR-0014; query per field ditunda ke Q8 dengan pengukuran. |
| Audit per baris impor membengkakkan kuota | Satu audit ringkasan per request; keputusan ini dicatat di desain API. |
| `category_id` NOT NULL vs data lama | Backfill sebelum rebuild; tidak ada `DEFAULT` yang bisa dipakai peserta baru untuk melewati kategori. |

## 16. Catatan penyimpangan

Diisi setelah eksekusi, seperti Q1 §16: apa yang berubah dari rencana, mengapa, dan hasil uji mutasi.

**Rencana vs aktual (7 November 2026):**

1. **`participants` tidak di-rebuild.** Rencana awal mempertimbangkan table rebuild untuk `category_id NOT NULL`. Aktual memakai `ALTER TABLE ... ADD COLUMN` + trigger `BEFORE INSERT`/`BEFORE UPDATE OF category_id`. Alasan: rebuild pada tabel berisi data berisiko dan tidak diperlukan; SQLite tidak bisa menambah kolom `NOT NULL` tanpa default yang valid per baris. Kewajiban `category_id` tetap ditegakkan database, bukan hanya kode.
2. **`participants.category` dipertahankan sebagai mirror.** Kolom teks lama tidak dihapus; trigger mengisinya dari `categories.name` dan memperbaruinya saat rename. Sumber kebenaran tetap `category_id`; mirror hanya untuk kompatibilitas UI Q1 dan ekspor lama.
3. **Kompatibilitas input nama kategori.** Create/update satu peserta menerima `categoryId` (kanonik) **atau** `category` (nama, deprecated). Nama yang belum ada pada jalur ini **membuat kategori** dalam batch yang sama karena admin mengetiknya secara eksplisit. Impor CSV tetap menolak nama tak dikenal tanpa auto-create, sesuai ADR-0014. `PATCH` dengan `category: null` diabaikan dan tidak pernah mengosongkan kategori.
4. **`mergeParticipantAttributes` tidak memeriksa ulang `required` setelah merge.** Rencana menyebut update tanpa menyentuh field required tetap valid; implementasi awalnya memanggil validasi penuh sehingga peserta lama tanpa field required baru ikut ditolak. Fungsi sekarang hanya memvalidasi nilai yang dikirim/diubah, sedangkan `validateParticipantAttributes` tetap menegakkan `required` saat create. Larangan menghapus nilai required tetap berlaku.
5. **Nilai untuk field `archived` ditolak pada create maupun patch.** Rencana hanya menyebut "nilai baru ditolak"; implementasi memberlakukan aturan yang sama di kedua jalur. Nilai lama tetap terbaca dan tidak dihapus.
6. **`key` dikecualikan dari regex field sensitif audit.** `custom_fields.key` adalah identifier publik (`[a-z][a-z0-9_]*`), bukan kredensial. Tanpa pengecualian, allowlist audit tidak bisa mencatat key field. Field lain yang mengandung "key" tetap dianggap sensitif.
7. **Batas opsi > 100 → `422 BUSINESS_RULE`, bukan `400`.** Skema hanya membatasi panjang array (1.000) untuk mencegah payload tak terbatas; batas bisnis 100 diperiksa di route agar pesan dan kode hasil konsisten dengan batas 50 field.
8. **Tanggal wajib `YYYY-MM-DD` ketat.** `Date.parse` menerima banyak format longgar; koersi CSV sekarang menolak `06/11/2026` dan hanya menerima ISO date, lalu menyimpannya sebagai ms epoch UTC.
9. **`businessRule()` menerima `details`.** Dibutuhkan agar `fieldErrors` per key bisa dikirim pada `422` tanpa memakai `validationError` (`400`), sesuai kontrak `BR-016`/`FR-030`.
10. **Tes baru di luar rencana awal:** `T-020` (client tidak bisa mengirim `id`) dan `T-027`/`BR-077` (sel kosong tidak menghapus nilai lama). Keduanya ditambahkan karena daftar tes wajib §11 belum punya penutup eksplisit.
11. **Urutan rilis remote adalah prasyarat, bukan detail.** Setelah `0008` diterapkan, trigger `trg_participant_category_required_insert` menolak `INSERT` peserta tanpa `category_id`. Worker yang sedang berjalan di remote masih memakai kode Q1 dan menulis peserta tanpa kolom itu, sehingga **`0008` tidak boleh diterapkan lebih dulu tanpa deploy kode Q2**. Terapkan migrasi dan deploy kode dalam satu jendela; sebelum itu, ambil backup baru dan konfirmasi pemilik. Migrasi hanya diuji di D1 lokal berisi data lama, belum di remote.

**Hasil uji mutasi §11.6 (semua tertangkap):**

| Mutasi sementara | Tes yang gagal |
|---|---|
| Hapus filter `scope='participant'` | `participant-attributes.test.ts` — "drops activity-scoped definitions entirely" |
| Hapus syarat `required` saat create | `participant-attributes.test.ts` — "rejects a missing required field"; `participant-attributes.api.test.ts` — "enforces required fields on create" |
| Hapus cek kategori `archived` | `categories.api.test.ts` — "archives a category and refuses new assignments…" |
| Hapus guard `updated_at` pada audit | `audit.guarded-write.test.ts` — 5 tes "loses the optimistic race" (Aktivitas, Sesi, kategori, custom field, peserta) |
| Hapus header `category` dari `REQUIRED_HEADERS` | `participants.import.test.ts` — "rejects a file without the category header" |
| Ganti `COALESCE` dengan nilai `excluded` pada upsert impor | `participants.import.test.ts` — "never erases an existing value with an empty cell (BR-077)" |

Catatan: mutasi pertama awalnya **tidak tertangkap** karena tes unit menggabungkan field activity dan archived dalam satu ekspektasi error. Tes dipersempit menjadi dua kasus terpisah sebelum mutasi diulang; itulah alasan hasil akhirnya tertangkap. Mutasi guard audit juga sempat dijalankan dengan SQL rusak (nama tabel hilang); percobaan itu dibuang dan diulang dengan mutasi yang valid secara sintaks.
