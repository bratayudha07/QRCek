# ADR-0014 — Kategori dan custom field peserta

| Atribut | Nilai |
|---|---|
| Status | **Diusulkan** — jawaban AQ-006; menunggu adopsi pemilik proyek sebelum Q2 dibuka |
| Tanggal | 2026-11-04 |
| Menjawab | AQ-006 (`docs/ARCHITECTURE.md` §6) |
| Terkait kebutuhan | `FR-026`–`FR-036`, `FR-013`–`FR-025`; `BR-010`–`BR-017`, `BR-061`, `BR-063`, `BR-077`; `AC-006`–`AC-008`, `AC-042`, `AC-054`; `D-003` [A], `D-008` [A], `D-020` [A] |
| Memblokir | Q2 (peserta, kategori, custom field, impor CSV) |
| Dampak | Skema `migrations/0008_*`, tipe + validator di `packages/shared`, bentuk impor CSV, dan penyimpanan nilai per peserta |

## Konteks

`REQUIREMENTS.md` menetapkan: kategori adalah entitas tingkat Tema (`FR-034`) yang membantu menentukan entitlement (`FR-035`); custom field punya sembilan tipe (`FR-027`), nama/deskripsi/tipe/required/opsi/urutan/aktif (`FR-028`); dan operasi rename, nonaktifkan, arsip, serta ubah tipe **tidak boleh menghapus data** (`FR-029`–`FR-032`, `BR-013`–`BR-016`, `AC-008`). Field khusus Aktivitas (nomor kursi, baris, meja) tidak boleh bercampur dengan profil inti peserta (`FR-033`, `BR-017`).

Dua kendala membentuk pilihan penyimpanan:

1. **Anggaran tulis D1** 100.000 baris/hari, dan setiap indeks menambah satu baris tulis (`COSTS_AND_LIMITS.md` §3.3). Import 1.000 peserta sudah memakai ~5.000 baris (≈5% kuota); desain yang mengalikan angka itu per field akan menghabiskan kuota pada satu acara.
2. **Tidak ada migrasi data produksi** (`D-007` [A]), jadi skema boleh aditif tanpa backfill, tetapi tetap tidak boleh mengedit migrasi lama.

Usulan lama di arsip `PLAN_TAB_PESERTA.md` §3–4 (katalog field per acara + `attributes_json`, menolak EAV) hanya mendukung nilai teks dan katalog yang "hanya bertambah", sehingga tidak memenuhi `FR-027`–`FR-032`. Usulan itu dievaluasi ulang di sini, bukan disalin.

Kategori **tidak** dijadikan opsi desain: `FR-017` mewajibkan kategori, dan `FR-035` menghubungkannya ke entitlement. Teks bebas pada `participants.category` (baseline) tidak dapat memenuhi keduanya.

## Opsi

### Penyimpanan nilai custom field

1. **EAV penuh** — tabel `participant_field_values (participant_id, field_id, value_text, value_number, …)`, satu baris per nilai. Query per field menjadi SQL biasa, tetapi satu peserta dengan 9 field = 9 baris + indeks; import 1.000 peserta menjadi ≥ 18.000 baris tulis (≈18% kuota), dan setiap update peserta menulis ulang N baris. Ditolak.
2. **Katalog + `attributes_json` (rekomendasi)** — definisi field di tabel `custom_fields`, nilai disimpan sebagai satu kolom JSON per peserta. Satu peserta = satu baris. Tidak ada indeks per field; penyaringan/laporan per field memakai `json_extract` (JSON1 terverifikasi tersedia: `json_valid`, `json_extract`, `json_type` diuji pada D1 lokal 4 November 2026).
3. **Kolom dinamis** — `ALTER TABLE participants ADD COLUMN` per field. `ALTER TABLE` D1 terbatas, tidak dapat dibalik, dan membocorkan struktur Tema ke skema global. Ditolak.

### Ruang lingkup field Aktivitas

1. Simpan nilai field Aktivitas di `participants.attributes_json` dengan prefiks — sederhana, tetapi melanggar `FR-033`: nilai per Aktivitas menjadi bagian profil peserta dan ikut tersalin saat duplikasi/ekspor profil.
2. **Definisi di Q2, nilai ditunda (rekomendasi)** — `custom_fields.scope` membedakan `participant` dan `activity`; Q2 hanya menyimpan katalog + validator, sedangkan nilai per Aktivitas menempel pada tabel penugasan/entitlement di Q3 (AQ-005). Tidak ada kolom nilai Aktivitas di `participants`.

## Keputusan (usulan)

**Opsi 2 untuk nilai, Opsi 2 untuk ruang lingkup Aktivitas.**

### `categories`

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | TEXT PK | ULID |
| `theme_id` | TEXT NOT NULL → `events(id)` ON DELETE RESTRICT | Kategori milik satu Tema (`FR-034`) |
| `name` | TEXT NOT NULL | 1–60 karakter, unik per Tema (`COLLATE NOCASE`) |
| `description` | TEXT NULL | ≤ 200 karakter |
| `sort_order` | INTEGER NOT NULL DEFAULT 0 | Urutan tampilan |
| `status` | TEXT NOT NULL DEFAULT 'active' | `active` \| `archived` |
| `created_at`/`created_by`/`updated_at`/`updated_by`/`archived_at` | | Pola sama dengan `activities` |

- `participants.category_id` NOT NULL → `categories(id)` ON DELETE RESTRICT. Peserta tidak boleh kehilangan kategori.
- Kategori tidak pernah di-hard-delete; arsip menyembunyikannya dari pilihan baru tanpa mengubah peserta lama (`AC-008`).
- Kategori `archived` menolak penugasan baru (`422`), tetapi peserta yang sudah memakainya tetap valid dan tetap bisa check-in selama peserta aktif. Menolak kehadiran karena kategori diarsipkan akan melanggar `FR-020`/`FR-024`.

### `custom_fields`

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | TEXT PK | ULID (dirujuk audit; nilai tetap disimpan per `key`) |
| `theme_id` | TEXT NOT NULL → `events(id)` ON DELETE RESTRICT | |
| `key` | TEXT NOT NULL | Slug stabil (`[a-z][a-z0-9_]{0,39}`), **tidak pernah berubah**; unik per Tema termasuk yang sudah diarsipkan |
| `label` | TEXT NOT NULL | Boleh di-rename (`FR-029`) |
| `description` | TEXT NULL | Boleh diubah (`FR-029`) |
| `type` | TEXT NOT NULL | `text` \| `number` \| `email` \| `phone` \| `select` \| `multi_select` \| `date` \| `textarea` \| `checkbox` |
| `required` | INTEGER NOT NULL DEFAULT 0 | 0/1 |
| `options_json` | TEXT NULL | Wajib untuk `select`/`multi_select`; `CHECK json_valid` |
| `scope` | TEXT NOT NULL DEFAULT 'participant' | `participant` \| `activity` (`FR-033`) |
| `sort_order` | INTEGER NOT NULL DEFAULT 0 | |
| `status` | TEXT NOT NULL DEFAULT 'active' | `active` \| `archived` |
| `created_at`/`created_by`/`updated_at`/`updated_by`/`archived_at` | | |

- `key` imutabel karena nilai tersimpan di JSON dengan kunci itu. Rename tampilan memakai `label`.
- `key` tidak boleh dipakai ulang setelah arsip: nilai lama akan terbaca sebagai nilai field baru. Karena itu unik mencakup baris terarsip.
- Batas yang diusulkan: 50 field aktif per Tema, 100 opsi per field `select`/`multi_select`.
- Tipe yang salah diperbaiki dengan membuat field baru, bukan dengan mengubah `type` (lihat di bawah).

### Penyimpanan nilai

```sql
ALTER TABLE participants ADD COLUMN attributes_json TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(attributes_json));
```

- Kunci JSON = `custom_fields.key` dengan `scope='participant'`. Field asing dibuang saat validasi, bukan disimpan diam-diam.
- Representasi: `text`/`textarea`/`email`/`phone`/`select` → string; `number` → number; `checkbox` → boolean; `date` → integer ms epoch UTC (semua waktu UTC, `AGENTS.md`); `multi_select` → array of string.
- Validasi bentuk nilai dilakukan oleh fungsi murni di `packages/shared` (`validateParticipantAttributes(fields, values) → { ok, errors[] }`), dipakai di boundary Worker **dan** impor CSV. Database hanya menjamin JSON valid, bukan skema isinya — konsekuensi yang diterima.
- Nilai field Aktivitas menempel pada tabel penugasan/entitlement di Q3, tidak di `participants` (`FR-033`).

### Perubahan tipe (`FR-032`, `BR-016`)

Diizinkan hanya bila **semua** nilai tersimpan tetap valid pada tipe baru, memakai matriks berikut (tanpa kehilangan data):

| Dari | Boleh ke | Syarat |
|---|---|---|
| `text` | `textarea`, `select`, `multi_select` (satu opsi), `email`, `phone` | Semua nilai cocok pola/opsi tujuan; `select`/`multi_select` butuh `options_json` |
| `number` | `text` | Nilai diubah menjadi string saat baca, bukan ditulis ulang |
| `date` | `text` | Sama: representasi, bukan penulisan ulang |
| `select` | `text` | |
| `checkbox` | `text` | |
| lainnya | ditolak `422 BUSINESS_RULE` | Termasuk semua konversi ke `number`/`date`/`checkbox` |

Operasi yang ditolak menghasilkan `422` dengan daftar `key` yang gagal — bukan pemotongan data diam-diam. Bila admin memang butuh tipe lain, buat field baru dan arsipkan yang lama (`FR-031`).

### Required dan impor

- `required` ditegakkan saat **membuat** peserta dan saat nilai **dikirim** pada update/impor.
- Sel CSV kosong tidak mengubah nilai lama (`BR-077`, `AC-054`), sehingga peserta lama bertahan tanpa perlu "mengisi ulang" field required.
- Baris impor yang kehilangan field required **ditolak seluruhnya** (`FR-050`: tolak baris tidak valid, jangan simpan setengah).
- `D-008` [A] tetap berlaku: tidak ada merge otomatis; nama/email/phone yang sama hanya menghasilkan warning.

## Konsekuensi

- Migrasi Q2 adalah `0008_*` (additive): `categories`, `custom_fields`, kolom `participants.category_id` + `participants.attributes_json`. Tidak ada backfill (`D-007`), tetapi peserta yang dibuat lewat impor baru wajib punya kategori.
- Kategori dan custom field memakai pola audit Q1 (`ADR-0011` allowlist, audit dalam `db.batch()` yang sama). `attributes_json` **tidak** masuk snapshot audit utuh; yang dicatat hanya daftar `key` yang berubah (`FR-207`), karena nilainya bisa berisi email/telepon.
- Biaya tulis tetap satu baris per peserta per operasi: import 1.000 peserta ≈ 5 baris/baris (baris peserta + indeks), bukan 5 × jumlah field.
- Tidak ada indeks per custom field pada Q2. Bila laporan per field dibutuhkan (Q8), opsi yang tersedia: generated column + indeks untuk field tertentu, atau tabel agregat — diputuskan saat itu dengan pengukuran, bukan ditebak sekarang.
- Pengujian wajib: `AC-008` (rename/nonaktif/arsip/ubah tipe tidak menghapus data), `AC-006` (field inti + Participant ID), `AC-042`/`AC-054` (impor tanpa merge, field kosong tidak menghapus), plus tes bahwa menghapus validasi tipe membuat tes `AC-008` gagal.
- `FR-033` dipenuhi secara struktural: definisi field Aktivitas tidak pernah masuk `participants.attributes_json`.

## Pertanyaan yang perlu diputuskan pemilik proyek

1. Batas 50 field aktif dan 100 opsi per field — cukup atau terlalu ketat?
2. Apakah field Aktivitas perlu **dapat dikelola** di UI Q2, atau cukup tersedia di API sampai Q6/Q9 (UI Aktivitas/Sesi belum ada)?
3. Apakah `category_id` wajib sejak Q2 untuk peserta hasil impor, atau boleh kosong sementara dengan kategori default per Tema (memengaruhi `FR-017`)?

## Referensi

- `REQUIREMENTS.md` §4.4–§4.6, §5 (`BR-010`–`BR-017`), §9 (`AC-006`–`AC-008`, `AC-042`, `AC-054`).
- `COSTS_AND_LIMITS.md` §3.3 (anggaran baris tulis).
- `PLAN_TAB_PESERTA.md` §3–§4 (arsip, usulan lama yang dievaluasi ulang).
- `docs/ARCHITECTURE.md` §6 AQ-006, AQ-005 (entitlement, Q3).
