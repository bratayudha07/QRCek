# PLAN — Tab Peserta: tabel dinamis, QR otomatis, unduhan massal

> **ARSIP — jangan dieksekusi apa adanya** (`D-002` [A], 3 November 2026).
> Bagian yang relevan sudah dievaluasi dan diintegrasikan ke [`docs/IMPLEMENTATION_ROADMAP.md`](docs/IMPLEMENTATION_ROADMAP.md) §5 (tahap Q2 dan Q4). Yang **tidak** dibawa: unduhan QR sebagai PDF (bertentangan `NG-04`/`NG-05`), upsert impor tanpa konfirmasi (bertentangan `FR-050`), migrasi `0007_participant_fields.sql` apa adanya (skema menunggu AQ-006/AQ-010), dan penomoran "ADR-008" (bentrok dengan [ADR-0008](docs/adr/0008-audit-log-retention.md) retensi audit).

> **Dokumen kerja untuk opencode.** Disusun dari diskusi dengan pemilik proyek (Brata Yudha) dan diverifikasi terhadap kode pada 2 Nov 2026.
> **Lingkup: hanya tab Peserta** (`/admin/events/:id/participants` beserta sub-halamannya). Tab lain, scan, kehadiran, dan Sheets **tidak diubah**.
> Nama usulan: **Tahap 5.5** (perluasan Fase 2 — Peserta & QR). Tidak ada fase yang dilompati.

---

## 0. Aturan kerja (baca sebelum menyentuh kode)

1. Baca `AGENTS.md` sampai habis. Aturannya mengikat dan **tidak dilonggarkan** dokumen ini.
2. Kerjakan milestone **berurutan** (M0 → M7). Satu milestone = satu commit/PR yang hijau sendiri.
3. Gerbang tiap milestone: `npm run typecheck` → `npm run lint` → `npm run test`. Jangan lapor selesai bila salah satu belum dijalankan.
4. Mesin dev pemilik: **Celeron N4120, RAM 4 GB**. Saat iterasi pakai tes terfokus dan `--maxWorkers=2`; suite penuh (~65 dtk) hanya di akhir milestone.
5. `npm run db:migrate:remote` dan perintah apa pun ke D1 **remote** → **wajib konfirmasi user**. Jangan pernah mengedit migrasi 0001–0006.
6. **Tanpa dependensi baru** (alasannya di §3 D8). Bila terpaksa: satu baris justifikasi tertulis + persetujuan user (AGENTS aturan #2).
7. Teks UI → Bahasa Indonesia. Identifier, komentar, nama file, pesan commit → Inggris. Jangan log PII atau token QR. Validasi semua input di boundary Worker dengan skema di `packages/shared`.
8. Bila menemukan fakta yang bertentangan dengan dokumen ini: **berhenti dan tanyakan**, jangan menebak.
9. Logika yang bisa murni **harus** murni dan punya unit test. Tes web berjalan di environment `node` (tanpa DOM, tanpa jsdom), jadi logika tabel/unduhan ditaruh di `apps/web/src/lib/*` dan UI diverifikasi lewat checklist manual.

---

## 1. Tujuan (permintaan pemilik → perilaku yang diharapkan)

| # | Permintaan | Perilaku yang diharapkan |
|---|---|---|
| R1 | Tab Peserta berbentuk **tabel** | Kolom = field yang diisi user lewat CSV (mis. Nama, Kelas, No. HP). Bukan daftar `<ul>` seperti sekarang. |
| R2 | Bisa **diurutkan per field** (mis. kelas) | Klik header kolom mana pun, termasuk field bebas buatan user. Urutan alami: "7A" sebelum "10A". |
| R3 | Saat **kosong**, ada tombol di tengah | Tombol "Tambah peserta dari CSV" di tengah area konten. |
| R4 | Setelah diisi → tabel, **QR otomatis dibuat** | Selesai impor, QR semua peserta aktif disiapkan otomatis dengan indikator progres. |
| R5 | QR **tidak tampil di tabel** | Tabel tidak memuat gambar/pratinjau QR. |
| R6 | Klik peserta → **QR + data** | Panel detail (drawer) berisi QR dan seluruh data peserta. |
| R7 | Menu **⋮** | Unduh QR (PNG per peserta dibungkus ZIP), unduh QR (PDF), impor peserta, unduh template, ekspor peserta, dan aksi terkait lainnya. |
| R8 | Cukup tab Peserta dulu | Lihat *non-goals* di bawah. |

### Non-goals (sengaja tidak dikerjakan)

- Menyinkronkan field bebas ke Google Sheets (proyeksi tetap 8 kolom, `domain/sheet-projection.ts`).
- Mencetak field bebas di halaman **Label QR** yang sudah ada (`LabelFieldKey` tetap enum 6 kunci). Ini tindak lanjut, lihat §9.
- "Kelola kolom" (ganti nama / hapus / urutkan ulang kolom), filter per kolom, multi-sort, checkbox seleksi baris.
- Sort/paginasi sisi server atas field bebas.
- Mengubah format kredensial QR (ADR-003/ADR-006), perilaku scan, kehadiran, dasbor, atau tab lain.

---

## 2. Kondisi kode saat ini (fakta terverifikasi)

| Area | Fakta | Lokasi |
|---|---|---|
| Skema peserta | Kolom **tetap**: `external_ref, full_name, phone, email, category, note, status`. Unik parsial `(event_id, external_ref)`. | `migrations/0003_participants.sql` |
| Kolom QR | `qr_token_hash` (unik, parsial), `qr_token_ciphertext`, `qr_token_nonce`, `qr_key_version`, `qr_issued_at`. NULL sampai QR diterbitkan. | `migrations/0004_qr.sql` |
| CSV | Hanya 6 header persis. **Header tak dikenal menolak seluruh file** (`CsvFormatError`). Maks 1.000 baris, 2 MB. | `apps/api/src/domain/participant-import.ts`, `packages/shared/src/schemas/participants.ts` |
| Impor | Dry-run default. Konfirmasi = **satu** `DB.batch(statements)` berisi semua baris. Rate limit 10/jam/acara. | `apps/api/src/routes/participants.ts` |
| Daftar peserta (UI) | `<ul>` paginasi kursor 25 baris, urut `created_at DESC`. Cari = `LIKE` pada 5 kolom. | `apps/web/src/pages/event-participants.tsx`, `apps/api/src/db/participants.ts` |
| Detail peserta | **Halaman terpisah**, tanpa QR. `App.tsx` memetakan route `participant` ke `ParticipantDetailPage`. | `apps/web/src/pages/participant-detail.tsx`, `apps/web/src/App.tsx` |
| Penerbitan QR | **Hanya** lewat `POST /participants/qr-labels`. Idempoten (`qr_token_hash IS NULL`). Batch ≤ **50** karena CPU: 100 kredensial ≈ **12 ms** p50, melebihi batas ~10 ms. | `apps/api/src/routes/labels.ts`, `packages/shared/src/labels.ts` |
| Field label | Enum tetap 6 kunci, maks 4 per label. | `packages/shared/src/labels.ts` |
| Render QR | SVG dari matriks `qrcode-generator`. Layout label: A4 3×8, stiker 50×30 mm. | `apps/web/src/components/qr-code.tsx`, `apps/web/src/lib/qr-labels.ts` |
| Router | Berbasis path: `/admin/events/:id/participants`, `/:participantId`, `/import`, `/labels`. | `apps/web/src/lib/router.ts` |
| Dependensi web | **Tidak ada** pustaka ZIP/PDF/tabel. Ada `qrcode-generator`, `@zxing/browser`, `lucide-react`. | `apps/web/package.json` |
| Izin | `participant:read` (petugas boleh), `participant:write`, `participant:import`, `qr:print` (hanya admin acara). Acara `archived` = baca saja. | `apps/api/src/routes/*.ts` |
| Anggaran | CPU **10 ms/request** (target p95 ≤ 5 ms, margin 2×). Baris ditulis 100.000/hari, dibaca 5.000.000/hari. 50 query/invokasi, 100 parameter terikat/query, SQL ≤ 100 KB. | `COSTS_AND_LIMITS.md` |

---

## 3. Keputusan desain (ringkasan → dicatat sebagai **ADR-008** di `docs/ARSITEKTUR.md`, mengikuti ADR-001…007 yang tinggal di sana)

### D1 — Field dinamis = katalog per acara + atribut JSON

Tabel `event_fields` (daftar kolom per acara) + `participants.attributes_json` (nilai field bebas) + `participants.search_text` (teks cari).

- **Ditolak: EAV** (`participant_values(participant_id, field_id, value)`). Satu peserta = N baris tulis. Impor 1.000 peserta × 8 field = ±8.000 baris tulis dari kuota 100.000/hari, dibanding 1.000 pada desain JSON.
- **Ditolak: kolom baru per field** (`ALTER TABLE`). Tabel `participants` dipakai bersama semua acara, DDL saat runtime tidak bisa masuk `batch`, dan skema mahal diubah (AGENTS).

### D2 — Kolom inti tetap fisik

`full_name` (wajib, selalu kolom pertama). `external_ref`, `phone`, `email`, `category`, `note` tetap **kolom fisik** ("builtin"), karena dipakai scan/kehadiran/dasbor/Sheets (`category`, `external_ref`, `full_name`) dan punya normalisasi (telepon → `+62…`, email). Field buatan user (mis. **Kelas**) hidup di `attributes_json`. Kolom builtin tampil di tabel **hanya bila ada di katalog acara itu**.

### D3 — Pemetaan kolom CSV saat impor

Header apa pun diterima (maks 40 kolom). Server **menyarankan** target tiap kolom; user bisa mengubahnya di UI. Menggantikan galat "Kolom tidak dikenal".

Target per kolom: `Nama` (wajib, tepat 1) · `ID / Referensi` (maks 1; kunci unik untuk impor ulang) · `Telepon` · `Email` · `Kategori` · `Catatan` · `Field bebas` · `Abaikan`.

Urutan saran: (1) alias builtin, (2) cocok dengan field katalog yang sudah ada (label/key), (3) sisanya → field bebas baru.

### D4 — Sort & filter di **klien**

Endpoint tabel mengembalikan semua baris acara (filter `query`/`status` tetap di server) sampai `TABLE_MAX_ROWS`.

- Urutan alami pakai `Intl.Collator("id", { numeric: true, sensitivity: "base" })` → "7A" < "10A", tak peka huruf besar/kecil. SQLite hanya biner/`NOCASE`.
- Satu request per kunjungan; sort dan cari instan; hemat baris dibaca; tak perlu keyset atas JSON.
- Konsekuensi: ada **cap baris**. Di atas cap → `truncated: true` + banner; pencarian jadi query server. Nilai cap ditetapkan spike **M0** (p95 ≤ 5 ms). Nilai awal **2.000**, tidak boleh lebih tanpa bukti ukur.

### D5 — QR otomatis = digerakkan klien, berkeping-keping

Penerbitan kredensial **tidak bisa** serentak di request impor (≈12 ms CPU per 100 kredensial; 1.000 baris ≈ 120 ms ≫ 10 ms). Maka:

1. Setelah impor sukses (dan setelah tambah peserta manual), klien memanggil `POST /participants/qr` dengan `selection: { kind: "missing" }` berulang (≤ 50 per panggilan) sampai `remaining === 0`, sambil menampilkan progres.
2. Aman dihentikan dan dilanjutkan (idempoten via `qr_token_hash IS NULL`).
3. Banner di tab Peserta menawarkan "Siapkan QR" bila masih ada peserta aktif tanpa QR.
4. Membuka halaman **tidak** menerbitkan QR sendiri. Sifat "membuka halaman tidak menulis DB" dipertahankan (lihat komentar `event-labels.tsx`).

### D6 — Unduhan dirakit di **browser**

PNG/ZIP/PDF dirakit klien dari payload QR (`absensi:v1:<token>`) yang diambil lewat endpoint `qr`. Worker tidak merender apa pun (hemat CPU). Token hanya hidup di memori selama proses unduhan; tidak ke `localStorage`, tidak ke log. Server mencatat **jumlah** di audit log, tidak pernah token.

### D7 — Detail = panel (drawer) di atas tabel, route yang sama

Klik baris → URL `/admin/events/:id/participants/:participantId` (path **tidak berubah**, jadi bookmark lama tetap valid). `App.tsx` merender halaman tabel yang sama dengan prop `selectedParticipantId` **tanpa remount**, sehingga urutan, pencarian, dan halaman tabel tidak hilang. Tombol Back menutup panel. Dibangun dengan elemen `<dialog>` bawaan (focus-trap dan Esc gratis); bottom-sheet penuh di layar < `md`.

### D8 — Tanpa dependensi baru

Tiga modul murni ditulis sendiri di `apps/web/src/lib/` dan diuji unit:

- **ZIP**: mode *store* (PNG sudah terkompresi) + CRC-32.
- **PNG 1-bit**: zlib lewat `CompressionStream("deflate")` (Web API; menghasilkan format zlib yang dibutuhkan PNG).
- **PDF minimal**: QR vektor (`re f`), font standar Helvetica (WinAnsi).

Alasan: AGENTS aturan #2; bundle kecil untuk perangkat lemah; `pdf-lib` terakhir dirilis 2021 sepengetahuan saya (**periksa npm sebelum menimbang pustaka mana pun**).
**Fallback bila M6 membengkak**: `fflate` (ZIP) dan `jsPDF` (PDF) via `import()` dinamis, **dengan justifikasi tertulis dan persetujuan user**.

---

## 4. Model data — `migrations/0007_participant_fields.sql`

> Nomor berikutnya setelah `0006_self_signup.sql`; cek `ls migrations/` dulu. Sketsa di bawah adalah arah, bukan salinan final: finalkan sintaks dan uji di D1 lokal.

```sql
-- One row = one column of the Peserta table for one event.
CREATE TABLE event_fields (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  label      TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  source     TEXT NOT NULL CHECK (source IN ('builtin','custom')),
  position   INTEGER NOT NULL CHECK (position >= 0),
  created_at INTEGER NOT NULL,
  UNIQUE (event_id, key),
  CHECK (length(key) BETWEEN 1 AND 40 AND key GLOB '[a-z]*' AND key NOT GLOB '*[^a-z0-9_]*'),
  CHECK (source = 'custom' OR key IN ('external_ref','phone','email','category','note')),
  CHECK (source = 'builtin' OR key NOT IN
    ('full_name','external_ref','phone','email','category','note','id','status','created_at','updated_at','has_qr'))
);
CREATE INDEX idx_event_fields_event ON event_fields(event_id, position);

ALTER TABLE participants ADD COLUMN attributes_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(attributes_json) AND length(attributes_json) <= 8192);
ALTER TABLE participants ADD COLUMN search_text TEXT NOT NULL DEFAULT '';
```

**Backfill (di migrasi yang sama, data produksi sudah ada):**

- Untuk tiap acara yang punya peserta dengan nilai `external_ref` / `phone` / `email` / `category` / `note` → sisipkan baris katalog `builtin` (urutan 0–4, label: "ID / Referensi", "Telepon", "Email", "Kategori", "Catatan").
- `UPDATE participants SET search_text = lower(…)` dari `full_name` + kolom builtin.
- Format `id` baris katalog tidak boleh diasumsikan (aplikasi memakai `newId()`).

**Invarian:**

| # | Aturan |
|---|---|
| I1 | `attributes_json` = objek datar `{"<key>": "<string ≤ 500>"}`. Kunci harus ada di katalog `custom` acara itu (dicek di domain, bukan di DB). Kunci ditolak bila `__proto__`, `constructor`, `prototype`. Parse ke `Map` / objek tanpa prototype. |
| I2 | `search_text` = huruf kecil, gabungan `full_name` + nilai builtin + semua nilai atribut. Ditulis oleh **satu** fungsi murni `buildSearchText` pada setiap insert/update/upsert. Tidak dirawat di sisi SQL. |
| I3 | Batas: ≤ 20 field `custom` per acara, ≤ 40 kolom per CSV, label ≤ 60, nilai ≤ 500 karakter, `attributes_json` ≤ 8 KB. |
| I4 | Katalog **hanya bertambah** pada tahap ini (tanpa ganti nama/hapus). |
| I5 | Kolom dan semantik lama tidak berubah → scan, kehadiran, dasbor, Sheets tetap bekerja. |
| I6 | **Tidak ada indeks baru.** `LIKE '%x%'` pada `search_text` tidak bisa memakainya, dan tiap indeks sekunder menambah baris ditulis (lihat `COSTS_AND_LIMITS.md`). |

**Turunan kunci field** (`deriveFieldKey(label, taken)`, murni): huruf kecil → buang diakritik → non-alfanumerik jadi `_` → pangkas ke 40 → awali `f_` bila diawali digit → hindari kunci reservasi/prototype → tabrakan diberi akhiran `_2`, `_3`. Label asli (sebagaimana diketik user) disimpan di `label`.

---

## 5. Kontrak API

Semua route di bawah `/api/events/:eventId`, otorisasi dievaluasi di Worker (bukan UI), respons memakai bentuk `{ ok, data | error }` yang sudah ada. Tipe dan skema zod ditaruh di `packages/shared`.

| Method | Path | Izin | Status |
|---|---|---|---|
| `GET` | `/participants/table` | `participant:read` | **BARU** |
| `POST` | `/participants/qr` | `qr:print` | **BARU** |
| `POST` | `/participants/import` | `participant:import` | **BERUBAH** (pemetaan kolom) |
| `GET` | `/participants/template` | `participant:import` | **BERUBAH** (header dari katalog) |
| `GET` | `/participants/export` | `participant:import` | **BERUBAH** (kolom dinamis) |
| `POST` | `/participants` | `participant:write` | **BERUBAH** (`attributes`) |
| `PATCH` | `/participants/:participantId` | `participant:write` | **BERUBAH** (`attributes`) |
| `GET` | `/participants/:participantId` | `participant:read` | **BERUBAH** (`attributes` + `fields`) |
| `GET` | `/participants` (daftar berkursor) | `participant:read` | Kontrak tetap; **pencarian** beralih ke `search_text` |
| `POST` | `/participants/qr-labels`, `GET/PUT /label-config` | — | **Tidak berubah** |

### 5.1 `GET /participants/table?query=&status=active|inactive|all`

```ts
interface EventFieldSummary {
  key: string;                       // "kelas", "phone", …
  label: string;                     // as typed by the user: "Kelas", "No. HP"
  source: "builtin" | "custom";
  position: number;
}

interface ParticipantTableRow {
  id: string;
  fullName: string;
  status: "active" | "inactive";
  /** Non-empty values only; builtin and custom share one key namespace. */
  values: Record<string, string>;
  hasQr: boolean;                    // NEVER the token, hash, or ciphertext
  updatedAt: number;
}

interface ParticipantTablePayload {
  fields: EventFieldSummary[];       // ordered by position; `fullName` is implicit and always first
  rows: ParticipantTableRow[];       // ORDER BY full_name, id; at most TABLE_MAX_ROWS
  total: number;                     // rows matching the filters (separate COUNT)
  truncated: boolean;                // total > rows.length
  qrMissing: number;                 // ACTIVE participants without a QR credential (banner)
}
```

`TABLE_MAX_ROWS` hidup di `packages/shared`, nilainya dari M0.

### 5.2 `POST /participants/qr` — pastikan kredensial ada, kembalikan payload

```ts
type QrSelection =
  | { kind: "ids"; participantIds: string[] }   // 1..50
  | { kind: "missing" }                          // up to `limit` ACTIVE participants without QR
  | { kind: "all"; cursor?: string };            // ACTIVE, keyset (created_at DESC, id DESC)

interface QrEnsureRequest {
  selection: QrSelection;
  limit?: number;                    // 1..QR_LABEL_BATCH_MAX (50), default 50
  fields?: string[];                 // ≤ 3 field keys for PDF captions (validated against the catalog)
  purpose: "prepare" | "view" | "download";
}

interface QrEnsureItem {
  participantId: string;
  qr: string;                        // scan payload "absensi:v1:<token>", exactly what /scan expects
  fullName: string;
  externalRef: string | null;
  values: Record<string, string>;    // only the requested `fields`, non-empty
}

interface QrEnsurePayload {
  items: QrEnsureItem[];
  issued: number;                    // newly created in this call
  remaining: number;                 // ACTIVE participants still without QR after this call
  nextCursor: string | null;         // only for kind "all"
  skipped: Array<{ participantId: string; reason: "inactive" | "not_found" }>;
}
```

Aturan:

- Hanya peserta **aktif** (paritas dengan label: peserta nonaktif tak pernah mendapat kredensial baru).
- ID dari acara lain = `not_found` dan **tidak pernah** di-query lintas acara.
- Penerbitan memakai ulang logika di `routes/labels.ts` lewat service bersama `services/qr-issuance.ts` (refactor murni; tes label tidak boleh berubah).
- Audit: aksi `qr.credentials_read`, `after = { count, issued, reused, purpose, selection: kind }`. **Tanpa** token/hash/ciphertext.
- Respons tidak pernah memuat hash, ciphertext, nonce, atau kunci.
- Acara `archived` **boleh** (paritas dengan cetak label).
- Anggaran: ≤ 5 ms p95 untuk 50 item (diukur di M0/M3).

### 5.3 `POST /participants/import` (berubah)

Body: `text/csv` mentah (auto-map, kompatibel mundur) **atau** JSON `{ csv: string, mapping?: ImportColumnMapping[] }`. Tetap `dry_run=true` secara default.

```ts
type ImportTarget =
  | "fullName" | "externalRef" | "phone" | "email" | "category" | "note"
  | "custom" | "ignore";

interface ImportColumnMapping { index: number; target: ImportTarget }

interface ImportColumnInfo {
  index: number;
  header: string;                    // as in the file
  target: ImportTarget;              // effective target (suggested or user-chosen)
  label: string;                     // field label that will be used
  suggested: boolean;                // true when the server chose it (no mapping sent)
  existingFieldKey: string | null;   // matched an existing catalog field
  samples: string[];                 // first 2 non-empty values, for the mapping UI
}
```

Respons dry-run **ditambah**: `columns: ImportColumnInfo[]`, `mappingIssues: string[]`, `newFields: string[]` (label field baru yang akan dibuat), dan `sample[]` kini membawa `values` dinamis.

- Masalah level-header (tidak ada kolom Nama, Nama ganda, melebihi 20 field bebas) kembali sebagai **`mappingIssues` pada dry-run (HTTP 200)** agar UI bisa menampilkannya. Konfirmasi (`dry_run=false`) **menolak** selama `mappingIssues` tidak kosong.
- Galat format file (kosong, kutip tak tertutup, > 1.000 baris, > 2 MB) tetap 400/413 seperti sekarang.
- **Konfirmasi** menulis katalog + peserta dalam satu operasi (lihat risiko batch di §8 dan keputusan M0).
- Impor ulang pada `external_ref` yang sama: baca atribut lama (`findExistingRefs` diperluas), gabungkan lewat `mergeAttributes` di domain — **sel kosong menghapus kunci itu; kunci yang tidak ada di CSV tidak disentuh** — lalu tulis `attributes_json` + `search_text` utuh. Tidak memakai `json_patch` supaya `search_text` selalu konsisten.
- Validasi per baris seperti sekarang (nama ≤ 120, ref ≤ 64, normalisasi telepon/email, duplikat dalam file) + nilai ≤ 500 dan `attributes_json` ≤ 8 KB. Baris tak valid dilewati dan dilaporkan per nomor baris.
- Field katalog hanya dibuat bila ≥ 1 baris valid benar-benar menulisnya.

### 5.4 Template, ekspor, buat/ubah/detail

- **Header** template dan ekspor = `["Nama", ...katalog berurutan]` memakai **label** katalog, sehingga ekspor → impor ulang terpetakan otomatis ke field yang sama. Katalog kosong → `Nama, ID / Referensi, Telepon, Email, Kategori, Catatan`.
- Proteksi formula-injection (`escapeCsvCell`) berlaku juga untuk nilai field bebas; telepon tetap dikecualikan seperti sekarang.
- `POST/PATCH` menerima `attributes` (`Record<string,string>`, PATCH boleh `null` untuk menghapus). **Kunci yang tak ada di katalog → 400** (field baru hanya lahir dari impor). Nilai builtin yang belum ada di katalog → baris katalog `builtin` ditambahkan otomatis pada operasi yang sama.
- `GET /participants/:id` mengembalikan `participant` (dengan `attributes`) **dan** `fields`.

---

## 6. Spesifikasi UI (tab Peserta)

### 6.1 Status halaman

| Kondisi | Tampilan |
|---|---|
| Memuat | `LoadingState` yang sudah ada |
| Galat | `ErrorState` + coba lagi |
| **Kosong** (`total = 0`, tanpa filter/pencarian) | Kartu **di tengah** area konten (vertikal dan horizontal): ikon, judul **"Belum ada peserta"**, teks "Impor daftar peserta dari file CSV. Kolom apa pun yang Anda isi akan menjadi kolom tabel.", tombol utama **"Tambah peserta dari CSV"** (→ `importPath`), tautan sekunder "Unduh template CSV". Petugas / acara arsip: ganti tombol dengan `Notice` penjelasan. |
| Tak ada yang cocok (filter aktif, hasil 0) | Teks "Tidak ada peserta yang cocok dengan “…”." + tombol "Hapus pencarian" |
| Berisi | Toolbar + banner (bila perlu) + tabel + paginasi |

### 6.2 Toolbar

`[ Cari… ]  [ Status ▾ ]  [ + Peserta ]  [ ⋮ ]`

- Cari: menyaring baris yang sudah dimuat (instan, sisi klien). Bila `truncated`, pencarian dikirim ke server (debounce 300 ms) lalu muat ulang tabel.
- Status: Aktif (default) / Nonaktif / Semua → query server.
- "+ Peserta": form tambah manual (lihat 6.5). Disembunyikan untuk petugas dan acara arsip.
- ⋮: lihat 6.4.

### 6.3 Tabel

- **Kolom**: `Nama` (lengket di kiri, selalu pertama) → field katalog berurutan `position`. Kolom `Status` hanya muncul bila filter ≠ Aktif.
- **Tidak ada kolom/pratinjau QR** (R5).
- **Urut**: header = `<button>` di dalam `<th aria-sort>`; siklus klik **tanpa → naik → turun**; ikon panah. Bawaan: `Nama` naik. Satu kolom saja.
- **Aturan pembanding** (`lib/participant-table.ts`, murni): `Intl.Collator("id", { numeric: true, sensitivity: "base" })`; nilai kosong **selalu di akhir**, baik naik maupun turun; penentu seri stabil: `Nama` lalu `id`.
- **Paginasi sisi klien**: 25 / 50 / 100 baris (bawaan 50); "Menampilkan a–b dari n"; hanya irisan halaman yang dirender (perangkat lemah).
- **Baris**: sel pertama berisi `<button>` nama (Enter/Spasi membuka panel); seluruh baris juga bisa diklik; baris terpilih disorot saat panel terbuka.
- **Layar kecil**: gulir horizontal dengan kolom Nama lengket; tidak berubah jadi kartu.
- Bila `truncated`: banner "Menampilkan {rows} dari {total} peserta. Gunakan pencarian untuk menemukan peserta lain."

### 6.4 Menu ⋮ (toolbar, sadar peran)

```
Unduh QR (ZIP berisi PNG)…
Unduh QR (PDF)…
───────────────
Impor peserta (CSV)
Unduh template CSV
Ekspor peserta (CSV)
───────────────
Cetak label QR            → halaman Label QR yang sudah ada
```

- Tampil untuk admin acara dan superadmin. **Petugas: menu tidak dirender** (izin `participant:import` / `qr:print` ada di admin).
- Acara arsip: "Impor peserta" dinonaktifkan dengan keterangan "Acara diarsipkan"; unduh QR dan ekspor tetap boleh.
- "Ekspor peserta" mengikuti filter/pencarian aktif (perilaku saat ini).
- Aksesibilitas: tombol pemicu `aria-haspopup="menu"` + `aria-expanded`; item `role="menuitem"`; panah atas/bawah, Home/End; Esc menutup dan mengembalikan fokus ke pemicu; klik di luar menutup. Tanpa pustaka menu baru.

### 6.5 Panel detail (drawer)

Dibuka dengan klik baris; URL → `participantPath(eventId, id)`; Back menutup.

```
┌ {Nama}                          [status] [✕] ┐
│        ┌───────────┐                          │
│        │   QR      │  ← SVG (QrCode), ≥ 240px │
│        └───────────┘                          │
│  [ Unduh PNG ]  [ Unduh PDF ]                 │
│  ───────────────────────────────              │
│  Kelas        7A                              │
│  Telepon      +62812…                         │
│  (semua field katalog, kosong = "—")          │
│  Ditambahkan … · diperbarui …                 │
│  [ Ubah data ]  [ Nonaktifkan / Aktifkan ]    │
└───────────────────────────────────────────────┘
```

- QR diambil saat panel terbuka lewat `POST /participants/qr` (`ids`, `purpose: "view"`), **hanya** bila peran punya `qr:print` **dan** peserta aktif. Memuat → kerangka; gagal → tombol coba lagi.
- Peserta nonaktif: ganti QR dengan teks "Peserta nonaktif tidak memiliki QR aktif." (tidak menerbitkan kredensial).
- Petugas: tanpa QR, teks "QR hanya dapat dilihat admin acara."
- **QR tanpa logo tengah** (`centerLogo` mati) supaya keterbacaan maksimal.
- "Ubah data"/"Nonaktifkan": perilaku sekarang dari `participant-detail.tsx`, dipindah ke komponen panel.
- Form ubah/tambah (`participant-form.tsx`): `Nama` (wajib) + satu input per field katalog; builtin yang belum ada di katalog muncul di bawah disclosure "Detail lain" (tertutup). Validasi builtin seperti sekarang; field bebas = teks ≤ 500.
- `pages/participant-detail.tsx` dihapus setelah isinya pindah; route `participant` tetap ada di `router.ts`.

### 6.6 Impor (`pages/import.tsx`, ditulis ulang)

1. **Pilih file** (≤ 2 MB). Otomatis menjalankan dry-run tanpa `mapping`.
2. **Pemetaan kolom**: tabel `Kolom CSV | Contoh isi | Jadikan…` dengan `<select>` target. Saran server terisi dan diberi tanda "disarankan". Ubah target → dry-run ulang (debounce) dengan `mapping`. `mappingIssues` tampil sebagai `Notice` merah dan **menonaktifkan** tombol impor. Field bebas baru ditandai "Kolom baru".
3. **Pratinjau**: statistik (baris/valid/baru/diperbarui), contoh baris memakai kolom dinamis, daftar baris dilewati.
4. **Konfirmasi** "Impor sekarang (N baris)" → hasil → **QR disiapkan otomatis** (6.7) → tombol "Lihat daftar peserta".

Alias header awal (satu sumber kebenaran di domain, **diuji**; normalisasi: huruf kecil, buang diakritik dan non-alfanumerik):

| Target | Alias |
|---|---|
| Nama | `nama`, `namalengkap`, `namapeserta`, `fullname`, `name` |
| ID / Referensi | `externalref`, `ref`, `referensi`, `nomorreferensi`, `id`, `idpeserta`, `nis` |
| Telepon | `telepon`, `telp`, `nohp`, `nomorhp`, `hp`, `phone`, `whatsapp`, `wa` |
| Email | `email`, `surel` |
| Kategori | `kategori`, `category`, `jenis` |
| Catatan | `catatan`, `keterangan`, `note`, `notes` |

Kolom lain (mis. "Kelas", "Nama Orang Tua") → **Field bebas**. Jangan menebak `nik`/data sensitif lain sebagai alias.

### 6.7 QR otomatis

Hook `useQrPreparation(eventId)` (logika murni di `lib/qr-preparation.ts`, mudah diuji dengan fetch palsu):

- `start()` memanggil `qr` dengan `{ kind: "missing" }`, `purpose: "prepare"`, `limit: 50` berulang sampai `remaining === 0`.
- Status: `idle | running | done | error`; progres `prepared / total` (total = `qrMissing` awal).
- `cancel()` menghentikan siklus berikutnya. Galat → berhenti + tombol "Lanjutkan".
- Dipakai di (a) halaman impor setelah sukses, (b) banner tab Peserta: **"{N} peserta aktif belum memiliki QR. [Siapkan QR]"**, (c) setelah tambah peserta manual (best-effort satu panggilan `ids`; bila gagal, banner yang menutup).
- Setelah selesai, muat ulang tabel (`hasQr`/`qrMissing`).

### 6.8 Dialog unduh QR (`<dialog>` bawaan)

- **Cakupan**: "Semua peserta aktif (N)" · "Sesuai pencarian saat ini (M)" (nonaktif bila M = N).
- **PDF saja**: Format `A4 (3 × 8)` / `Stiker 50 × 30 mm`; "Teks di bawah QR": `Nama` (selalu) + maks 2 field katalog.
- Progres "Menyiapkan 120 dari 500…" + tombol **Batal**; UI tetap responsif (beri jeda ke event loop tiap kepingan).
- Nama berkas: `qr-{slug-acara}-{YYYYMMDD}.zip` / `.pdf`.
- Unduh lewat `Blob` + `<a download>`; `URL.revokeObjectURL` sesudahnya; kosongkan larik token dari memori setelah selesai.

