# Rencana Q7 — Distribusi konsumsi

Status: **DIBUKA 15 November 2026.** Dokumen ini rencana eksekusi, bukan bukti implementasi.
Enam asumsi di §2 **disetujui pemilik pada 15 November 2026**; implementasi dimulai dari
lapisan API (migrasi `0012`, resolver, route), lalu UI. Migrasi remote hanya setelah
persetujuan terpisah.

Prasyarat keputusan sudah terpenuhi: `D-009` [A] (satu tipe transaksi per Aktivitas),
`D-014` [A] (kuota dapat dikonfigurasi; Reversal mengembalikan kuota), `D-006` [A] (transaksi
efektif), `D-005` [A] (perubahan konfigurasi hanya berlaku ke depan), ADR-0018/0019
(bentuk tabel transaksi + constraint efektif), ADR-0021 (penugasan Petugas), ADR-0022
(kontrak hasil scan). `AC-046` dan `BR-073` sudah dinyatakan final pada `REQUIREMENTS.md`
0.3.5.

## 0. Keputusan yang mengikat rencana ini

| Sumber | Isi yang mengikat Q7 |
|---|---|
| `D-009` [A], `FR-089`, `BR-046` | Satu Aktivitas hanya punya satu tipe transaksi; konsumsi adalah Aktivitas `consumption`. |
| `D-014` [A], `FR-081`–`FR-086`, `BR-041`–`BR-044`, `AC-024` | Kuota default Aktivitas, override kategori, override individual; nilai 0/1/lebih; penukaran ganda dihitung dari transaksi efektif. |
| `D-014` [A], `BR-073`, `AC-046` | Transaksi Consumption yang di-reversal tidak menghabiskan kuota; slot yang dibebaskan dapat dipakai transaksi valid berikutnya. |
| `D-006` [A], `FR-068`, `BR-032` | Duplikasi/kuota dihitung dari transaksi efektif, bukan seluruh riwayat. |
| `D-005` [A], `FR-087`, `BR-045`, `AC-025` | Perubahan entitlement/kuota tidak menghapus riwayat penukaran. |
| `D-011` [A], `FR-088`, `FR-203`, `BR-072` | Result code stabil; pesan duplikat konsumsi "Sudah diambil". |
| `D-013` [A], `AC-026`, `AC-053` | Feedback scanner membedakan hasil untuk Attendance dan Consumption; status tidak hanya warna. |
| `D-023` [A], ADR-0008, ADR-0011 | Audit append-only dalam `db.batch()` yang sama; tanpa token/PII. |
| ADR-0019 | Empat partial unique index efektif; `slot_no` sudah ada dan belum ditegakkan. |
| ADR-0021 | Kewenangan manual mengikuti penugasan + flag + `allow_manual`; Super Admin tanpa manual. |
| `AGENTS.md` | 1 scan = 1 request kecil; D1 50 query/invokasi; tanpa layanan berbayar. |

## 1. Yang sudah ada dan bisa dipakai ulang

- `transactions` sudah menerima `type = 'consumption'`, `slot_no`, dan punya empat partial
  unique index efektif (`uq_tx_consumption_activity`, `uq_tx_consumption_session`) yang
  otomatis membebaskan slot saat Reversal.
- `POST /api/events/:eventId/scan` sudah memvalidasi konteks, lifecycle, entitlement,
  penugasan, dan rate limit — hanya perlu cabang tipe transaksi.
- `GET /api/events/:eventId/transactions` sudah punya filter `type`, `effective`, dan
  cursor; koreksi Reversal/Adjustment sudah generik terhadap `transactions`.
- Pola konfigurasi entitlement (`entitlement_rules` + route bulk + resolver murni) bisa
  ditiru untuk kuota.
- UI: `pages/activity.tsx` (kartu Aktivitas), `pages/staff.tsx` (scanner), dialog Manual
  Entry Q5, `lib/scanner.ts` (copy hasil per `result`/`reason`).

## 2. Asumsi yang perlu disetujui sebelum kode

| # | Asumsi | Alasan / dampak bila salah |
|---|---|---|
| A1 | Kuota berlaku **per Aktivitas per peserta** dan dihitung lintas Sesi; Sesi tidak me-reset kuota. | `FR-084` hanya menyebut Aktivitas/kategori/individual. Bila kuota per Sesi, `slot_no` dan query kuota berubah, dan laporan Q8 ikut berubah. |
| A2 | Perubahan kuota **future-only**: transaksi lama tetap sah; penukaran berikutnya mengikuti kuota baru; penurunan kuota tidak membalik transaksi otomatis. | Disetujui pemilik 15 November 2026; sejalan `D-005` [A]. |
| A3 | Aktivitas `consumption` baru memakai kuota default **1**, dapat diubah 0/1/lebih; Aktivitas `attendance` tidak punya kuota (`NULL`). | `FR-084` membolehkan 0/1/lebih tetapi tidak menetapkan default. |
| A4 | Kuota habis dikembalikan sebagai `DUPLICATE` dengan `reason: "quota_exhausted"` dan pesan "Sudah diambil". | `FR-088` membatasi result code; `FR-203` menyebut pesan "Sudah diambil". Menambah nilai `reason` aman menurut kontrak. Bila owner memilih `NOT_ENTITLED`, copy dan tes berbeda. |
| A5 | Manual Entry Consumption memakai izin baru `consumption:manual` (bukan `attendance:manual`). | ADR-0021 hanya menamai izin Attendance; memakai ulang nama yang salah membuat matriks izin menyesatkan. Ini menambah satu baris matriks izin dan butuh persetujuan owner. |
| A6 | Adjustment Consumption mempertahankan `slot_no` dan tidak menambah pemakaian kuota. | Konsisten `AC-041` (before/after) dan `AC-046`; alternatifnya Adjustment dianggap penukaran baru, yang akan menggandakan kuota. |

## 3. Model data — migrasi `0012_q7_consumption.sql`

Additive; `0001`–`0011` tidak diedit.

1. `ALTER TABLE activities ADD COLUMN quota INTEGER` dengan `CHECK (quota IS NULL OR quota >= 0)`.
   Trigger `trg_activity_quota_type` menegakkan: `attendance` → `quota IS NULL`,
   `consumption` → `quota NOT NULL`.
2. Tabel `consumption_quotas` (mengikuti pola `entitlement_rules`):
   `id, theme_id, activity_id, category_id NULL, participant_id NULL, quota INTEGER NOT NULL,
   created_at, created_by, updated_at, updated_by`, dengan
   `CHECK (quota >= 0)`, `CHECK ((category_id IS NULL) <> (participant_id IS NULL))`.
   Unique: `uq_consumption_quota_category (theme_id, activity_id, category_id)
   WHERE participant_id IS NULL` dan
   `uq_consumption_quota_participant (theme_id, activity_id, participant_id)
   WHERE category_id IS NULL`.
   Trigger konteks: Aktivitas milik Tema itu, bertipe `consumption`, kategori/peserta milik
   Tema itu.
3. Trigger `trg_transaction_consumption_quota` **BEFORE INSERT** pada `transactions`:
   hanya untuk `type = 'consumption'` dan `adjusts_transaction_id IS NULL`; hitung kuota
   efektif `COALESCE(participant override, category override, activities.quota)` dan
   `RAISE(ABORT, 'consumption quota exhausted')` bila
   `COUNT(effective consumption untuk theme+participant+activity) >= kuota`.
   Penegakan di database, bukan di kode, supaya dua request paralel tidak lolos
   (`T-120`).
4. Tidak ada backfill data: produksi belum punya Aktivitas `consumption`.

`slot_no` dihitung aplikasi dari daftar slot efektif (nomor bebas terendah, sehingga slot
yang dibebaskan Reversal dipakai lagi) lalu di-insert; dua request paralel dengan slot sama
ditolak partial unique index dan dipetakan menjadi `DUPLICATE`, bukan 500.

## 4. Domain murni — `apps/api/src/domain/consumption.ts`

- `resolveQuota({ activityQuota, categoryOverride, participantOverride })` → kuota efektif
  (prioritas individual → kategori → Aktivitas), dengan unit test tanpa I/O.
- `quotaRejection({ used, quota })` → `null` atau `"quota_exhausted"`.
- `nextSlotNo({ usedSlots })` → nomor slot bebas terendah (bukan `used + 1`, karena Reversal
  di tengah membuat `used + 1` bertabrakan dengan slot yang masih efektif).
- `consumptionMessage(reason)` untuk copy "Sudah diambil" / "Kuota habis".

## 5. API

| Method | Route | Izin | Catatan |
|---|---|---|---|
| `POST` | `/api/events/:eventId/scan` | `scan` + penugasan | Cabang `consumption`: validasi entitlement/lifecycle yang sama, hitung kuota + slot, insert `type='consumption'`, `status=NULL`, `slot_no`. |
| `GET` | `/api/events/:eventId/activities/:activityId/quota` | `entitlement:read` | Default Aktivitas + override kategori + override peserta + pemakaian efektif per peserta (untuk UI). |
| `PUT` | `/api/events/:eventId/activities/:activityId/quota` | `entitlement:write` | `{ quota }` default Aktivitas; hanya untuk Aktivitas `consumption`. |
| `PUT` | `/api/events/:eventId/activities/:activityId/quota/categories` | `entitlement:write` | Bulk `{ rules: [{ categoryId, quota }] }`, pola sama dengan entitlement. |
| `PUT` | `/api/events/:eventId/activities/:activityId/quota/participants` | `entitlement:write` | Bulk `{ rules: [{ participantId, quota }] }`. |
| `POST` | `/api/events/:eventId/consumption/manual` | `consumption:manual` (A5) | Body `{ participantId, activityId?, sessionId?, note? }`; `allow_manual` + penugasan + flag; kuota tetap ditegakkan. |

Aturan lintas route: Aktivitas `attendance` pada route kuota → `BUSINESS_RULE`; kuota
negatif → `VALIDATION_ERROR`; kuota berubah → audit `activity.quota_updated` (before/after
allowlist, tanpa PII).

## 6. UI

1. `pages/activity.tsx`: kartu **Kuota konsumsi** (default, tabel override kategori, pencarian
   peserta untuk override individual) hanya untuk Aktivitas `consumption`. Pakai `Card`,
   `Table`, `Input`, `Dialog` shadcn/ui yang sudah ada.
2. Scanner `pages/staff.tsx`: label konteks menampilkan "Distribusi konsumsi"; copy hasil
   mengikuti tipe (`Kehadiran tercatat` vs `Konsumsi tercatat`, `Sudah diambil`); tombol
   "Input manual" muncul bila `canManualCheckIn` dan konteks `consumption`.
3. `components/manual-entry-dialog.tsx`: cabang tipe — konsumsi tidak mengirim `status`,
   hanya catatan.
4. Riwayat peserta: kolom tipe + slot ditampilkan dari `GET /transactions?type=consumption`
   (komponen daftar yang sudah ada).

## 7. Tes dan gerbang

Wajib (`docs/RENCANA_PENGUJIAN.md` §9.7):

| ID | Tes |
|---|---|
| T-120 ★ | Penukaran melebihi kuota efektif ditolak di database, termasuk dua request paralel (`db.batch` dua insert). |
| T-121 | Kuota default Aktivitas, override kategori, override individual; kuota 0 menolak; prioritas individual menang. |
| T-122 | Reversal Consumption mengembalikan kuota dan slot dapat dipakai lagi. |
| T-123 ★ | Perubahan entitlement/kuota tidak menghapus riwayat penukaran. |

Tambahan yang harus ada:

- Unit test resolver kuota + `nextSlotNo` (tanpa I/O).
- Scan `consumption` pada Aktivitas `attendance` (dan sebaliknya) → `BUSINESS_RULE`, bukan
  insert lintas tipe.
- Kuota habis → `DUPLICATE`/`quota_exhausted`, HTTP 200, tanpa baris transaksi baru.
- Manual Entry Consumption: Petugas tanpa flag → `FORBIDDEN`; Super Admin → `FORBIDDEN`;
  kuota habis tetap ditolak.
- Audit: `transaction.recorded`, `activity.quota_updated`, `transaction.reversal` tanpa token.
- Otorisasi: Petugas tidak bisa membaca/mengubah kuota (`FORBIDDEN`).

Gerbang angka: `EXPLAIN QUERY PLAN` untuk hitung kuota harus `SEARCH` memakai
`uq_tx_consumption_activity`/`uq_tx_consumption_session`; ukur statement per scan
(target ≤ 17, batas 50) dan CPU p50 di `npm run bench`.

## 8. Bukan cakupan Q7

Inventory/stok, laporan & dashboard konsumsi (Q8), ekspor XLSX (Q8), proyeksi Sheets untuk
Consumption (Q10), konfigurasi pesan per Tema (AQ-012), kuota per Sesi (kecuali A1 diubah).

## 9. Urutan kerja

1. Migrasi `0012` + tes trigger (`transactions.db.test.ts`).
2. `domain/consumption.ts` + tes murni.
3. Route kuota (GET/PUT) + audit + tes otorisasi.
4. Cabang `consumption` di route scan + tes T-120–T-123.
5. Manual Entry Consumption (setelah A5 diputuskan).
6. UI kuota + scanner + dialog manual.
7. `typecheck` → `lint` → `test` → `bench` → `build`, lalu catat angka di
   `docs/OPERASIONAL.md`.
8. Review pemilik sebelum gate Q7 ditutup; migrasi remote hanya setelah persetujuan.
