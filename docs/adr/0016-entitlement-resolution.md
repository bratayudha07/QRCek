# ADR-0016 — Representasi dan resolusi entitlement

| Atribut | Nilai |
|---|---|
| Status | **Diterima** 8 November 2026 — menjawab AQ-005 |
| Tanggal | 2026-11-07 (draf); 2026-11-08 (diterima) |
| Menjawab | AQ-005 (`docs/ARCHITECTURE.md` §6) — **dijawab** |
| Terkait kebutuhan | `FR-037`–`FR-045`, `FR-199`; `BR-018`–`BR-023`, `BR-075`; `AC-011`–`AC-014`, `AC-043`; `D-005` [A] |
| Dampak | Skema `migrations/0009_*`, tabel `entitlement_rules`, resolver murni di `packages/shared`/`apps/api/src/domain`, route konfigurasi, audit, dan gate `FR-040`/`FR-041`. Q3 dibuka 8 November 2026. |

## Konteks

`REQUIREMENTS.md` menetapkan lima tingkat entitlement (`FR-037`) dengan prioritas tetap (`FR-038`):

1. Individual–Session
2. Category–Session
3. Individual–Activity
4. Category–Activity
5. Theme default

Setiap tingkat dapat berstatus **Inherit**, **Allowed**, atau **Denied** (`FR-039`). Entitlement Sesi mewarisi Aktivitas kecuali di-override, dan override Sesi hanya berlaku untuk Sesi itu (`FR-039`, `BR-023`). Perubahan aturan kategori tidak boleh menghapus override individual (`FR-042`, `BR-020`, `AC-014`). Perubahan entitlement hanya berlaku untuk transaksi berikutnya (`FR-199`, `BR-075`, `AC-043`).

Q3 hanya membangun konfigurasi dan resolver. Penolakan di endpoint scan dan tampilan scanner adalah Q5/Q6. Meski begitu, bentuk data dan resolver harus sudah memenuhi anggaran baca D1 dan bisa dipakai apa adanya di jalur scan.

Kendala yang membentuk pilihan:

1. **Anggaran baca/CPU.** Satu scan harus tetap satu request kecil dengan beberapa query terindeks; resolver tidak boleh N+1 per kategori/Aktivitas.
2. **Konfigurasi bersifat matriks, bukan pohon.** Jumlah aturan = kategori × Aktivitas (dan Sesi untuk override). Menyimpan salinan "entitlement efektif" per peserta per Aktivitas akan menggelembungkan baris tulis dan cepat basi saat kategori peserta berubah.
3. **Audit append-only.** Setiap perubahan aturan harus tercatat dalam `db.batch()` yang sama, tanpa PII.
4. **Perubahan kategori peserta tidak boleh menghapus override individual.**

## Opsi yang dievaluasi

### A. Satu tabel aturan ternormalisasi (rekomendasi)

Satu tabel `entitlement_rules` menyimpan baris aturan yang benar-benar diisi. Tingkat diturunkan dari kolom yang terisi: subjek (`participant_id` atau `category_id`) dan konteks (`activity_id`, `session_id`). Theme default adalah baris dengan semua kolom konteks/subjek `NULL`.

- Satu tempat untuk constraint unik, audit, dan query resolver.
- Baris hanya dibuat untuk aturan yang dikonfigurasi; tidak ada matriks penuh yang wajib ada untuk setiap peserta.
- Priority dijalankan oleh resolver murni, bukan oleh urutan baris di database.

### B. Tabel terpisah per tingkat (lima tabel)

`individual_session_rules`, `category_session_rules`, dan seterusnya. Setiap tabel lebih sempit, tetapi resolver harus menggabungkan lima query/tabel, constraint lintas Tema tersebar, audit harus mengenal lima nama entitas, dan perubahan bentuk prioritas menyentuh lima tempat. Ditolak.

### C. Salinan entitlement efektif per peserta × Aktivitas

Tabel `participant_effective_entitlements` yang diperbarui saat kategori berubah atau aturan berubah. Resolver menjadi satu lookup, tetapi:

- satu perubahan aturan kategori dapat menulis ulang ribuan baris;
- `FR-042`/`AC-014` berisiko jika rebuild menghapus override individual;
- data bisa basi bila ada jalur tulis yang lupa memperbarui salinan;
- kuota tulis D1 100.000 baris/hari tidak mendukung pola ini.

Ditolak.

### D. JSON aturan di `activities`/`events`

Satu kolom JSON berisi matriks kategori → status. Sederhana untuk dibaca sekaligus, tetapi tidak punya constraint unik per sel, sulit mengaudit perubahan satu sel, rawan lost update saat dua admin menyimpan bersamaan, dan tidak bisa diindeks per peserta. Ditolak.

## Keputusan

**Opsi A.** Satu tabel `entitlement_rules`, resolver murni, dan default **deny** bila tidak ada aturan yang menentukan. Disetujui pemilik proyek 8 November 2026.

### Skema usulan (`migrations/0009_entitlement_rules.sql`)

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
     AND ((participant_id IS NOT NULL) <> (category_id IS NOT NULL))) -- level 1–4
  )
);
```

Tingkat dibaca dari kombinasi kolom:

| Tingkat | `activity_id` | `session_id` | `participant_id` | `category_id` |
|---|---|---|---|---|
| Individual–Session | NOT NULL | NOT NULL | NOT NULL | NULL |
| Category–Session | NOT NULL | NOT NULL | NULL | NOT NULL |
| Individual–Activity | NOT NULL | NULL | NOT NULL | NULL |
| Category–Activity | NOT NULL | NULL | NULL | NOT NULL |
| Theme default | NULL | NULL | NULL | NULL |

Constraint unik memakai **partial unique index** karena SQLite menganggap `NULL` berbeda dalam indeks unik:

```sql
CREATE UNIQUE INDEX uq_ent_theme_default
  ON entitlement_rules(theme_id)
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

Trigger `BEFORE INSERT`/`BEFORE UPDATE` menegakkan konteks lintas entitas, mengikuti pola Q2:

- `category_id` harus milik `theme_id` yang sama.
- `participant_id` harus milik `theme_id` yang sama.
- `activity_id` harus milik `theme_id` yang sama.
- `session_id` harus milik `activity_id` yang sama dan Aktivitas itu harus milik `theme_id` yang sama.

Tidak ada endpoint yang boleh membuat aturan lintas Tema; trigger adalah pertahanan terakhir, bukan satu-satunya validasi.

### Resolver murni

```ts
type EntitlementStatus = 'inherit' | 'allowed' | 'denied';
type EntitlementLevel =
  | 'individual_session'
  | 'category_session'
  | 'individual_activity'
  | 'category_activity'
  | 'theme_default';

interface EntitlementContext {
  participantId: string;
  categoryId: string;
  activityId: string;
  sessionId: string | null;
}

interface EntitlementRule {
  level: EntitlementLevel;
  status: EntitlementStatus;
}

function resolveEntitlement(
  context: EntitlementContext,
  rules: readonly EntitlementRule[],
): {
  allowed: boolean;
  decidedBy: EntitlementLevel | null;
  status: EntitlementStatus;
};
```

Aturan evaluasi:

1. Iterasi lima tingkat sesuai prioritas `FR-038`.
2. Tingkat yang tidak relevan dilewati: aturan Sesi hanya dipakai bila `sessionId` ada; aturan individual hanya dipakai bila `participantId` cocok; aturan kategori hanya dipakai bila `categoryId` cocok.
3. Status `inherit` berarti **lanjut ke tingkat berikutnya**, bukan "allowed".
4. Status `allowed` atau `denied` pada tingkat pertama yang menentukan langsung menjadi hasil. `denied` di tingkat lebih tinggi tidak bisa ditimpa `allowed` di tingkat lebih rendah.
5. Bila semua aturan `inherit` atau tidak ada aturan yang cocok, hasilnya **denied** dengan `decidedBy = null`. Fail-closed ini disengaja: salah konfigurasi tidak boleh membuka akses.
6. Hasil menyertakan `decidedBy` untuk audit/log dan pesan scanner nanti; tidak menyertakan nama/email peserta.

Resolver tidak menyentuh database. Pengambilan baris dilakukan pemanggil dengan satu statement:

```sql
SELECT 'individual_session' AS level, status FROM entitlement_rules
 WHERE theme_id = ? AND participant_id = ? AND activity_id = ? AND session_id = ?
UNION ALL
SELECT 'category_session', status FROM entitlement_rules
 WHERE theme_id = ? AND category_id = ? AND activity_id = ? AND session_id = ?
UNION ALL
SELECT 'individual_activity', status FROM entitlement_rules
 WHERE theme_id = ? AND participant_id = ? AND activity_id = ? AND session_id IS NULL
UNION ALL
SELECT 'category_activity', status FROM entitlement_rules
 WHERE theme_id = ? AND category_id = ? AND activity_id = ? AND session_id IS NULL
UNION ALL
SELECT 'theme_default', status FROM entitlement_rules
 WHERE theme_id = ? AND activity_id IS NULL AND session_id IS NULL
   AND participant_id IS NULL AND category_id IS NULL;
```

Branch Sesi hanya dijalankan bila `sessionId` ada. Setiap branch cocok dengan partial unique index-nya; satu scan menghasilkan paling banyak lima baris. Jumlah statement dan waktu eksekusi harus diukur di Q3 dan dicatat di `docs/OPERASIONAL.md` sebelum Q3 ditutup.

### Penulisan dan audit

- Konfigurasi ditulis lewat upsert per sel; constraint unik mengubah duplikat menjadi konflik terdefinisi (`409`/`422`), bukan `500`.
- Setiap create/update aturan menulis audit di `db.batch()` yang sama. Snapshot allowlist hanya memuat ID Tema/Aktivitas/Sesi/peserta/kategori dan `status`; tidak ada nama, email, telepon, atau nilai custom field.
- Menghapus aturan individual adalah operasi eksplisit dan diaudit. Menghapus aturan kategori/Aktivitas tidak boleh menghapus baris individual (`FR-042`).
- Perubahan aturan tidak menulis ulang transaksi lama dan tidak membuat reversal. Tidak ada snapshot entitlement pada transaksi; resolusi hanya terjadi saat transaksi baru dibuat (`FR-199`, `AC-043`).

## Keputusan `FR-040`/`FR-041` (diputuskan 8 November 2026)

`FR-040` mewajibkan Admin mengonfigurasi entitlement setiap kategori saat Aktivitas baru dibuat; `FR-041` melarang Aktivitas baru otomatis memakai Theme-wide entitlement sebagai konfigurasi final. Titik penegakan sudah diputuskan pemilik proyek:

| # | Pertanyaan | Keputusan |
|---|---|---|
| 1 | Kapan kewajiban konfigurasi ditegakkan? | Aktivitas dibuat sebagai `draft`; transisi `draft → active` ditolak (`422 BUSINESS_RULE`) sampai matriks lengkap. `POST` Aktivitas tidak diblokir. |
| 2 | Apa arti "eksplisit"? | Satu baris `category_id + activity_id` wajib ada untuk setiap kategori aktif. Status boleh `inherit`, `allowed`, atau `denied`; `inherit` adalah pilihan sadar admin, bukan pewarisan otomatis. |
| 3 | Kategori baru setelah Aktivitas aktif | Aktivitas dianggap **belum lengkap secara terhitung** (`entitlementComplete = false`). Kategori lama tetap berjalan; kategori baru `denied` oleh default sampai barisnya dibuat. Aktivitas tidak dinonaktifkan. |
| 4 | Aktivitas lama saat migrasi `0009` | Backfill eksplisit `allowed` untuk setiap Aktivitas × kategori yang sudah ada di Tema yang sama, termasuk kategori arsip yang masih punya peserta, agar check-in lama tidak berubah. Dicatat sebagai pengecualian migrasi. |
| 5 | Peran Theme default | Fallback yang hanya tercapai lewat `inherit` eksplisit. Tidak disalin menjadi baris Aktivitas saat Aktivitas dibuat. |

Catatan implementasi:

- Kelengkapan matriks **dihitung**, bukan disimpan sebagai flag: jumlah kategori aktif di Tema dibandingkan dengan jumlah baris `category_activity` untuk Aktivitas itu. Flag tersimpan akan basi saat kategori ditambah/diarsipkan.
- Kategori yang diarsipkan tidak lagi dihitung untuk kelengkapan Aktivitas, tetapi barisnya tetap ada dan tetap berlaku untuk peserta yang sudah memakainya (`FR-020`, `FR-024`).
- Backfill `0009` sengaja memasukkan kategori arsip yang punya peserta. Tanpa itu, peserta lama di kategori arsip akan jatuh ke default deny saat Q5 mulai menegakkan resolver.
- Respons API kelengkapan memuat `entitlementComplete` dan `missingCategoryIds`; UI Q9 yang menampilkannya.

## Konsekuensi

- Q3 menambah migrasi `0009_*` (additive; `0001`–`0008` tidak diedit), tabel `entitlement_rules`, lima partial unique index, trigger konteks, route konfigurasi, resolver murni, dan tes tabel. `schema_version` baru menjadi `9` saat migrasi diterapkan.
- Tidak ada UI di Q3. Konfigurasi diekspos lewat API dan dipakai Q9 untuk tampilan.
- Q5 memanggil resolver **sebelum** menulis transaksi. Hasil `denied` menjadi `NOT_ENTITLED` (`D-011` [A]) dan tidak boleh menghasilkan baris attendance/consumption (`FR-044`, `BR-022`).
- Kategori yang diarsipkan tetap dapat di-resolve untuk peserta yang sudah memakainya; Q2 sudah menolak penugasan baru ke kategori arsip. Menolak transaksi karena kategori diarsipkan akan melanggar `FR-020`/`FR-024`.
- Perubahan kategori peserta mengubah aturan kategori yang berlaku pada transaksi berikutnya, tetapi tidak menyentuh aturan individual (`FR-042`). Riwayat transaksi tidak berubah (`AC-043`).
- Biaya konfigurasi sebanding dengan jumlah sel yang benar-benar diisi, bukan kategori × Aktivitas × peserta. Membuat satu Aktivitas dengan 20 kategori = sekitar 20 baris aturan + indeks + audit, masih jauh di bawah anggaran harian.
- Backfill `0009` menulis satu baris `allowed` per Aktivitas × kategori yang sudah ada. Jumlah baris diukur sebelum migrasi dan dicatat; untuk data saat ini (80 peserta, 32 kategori) nilainya kecil, tetapi rilis pada Tema besar harus diperiksa.
- Gate `draft → active` memakai satu query hitung (`COUNT` kategori aktif vs baris `category_activity`). Hasilnya bukan flag tersimpan, sehingga kategori baru otomatis membuat Aktivitas terlihat belum lengkap tanpa job pemeliharaan.
- Tes wajib: tabel lima tingkat × tiga status; `denied` di tingkat tinggi tidak bisa ditimpa; `inherit` berlanjut; override Sesi hanya untuk Sesi itu; tanpa aturan → deny; perubahan kategori mempertahankan override individual; aturan lintas Tema/Sesi salah ditolak; duplikat sel menjadi konflik; audit hanya memuat allowlist; resolver tidak melakukan I/O; `draft → active` ditolak saat matriks belum lengkap dan lolos setelah lengkap.
- Uji mutasi wajib: menghapus satu langkah prioritas, mengubah default deny menjadi allow, menghapus filter `session_id`, menghapus pengecualian individual saat kategori berubah, atau menghapus gate kelengkapan harus membuat tes gagal.

## Keputusan pemilik proyek

Disetujui **8 November 2026**:

1. Opsi A: satu tabel `entitlement_rules`, resolver murni, default deny.
2. Lima sub-keputusan `FR-040`/`FR-041` mengikuti tabel di atas (1b, 2a, 3a, 4a, 5a).
3. Theme default hanya fallback lewat `inherit` eksplisit, bukan salinan otomatis.
4. Backfill Aktivitas lama pada `0009` disetujui sebagai pengecualian migrasi.

Status ADR menjadi **Diterima**; AQ-005 ditutup di `docs/DECISIONS.md` dan `docs/ARCHITECTURE.md`; Q3 dibuka di `docs/IMPLEMENTATION_ROADMAP.md`.

## Referensi

- `REQUIREMENTS.md` §4.7, §5 (`BR-018`–`BR-023`, `BR-075`), §9 (`AC-011`–`AC-014`, `AC-043`), `D-005` [A].
- `docs/ARCHITECTURE.md` §6 AQ-005.
- `docs/adr/0014-categories-and-custom-fields.md` (kategori per Tema dan pola trigger Q2).
- `COSTS_AND_LIMITS.md` §3.3 (anggaran baris tulis) dan batas query D1.
- `docs/IMPLEMENTATION_ROADMAP.md` Q3.
