# Rencana Q5 — Transaksi Attendance, Manual Entry, Reversal/Adjustment

Status: **DRAFT — tahap belum dibuka.** Dokumen ini rencana eksekusi, bukan bukti implementasi. Tidak ada kode, migrasi, atau keputusan skema yang dibuat sampai AQ-002, AQ-003, AQ-004, AQ-007, dan AQ-008 dijawab lewat ADR yang disetujui pemilik proyek dan Q5 dibuka di [`docs/IMPLEMENTATION_ROADMAP.md`](../../docs/IMPLEMENTATION_ROADMAP.md).

Bagian yang menyebut bentuk tabel/endpoint adalah **ilustrasi untuk menilai opsi**, bukan keputusan. Jangan menyalinnya ke `migrations/` sebelum ADR terkait diterima.

## 0. Keputusan yang mengikat rencana ini

| Sumber | Isi yang mengikat Q5 |
|---|---|
| `D-003` [A], `FR-066`, `BR-030` | Transaksi wajib punya konteks Tema + Aktivitas; Sesi wajib bila Aktivitas punya Sesi. |
| `D-006` [A], `FR-068`, `FR-201`, `FR-202`, `BR-032`, `BR-040` | Duplikasi dihitung dari transaksi **efektif**; koreksi tidak menimpa riwayat; Reversal membebaskan slot. |
| `D-009` [A], `FR-182`, `FR-089`, `BR-046`, `BR-070` | Satu Aktivitas hanya punya satu tipe transaksi utama: Attendance atau Consumption. |
| `D-010` [A], `FR-183`–`FR-188`, `BR-071` | Lifecycle ditolak backend; Sesi tidak disimpulkan dari jam; Sesi harus milik Aktivitas itu. |
| `D-011` [A], `FR-072`, `FR-088`, `FR-203`, `BR-072` | Type, Source, dan Correction Operation terpisah; result code stabil dan terpisah dari pesan pengguna. |
| `D-005` [A], `FR-199`, `BR-075` | Perubahan entitlement hanya berlaku ke depan; transaksi lama tidak dibalik otomatis. |
| `D-006` [A], `D-024` [A], `FR-077`, `FR-106`, `BR-036` | Reversal/Adjustment **hanya** Admin Acara; Petugas dan Super Admin tidak. Tidak ada emergency override. |
| `D-022` [A], `FR-073`, `FR-074`, `BR-034`, `AC-055` | Manual Check-in oleh Petugas berizin atau Admin Acara; pelaku dan source dicatat; izin legacy `attendance:correct` **tidak** boleh dipakai ulang. |
| `D-023` [A], `FR-080`, `FR-207`, ADR-0008, ADR-0011 | Audit append-only dalam `db.batch()` yang sama; snapshot hanya allowlist, tanpa PII/kredensial. |
| `D-007` [A], ADR-0010 | Migrasi additive; `0001`–`0010` tidak diedit; perubahan merusak memakai pola expand/contract. |
| ADR-0001, ADR-0005 | Satu Worker same-origin; outbox D1 + cron untuk Sheets, tanpa layanan berbayar. |
| `NG-01`–`NG-06` | Tidak ada mode offline, PDF, atau desain kartu di Q5. |

## 1. Prasyarat — belum terpenuhi

Q5 **tidak boleh dibuka** sampai kelima pertanyaan arsitektur berikut dijawab ADR yang diterima. Masing-masing memblokir Q5 menurut [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §6 dan [`docs/DECISIONS.md`](../../docs/DECISIONS.md) §4.

| AQ | Pertanyaan | Memblokir | Status |
|---|---|---|---|
| AQ-002 | Satu tabel transaksi dengan kolom tipe, atau tabel terpisah per tipe? | Q5, Q6 | **Terbuka** |
| AQ-003 | Constraint DB untuk transaksi efektif per ruang lingkup (Aktivitas tanpa Sesi vs Sesi). | Q5, Q6 | **Terbuka** |
| AQ-004 | Struktur Reversal/Adjustment dan field yang boleh di-Adjust. | Q5 | **Terbuka** |
| AQ-007 | Penugasan Petugas dan matriks izin Manual Check-in. | Q5, Q7 | **Terbuka** |
| AQ-008 | Pemetaan penolakan ke result code dan HTTP. | Q5, Q7 | **Terbuka** |

Prasyarat lain:

- Q3 dan Q4 sudah live di remote (`schema_version = 10`); resolver entitlement dan lookup QR siap dipakai.
- Input produk yang belum selesai dan **wajib** diselesaikan sebelum implementasi:
  1. Daftar field transaksi yang boleh di-Adjust (AQ-004). Tanpa ini, allowlist audit dan validasi Adjustment tidak bisa ditutup.
  2. Rekonsiliasi izin Manual Check-in untuk Super Admin (`FR-073`, `BR-034`, `AC-055`). Status saat ini menyatakan belum ditetapkan; jangan menginferensikan `attendance:correct`.
  3. Konfirmasi apakah Q5 hanya Attendance atau sekalian menyiapkan bentuk tabel untuk Consumption (Q7). Jika AQ-002 memilih satu tabel, bentuknya harus sudah mendukung kuota Q7 tanpa migrasi merusak.

## 2. Tujuan

1. Mengganti model `attendance` datar dengan **transaksi berkonteks** Tema + Aktivitas (+ Sesi bila ada).
2. Menegakkan duplikasi **transaksi efektif** di database, bukan di UI.
3. Menyediakan koreksi non-destruktif: **Reversal** dan **Adjustment**, dengan alasan, otorisasi Admin Acara, dan audit.
4. Menyediakan Manual Entry yang mencatat pelaku dan source, dengan izin yang direkonsiliasi.
5. Menjaga jalur scan tetap satu request kecil: validasi konteks, entitlement, lifecycle, duplikasi, transaksi, outbox, dan audit dalam satu `db.batch()`.
6. Menyiapkan model yang bisa dipakai Q6 (scanner) dan Q7 (kuota konsumsi) tanpa membongkar skema.

## 3. Bukan cakupan

- Scanner/kiosk, kamera, `BarcodeDetector`/ZXing, dan feedback UI (Q6).
- Kuota Consumption, penukaran konsumsi, dan pemulihan kuota (Q7). Q5 hanya memastikan bentuk transaksi tidak menutup jalan ke sana.
- Dashboard, laporan, ekspor, dan navigasi (Q8).
- UI koreksi dan UI manual entry (tahap UI; backend Q5 API-only).
- Perubahan proyeksi Google Sheets di luar penyesuaian yang diperlukan agar transaksi/koreksi tetap tersinkron (detail di Q10).
- Penghapusan `attendance` lama. Tabel baseline dipertahankan sampai penggantinya terbukti dan tes konkurennya lulus.

## 4. Baseline aktual (bukti, bukan target)

| Area | Kondisi sekarang |
|---|---|
| Tabel | `attendance` satu baris per `(event_id, participant_id)` dengan `UNIQUE (event_id, participant_id)` (`0005_attendance_sync.sql`). Tidak ada `activity_id`/`session_id`. |
| Status | `present`, `late`, `absent`, `excused`; belum ada definisi target status Attendance di luar "tercatat hadir". |
| Source | Kolom `method` (`qr_scan`, `manual`, `correction`) mencampur source dan koreksi — delta terhadap `FR-072`. |
| Koreksi | `POST /api/events/:eventId/attendance/:attendanceId/correction` melakukan `UPDATE attendance`; ini delta yang harus diganti (`D-006`). |
| Scan | `apps/api/src/routes/scan.ts` menulis `attendance`, outbox, dan audit dalam satu batch; belum memeriksa Aktivitas/Sesi, entitlement, atau lifecycle. |
| Outbox | `outbox` per peserta dengan partial unique index; batch scan sudah memakai pola yang bisa dipertahankan. |
| Otorisasi | `attendance:correct` = `event_admin`; `scan` = `officer`. Superadmin lolos semua cek di `isAllowed`, sehingga aturan `D-024` harus ditegakkan eksplisit di route, bukan hanya lewat matriks izin. |
| Audit | `audit_log` append-only dengan trigger; allowlist di `packages/shared/src/audit-allowlist.ts` belum punya entitas transaksi target. |

## 5. Pertanyaan arsitektur — opsi, belum dipilih

### 5.1 AQ-002 — satu tabel vs per tipe

**Opsi A — satu tabel `transactions` dengan `type` (`attendance`/`consumption`).**

- Kelebihan: laporan gabungan, audit, dan daftar riwayat lintas tipe lebih sederhana; satu jalur koreksi.
- Kekurangan: constraint duplikasi (Attendance) dan kuota (Consumption) berbeda; kolom khusus tipe jadi `NULL`; risiko tabel lebar.
- Pertanyaan turunan: apakah kuota Q7 memakai kolom `scope_key`/`slot_no`, atau tabel pendamping.

**Opsi B — tabel terpisah `attendance_transactions` dan `consumption_transactions`.**

- Kelebihan: constraint tiap tipe lebih sempit; tidak ada kolom `NULL` yang membingungkan.
- Kekurangan: koreksi, audit, dan laporan harus menggabungkan dua tabel; risiko duplikasi kode; AQ-004 harus dijawab dua kali atau dibuat generik.

**Opsi C — satu tabel transaksi + tabel operasi koreksi terpisah.**

- Kelebihan: transaksi tetap satu bentuk; Reversal/Adjustment punya tabel sendiri sehingga riwayat koreksi tidak mengotori baris transaksi.
- Kekurangan: satu join tambahan saat membaca status efektif; constraint duplikasi harus memperhitungkan operasi koreksi.

Keputusan harus mempertimbangkan: jumlah query per scan, biaya baris tulis D1, kemudahan constraint efektif, dan kebutuhan laporan Q8. **Belum ada pilihan di dokumen ini.**

### 5.2 AQ-003 — constraint transaksi efektif

Kendala teknis yang wajib dijawab di ADR:

- SQLite menganggap `NULL` berbeda di unique index, sehingga `session_id NULL` tidak bisa langsung menjadi kunci ruang lingkup "Aktivitas tanpa Sesi".
- Partial unique index wajib mengulang predikatnya di `ON CONFLICT` (temuan Fase 0).
- Constraint harus tetap menolak duplikasi saat dua request paralel, bukan hanya saat berurutan.
- Reversal harus membebaskan slot di batch yang sama.

**Opsi awal:**

- **(a) Kolom kunci ruang lingkup non-null** (mis. `scope_key = activity_id` atau `activity_id:session_id`) + partial unique index `WHERE reversed_at IS NULL`.
- **(b) Tabel "slot efektif" terpisah** yang dihapus/dilepas oleh Reversal dalam batch yang sama.
- **(c) Nomor slot `1..kuota`** unik per ruang lingkup efektif, sekaligus menyiapkan kuota Q7.

Setiap opsi harus diuji dengan dua scan paralel (target ≥ 50 iterasi tanpa flakiness) dan dengan Reversal yang membebaskan slot. **Belum dipilih.**

### 5.3 AQ-004 — bentuk Reversal/Adjustment

Pertanyaan yang harus dijawab:

1. Apakah Reversal menulis baris baru (`reversal_of = transaction_id`) atau menandai transaksi asli (`reversed_at`, `reversed_by`)?
2. Apakah Adjustment menulis baris baru berisi before/after, atau menambah baris operasi koreksi terpisah?
3. Field transaksi mana yang boleh di-Adjust? Kandidat awal: `note`, `recorded_at`/`occurred_at`, dan status kehadiran bila produk menetapkannya. Field identitas (peserta, Tema, Aktivitas, Sesi, type) tidak boleh di-Adjust.
4. Bagaimana Adjustment berinteraksi dengan constraint duplikasi — apakah tetap satu transaksi efektif, atau boleh menghasilkan beberapa versi?
5. Apakah Reversal boleh dibalik (undo reversal)? Rekomendasi awal: tidak; koreksi berikutnya adalah transaksi baru.

Tanpa jawaban nomor 3, `FR-207` tidak bisa ditutup karena allowlist audit belum punya daftar field yang sah.

### 5.4 AQ-007 — penugasan Petugas dan Manual Check-in

- Bentuk tabel penugasan (per Aktivitas, per Sesi, atau keduanya).
- Apakah Petugas yang ditugaskan pada Aktivitas otomatis boleh semua Sesi di bawahnya, atau harus ditugaskan per Sesi.
- Siapa yang boleh mengaktifkan Manual Check-in: Admin Acara per Aktivitas, per Sesi, atau global Tema.
- Status Super Admin untuk Manual Check-in (`FR-073`, `AC-055`). Jangan memakai `attendance:correct` sebagai pengganti.

Q5 hanya membutuhkan bagian yang menegakkan otorisasi Manual Entry; UI penugasan ada di Q6.

### 5.5 AQ-008 — pemetaan penolakan ke result code/HTTP

- `FR-088` menetapkan `SUCCESS`, `DUPLICATE`, `NOT_ENTITLED`, `INVALID_QR`, `SYSTEM_ERROR`; target juga memiliki `event_closed`, `participant_inactive`, dan penolakan lifecycle.
- Owner harus memutuskan mana yang **result code bisnis** (HTTP 200 dengan `result`) dan mana yang **HTTP error** (400/403/404/422).
- Kontrak harus stabil dan dipakai ulang oleh Q6/Q7.

## 6. Rancangan kandidat (ilustrasi, menunggu ADR)

> Jangan menyalin bagian ini ke migrasi sebelum AQ-002/AQ-003/AQ-004 diterima. Ini hanya alat untuk menilai biaya dan risiko.

Contoh bentuk **jika** Opsi A/C dipilih:

```text
transactions
  id, theme_id, activity_id, session_id NULL,
  participant_id, type ('attendance'|'consumption'),
  source ('qr_scan'|'manual'),
  scope_key NOT NULL,           -- aktivitas atau aktivitas:sesi
  effective_slot INTEGER,       -- untuk kuota/duplikasi
  occurred_at, recorded_by,
  reversed_at NULL, reversed_by NULL,
  created_at, updated_at

transaction_corrections              -- jika Opsi C / Adjustment terpisah
  id, transaction_id, operation ('reversal'|'adjustment'),
  reason, actor_user_id, before_json, after_json, created_at
```

Hal yang harus tetap benar apa pun opsinya:

- `theme_id` dan `activity_id` non-null; `session_id` hanya diisi bila Aktivitas punya Sesi.
- `scope_key` tidak boleh mengandalkan `NULL` untuk membedakan ruang lingkup.
- Reversal tidak menghapus baris asli.
- Adjustment menyimpan before/after hanya untuk field allowlist.
- Semua waktu UTC ms epoch.

## 7. Kandidat permukaan API

Nama final menunggu AQ-008 dan `docs/DESAIN_API.md`. Kandidat:

| Metode | Path | Izin | Catatan |
|---|---|---|---|
| `POST` | `/api/events/:eventId/scan` | `scan` | Body diperluas dengan `activityId`, `sessionId` (wajib sesuai lifecycle). |
| `POST` | `/api/events/:eventId/attendance/manual` | `scan` + penugasan (AQ-007) | Mencatat `source = manual` dan pelaku. |
| `GET` | `/api/events/:eventId/transactions` | `recap:read` | Filter Aktivitas/Sesi/type/status efektif. |
| `POST` | `/api/events/:eventId/transactions/:id/reversal` | `attendance:correct` (khusus event_admin) | Reason wajib; audit dalam batch. |
| `POST` | `/api/events/:eventId/transactions/:id/adjustment` | `attendance:correct` (khusus event_admin) | Body field allowlist + reason. |

Route baseline `POST .../attendance/:id/correction` dihapus/diganti setelah route baru lulus gate. Jangan mempertahankan `UPDATE attendance` sebagai fallback.

## 8. Aturan domain dan integritas

### 8.1 Validasi konteks (setiap transaksi)

- Peserta milik Tema yang sama dengan Aktivitas/Sesi.
- Aktivitas milik Tema; Sesi milik Aktivitas tersebut.
- Aktivitas tanpa Sesi: `session_id` harus `NULL`.
- Aktivitas dengan Sesi: `session_id` wajib dan valid; **tidak** boleh disimpulkan dari jam (`FR-187`).
- Tema terarsip / Aktivitas non-aktif / Sesi tidak `berlangsung` → tolak tanpa menulis (`FR-183`–`FR-188`, ADR-0015).
- Penolakan tidak boleh menulis transaksi, outbox, atau audit sukses.

### 8.2 Entitlement

- Panggil resolver Q3 (`packages/shared/src/entitlements.ts`) dengan konteks Aktivitas/Sesi.
- `denied`/tidak ada aturan → `NOT_ENTITLED`, tanpa menulis.
- Perubahan aturan hanya berlaku ke depan (`D-005`); jangan menulis ulang transaksi lama.

### 8.3 Duplikasi

- Ditegakkan constraint database (AQ-003), bukan `SELECT` sebelum `INSERT`.
- Pelanggaran constraint dipetakan menjadi hasil `DUPLICATE` (pesan "Sudah tercatat hadir"), bukan 500.
- Sesi berbeda boleh diterima bila berhak; ruang lingkup Aktivitas tanpa Sesi dan Sesi berbeda.

### 8.4 Koreksi

- Hanya Admin Acara Tema itu; Super Admin **ditolak eksplisit** di route meskipun `isAllowed` meloloskannya (`D-024`).
- Petugas selalu `403`, termasuk atas transaksinya sendiri (`FR-106`).
- Reason wajib, 3–500 karakter setelah trim (pola Q4).
- Reversal membebaskan slot; transaksi asli tetap ada dan dapat dibaca.
- Adjustment menyimpan before/after hanya untuk field allowlist; tidak menimpa nilai historis.
- Koreksi dan audit ditulis dalam `db.batch()` yang sama; mutasi gagal tidak menulis audit.

### 8.5 Audit

- Action baru (nama final menunggu ADR): `transaction.recorded`, `transaction.reversal`, `transaction.adjustment`, `transaction.manual`.
- Entitas baru di `audit-allowlist.ts`; field sensitif/PII tidak pernah masuk.
- Snapshot hanya ID, type, source, status, dan field allowlist.
- Audit append-only; tidak ada UPDATE/DELETE dari route.

### 8.6 Outbox dan Sheets

- Transaksi + outbox + audit dalam satu batch, seperti baseline.
- Koreksi harus meng-enqueue pembaruan proyeksi tanpa menduplikasi baris sheet.
- Jangan memanggil Google API dari jalur scan; tetap lewat outbox/cron (ADR-0005).

## 9. Migrasi dan kompatibilitas baseline

1. ADR AQ-002/AQ-003/AQ-004 diterima dan dicatat di `docs/DECISIONS.md`.
2. Migrasi baru `0011_*` additive. **Jangan mengedit `0001`–`0010`.**
3. **Pertahankan** `UNIQUE (event_id, participant_id)` pada `attendance` sampai constraint pengganti ada dan tes konkuren lulus (`AGENTS.md`).
4. Strategi expand/contract:
   - fase 1: tabel/kolom baru + dual-write atau backfill;
   - fase 2: route baru membaca sumber baru;
   - fase 3: hapus constraint lama hanya setelah tes dan verifikasi produksi.
5. Backfill `attendance` lama bila model baru memakai tabel berbeda:
   - petakan `event_id` → Tema, pilih Aktivitas default **hanya bila keputusan produk mengizinkan**; jangan mengarang Aktivitas/Sesi.
   - Jika tidak ada Aktivitas yang bisa dipetakan, jangan backfill diam-diam; catat sebagai data yang tidak dapat dimigrasikan dan minta keputusan pemilik.
6. Urutan rilis: **migrasi dulu, deploy kemudian**, dengan auto-deploy Workers Builds dimatikan sementara atau backup + verifikasi sebelum push (`docs/OPERASIONAL.md` §6.3).
7. Backup remote dan hitung kandidat sebelum apply; catat jumlahnya.
8. Rollback: jangan menghapus tabel/kolom baru; rollback kode tidak membatalkan migrasi.

## 10. Tes wajib

Mengacu [`docs/RENCANA_PENGUJIAN.md`](../../docs/RENCANA_PENGUJIAN.md) §9. Tambahan untuk Q5:

### 10.1 Murni (tanpa I/O)

- Validator konteks Aktivitas/Sesi: tanpa Sesi, dengan Sesi, Sesi salah Aktivitas, Sesi lintas Tema.
- Pemetaan lifecycle → keputusan tolak.
- Resolver entitlement dipakai apa adanya; `denied`/tidak ada aturan → `NOT_ENTITLED`.
- Pemetaan pelanggaran constraint → `DUPLICATE`.
- Aturan field Adjustment/allowlist audit.
- Pemetaan result code → HTTP (setelah AQ-008).

### 10.2 Database

- Duplikasi efektif per ruang lingkup ditolak constraint.
- Dua scan paralel: tepat satu sukses, diulang **≥ 50 kali** tanpa flakiness.
- Sesi berbeda diterima.
- Reversal membebaskan slot; check-in baru valid berhasil.
- Adjustment menyimpan before/after dan tidak mengubah baris asli.
- Constraint lintas Tema/Aktivitas/Sesi ditolak trigger/constraint.
- Audit + transaksi + outbox atomik; kegagalan statement mana pun tidak menyisakan baris parsial.

### 10.3 API/otorisasi

- Petugas → reversal/adjustment `403`; Super Admin → `403`; Admin Acara Tema lain → `404`.
- Manual Entry tanpa penugasan/izin → `403`.
- Scan tanpa `activityId`/`sessionId` yang valid → ditolak sesuai AQ-008.
- Peserta nonaktif, QR tidak dikenal, Tema lain → tidak menulis apa pun.
- Respons sukses hanya setelah batch selesai.

### 10.4 Ukuran

- Hitung jumlah statement per scan dan per koreksi dari kode (bukan komentar).
- Target tetap di bawah **50 statement/invokasi** D1.
- Catat query plan untuk lookup konteks dan constraint efektif.

## 11. Ukuran dan anggaran

| Metrik | Target | Cara |
|---|---|---|
| Statement per scan | ≤ 50, diusahakan mendekati baseline | Tes penghitung `prepare()` seperti `qr-labels.statements.test.ts` |
| Statement per koreksi | ≤ 50 | Sama |
| Baris tulis per scan | 1 transaksi + 1 outbox + 1 audit | Dihitung dari batch |
| Query plan | `SEARCH ... USING INDEX`, tanpa `SCAN` pada jalur panas | `EXPLAIN QUERY PLAN` |
| Tes konkuren | ≥ 50 iterasi | Vitest, waktu di-inject |

Angka aktual wajib dicatat di `docs/OPERASIONAL.md` setelah implementasi, bukan diasumsikan.

## 12. Urutan kerja (hanya setelah Q5 dibuka)

1. Terima ADR AQ-002/AQ-003/AQ-004/AQ-007/AQ-008; perbarui `docs/DECISIONS.md`, `ARCHITECTURE.md`, dan roadmap.
2. Selesaikan input produk: field Adjustment dan izin Manual Check-in Super Admin (`AC-055`).
3. Tulis migrasi `0011_*` + catatan `docs/DESAIN_DATABASE.md`.
4. Tulis fungsi murni di `apps/api/src/domain/` + tes tanpa I/O.
5. Tulis akses DB di `apps/api/src/db/` (SQL hanya di sini).
6. Tulis route tipis di `apps/api/src/routes/`: parse → validasi → domain → respons.
7. Ganti route koreksi baseline; hapus `UPDATE attendance` setelah gate.
8. Perbarui `packages/shared` (skema, tipe, result code, allowlist audit).
9. Perbarui `docs/DESAIN_API.md` dan `docs/RENCANA_PENGUJIAN.md`.
10. Jalankan `typecheck` → `lint` → `test` → `build`; ukur statement.
11. Review keamanan independen sebelum rilis.
12. Rilis dengan urutan migrasi-dulu; verifikasi dan smoke dengan sesi nyata.

## 13. Perintah verifikasi

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

Tes terfokus saat iterasi:

```bash
npm run test -- apps/api/src/test/scan.test.ts
npm run test -- -t "menolak scan ganda"
```

## 14. Gate akhir Q5

- `AC-002`, `AC-003`, `AC-013`, `AC-019`–`AC-023`, `AC-035`, `AC-040`, `AC-041`, `AC-044`, `AC-045`, `AC-049`, `AC-055`.
- Semua tes §10 lulus, termasuk konkuren ≥ 50 iterasi.
- `UNIQUE (event_id, participant_id)` lama baru dilepas **setelah** constraint pengganti ada dan tesnya lulus.
- Route koreksi lama tidak lagi melakukan `UPDATE attendance`.
- Statement per scan dan per koreksi tercatat dan di bawah 50.
- Audit tidak memuat PII/token; allowlist diperbarui dan diuji.
- Tidak ada regresi pada Q3 (entitlement) dan Q4 (QR identity/scan).
- Dokumentasi aktual diperbarui; tidak ada klaim selesai tanpa bukti.

## 15. Rollout dan rollback

- Backup D1 remote sebelum migrasi; hitung kandidat backfill.
- Migrasi dulu, deploy kemudian. Matikan auto-deploy Workers Builds sebelum push bila perlu.
- Verifikasi `app_meta.schema_version`, tabel/index/trigger, dan jumlah baris backfill.
- Smoke dengan sesi produksi: scan, duplikat, manual entry, reversal, scan ulang setelah reversal.
- Rollback kode tidak membatalkan migrasi. Jangan menghapus tabel baru; pertahankan kompatibilitas baca.

## 16. Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Constraint efektif salah bentuk | Duplikasi lolos atau scan valid ditolak | ADR AQ-003 + tes konkuren ≥ 50 |
| Backfill `attendance` tanpa Aktivitas | Data historis tidak bisa dipetakan | Jangan mengarang Aktivitas; minta keputusan pemilik |
| Super Admin lolos `isAllowed` | Koreksi oleh Super Admin tidak sengaja diizinkan | Tolak eksplisit di route + tes |
| `attendance:correct` dipakai ulang untuk Manual Entry | Pelanggaran `AC-055` | Izin baru terpisah + tes |
| Statement melebihi 50 | Scan gagal di produksi | Hitung dari kode, ukur, dan pecah batch bila perlu |
| Dua jalur tulis (lama + baru) | Data ganda/tidak konsisten | Expand/contract bertahap; satu sumber baca setelah fase 2 |
| Sesi disimpulkan dari jam | Transaksi masuk konteks salah | Validasi `session_id` eksplisit + tes |

## 17. Pertanyaan yang harus dijawab pemilik sebelum implementasi

1. Field transaksi apa saja yang boleh di-Adjust, dan field apa yang mutlak tidak boleh?
2. Apakah Super Admin boleh melakukan Manual Check-in? Jika tidak, tegaskan penolakan.
3. Apakah Reversal atas Reversal diizinkan? Rekomendasi: tidak.
4. Apakah Q5 harus menyiapkan kolom kuota untuk Consumption sekarang, atau Q7 boleh menambah migrasi sendiri?
5. Apakah data `attendance` lama perlu dipetakan ke Aktivitas tertentu, atau boleh dibiarkan sebagai arsip terpisah?

## 18. Berkas yang diperkirakan berubah (setelah ADR)

| Berkas | Perubahan |
|---|---|
| `migrations/0011_*.sql` | Tabel transaksi/koreksi, constraint efektif, index, trigger konteks, backfill. |
| `packages/shared/src/` | Skema request/response, result code, entitas allowlist audit, tipe payload. |
| `apps/api/src/domain/` | Validator konteks/lifecycle, pemetaan result code, aturan koreksi (fungsi murni). |
| `apps/api/src/db/` | Akses transaksi, koreksi, outbox; statement constraint. |
| `apps/api/src/routes/scan.ts` | Konteks Aktivitas/Sesi + entitlement + lifecycle. |
| `apps/api/src/routes/attendance.ts` | Ganti koreksi `UPDATE` dengan Reversal/Adjustment; manual entry. |
| `apps/api/src/domain/permissions.ts` | Izin Manual Check-in/penugasan setelah AQ-007. |
| `apps/api/src/db/audit.ts` | Statement audit transaksi/koreksi. |
| `docs/` | `DESAIN_API.md`, `DESAIN_DATABASE.md`, `RENCANA_PENGUJIAN.md`, `OPERASIONAL.md`, `ARCHITECTURE.md`, `DECISIONS.md`, roadmap. |

---

## 19. Catatan status

Dokumen ini **belum** membuka Q5 dan **belum** memilih jawaban AQ-002–AQ-004/AQ-007/AQ-008. Setelah ADR diterima, perbarui status di bagian atas, isi keputusan di §0, dan baru mulai implementasi sesuai §12. Jangan menyalin §6 ke migrasi sebelum itu.
