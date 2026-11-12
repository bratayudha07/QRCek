# ADR-0018 — Bentuk tabel transaksi Attendance dan Consumption

| Atribut | Nilai |
|---|---|
| Status | **Diterima** 9 November 2026 (pemilik proyek menyetujui seluruh butir) |
| Tanggal | 2026-11-09 |
| Menjawab | AQ-002 (`docs/ARCHITECTURE.md` §6) — **dijawab** |
| Terkait kebutuhan | `FR-066`–`FR-072`, `FR-088`, `FR-162`–`FR-167`; `BR-030`–`BR-035`, `BR-064`–`BR-066`, `BR-072`; `D-003`, `D-006`, `D-009`, `D-011`, `D-022` [A] |
| Tetap berlaku | `AGENTS.md` §Integritas data; `D-007` [A] + ADR-0010 (migrasi additive); ADR-0001 (satu Worker), ADR-0005 (outbox D1) |
| Memblokir (sebelum diterima) | Q5 dan Q6 — Q5 dibuka 9 November 2026 setelah ADR ini diterima |
| Dampak | Migrasi `0011_*` (additive), tabel `transactions` dan `transaction_corrections`, perubahan jalur scan/manual/koreksi/laporan |

## Konteks

Target (`D-003` [A]) mewajibkan setiap transaksi membawa konteks **Tema + Aktivitas** dan, bila Aktivitas punya Sesi, **Sesi** yang valid. `D-011` [A] memisahkan tiga hal yang baseline campur di `attendance.method`:

- **Transaction Type** — Attendance atau Consumption (`D-009` [A]: satu tipe utama per Aktivitas);
- **Transaction Source** — `qr_scan` atau `manual` (`FR-072`);
- **Correction Operation** — Reversal atau Adjustment, yang **bukan** source (`FR-072`, `BR-036`).

Baseline (`migrations/0005_attendance_sync.sql`) hanya punya `attendance` datar: satu baris per `(event_id, participant_id)`, tanpa Aktivitas/Sesi, dengan `method` yang mencampur `qr_scan`/`manual`/`correction`, dan jalur koreksi melakukan `UPDATE` (`apps/api/src/routes/attendance.ts`). Model itu tidak bisa mewakili peserta yang hadir di beberapa Sesi, tidak bisa menyimpan riwayat koreksi non-destruktif, dan tidak menyiapkan kuota Consumption (Q7).

Keputusan ini hanya menentukan **bentuk penyimpanan**. Penegakan duplikasi/kuota ada di ADR-0019; struktur Reversal/Adjustment di ADR-0020.

## Opsi

### Opsi A — Satu tabel `transactions`, koreksi sebagai kolom di baris yang sama

- Kelebihan: satu jalur tulis/baca, laporan lintas tipe sederhana.
- Kekurangan: riwayat Adjustment menumpuk di kolom (`adjusted_*`) atau menimpa baris; sulit memenuhi `FR-079` (before/after tanpa menimpa) dan `FR-072` (koreksi bukan source).

### Opsi B — Tabel terpisah `attendance_transactions` dan `consumption_transactions`

- Kelebihan: masing-masing tipe punya constraint sempit; tidak ada kolom `NULL` lintas tipe.
- Kekurangan: koreksi, audit, daftar riwayat, dan laporan harus menggabungkan dua tabel; risiko duplikasi kode; `slot_no`/kuota tetap perlu tabel pendamping.

### Opsi C — Satu tabel `transactions` + tabel `transaction_corrections` terpisah (dipilih)

- Kelebihan: transaksi tetap satu bentuk; operasi koreksi append-only di tabel sendiri, sehingga `FR-072`/`FR-079` terpenuhi secara konstruksi; satu jalur koreksi dan satu query laporan; Q7 cukup menambah penegakan `slot_no` pada tabel yang sama.
- Kekurangan: beberapa kolom khusus tipe (`status`, `slot_no`) harus dijaga `CHECK`; satu join tambahan saat membaca riwayat koreksi (bukan jalur panas scan).

## Keputusan

**Opsi C.**

### `transactions`

```sql
CREATE TABLE transactions (
  id                    TEXT PRIMARY KEY,
  theme_id              TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  activity_id           TEXT NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
  session_id            TEXT REFERENCES activity_sessions(id) ON DELETE RESTRICT,
  participant_id        TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  type                  TEXT NOT NULL CHECK (type IN ('attendance','consumption')),
  source                TEXT NOT NULL CHECK (source IN ('qr_scan','manual')),
  status                TEXT CHECK (status IN ('present','late','absent','excused')),
  occurred_at           INTEGER NOT NULL,
  device_ts             INTEGER,
  recorded_by           TEXT REFERENCES users(id) ON DELETE RESTRICT,
  note                  TEXT,
  slot_no               INTEGER,
  adjusts_transaction_id TEXT REFERENCES transactions(id) ON DELETE RESTRICT,
  reversed_at           INTEGER,
  reversed_by           TEXT REFERENCES users(id) ON DELETE RESTRICT,
  superseded_at         INTEGER,
  superseded_by         TEXT REFERENCES users(id) ON DELETE RESTRICT,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  CHECK ((type = 'attendance') = (status IS NOT NULL)),
  CHECK ((type = 'consumption') = (slot_no IS NOT NULL)),
  CHECK (occurred_at > 0),
  CHECK (created_at > 0),
  CHECK (updated_at >= created_at),
  CHECK ((reversed_at IS NULL) = (reversed_by IS NULL)),
  CHECK ((superseded_at IS NULL) = (superseded_by IS NULL)),
  CHECK (adjusts_transaction_id IS NULL OR adjusts_transaction_id <> id),
  CHECK (note IS NULL OR length(note) <= 500)
);
```

### `transaction_corrections`

```sql
CREATE TABLE transaction_corrections (
  id             TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  operation      TEXT NOT NULL CHECK (operation IN ('reversal','adjustment')),
  reason         TEXT NOT NULL,
  actor_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  before_json    TEXT,
  after_json     TEXT,
  created_at     INTEGER NOT NULL,
  CHECK (length(reason) BETWEEN 3 AND 500),
  CHECK (created_at > 0),
  CHECK ((operation = 'reversal') = (after_json IS NULL))
);
```

### Aturan yang mengikuti bentuk ini

1. **Konteks wajib.** `theme_id`, `activity_id`, `participant_id` non-null; `session_id` hanya diisi bila Aktivitas punya Sesi (`FR-185`, `FR-188`). Konsistensi ditegakkan trigger di ADR-0019, bukan hanya route.
2. **Type vs Source vs Correction.** `source` hanya `qr_scan`/`manual`; Reversal/Adjustment hidup di `transaction_corrections.operation`. Tidak ada nilai `correction` di `source` (`FR-072`).
3. **Status Attendance.** Kolom `status` dipertahankan dengan nilai baseline (`present`/`late`/`absent`/`excused`) agar perilaku Manual Entry dan koreksi tidak kehilangan makna; default saat scan adalah `present`. Definisi status produk di luar "tercatat hadir" tidak ditambah ADR ini.
4. **Waktu.** `occurred_at` selalu waktu server (UTC ms epoch); `device_ts` hanya catatan selisih jam dan tidak pernah dipakai untuk keputusan (`NFR-013`).
5. **Koreksi tidak menimpa.** `reversed_at`/`superseded_at` menandai status efektif; nilai sebelum/sesudah disimpan di `transaction_corrections` dan audit (ADR-0020).
6. **Q7 disiapkan, bukan diimplementasikan.** `slot_no` non-null untuk Consumption dan dinull untuk Attendance; penegakan kuota dan pemilihan nomor slot adalah Q7. Dengan begitu Q7 tidak perlu `ALTER TABLE` yang merusak.
7. **Tidak ada backfill implisit di ADR ini.** Keputusan pemilik tentang Aktivitas default dan backfill `attendance` dicatat di §"Arahan pemilik proyek" dan dijalankan migrasi Q5.
8. **`attendance` baseline tetap ada.** Tabel lama tidak dihapus dan `UNIQUE (event_id, participant_id)` tidak dilepas sampai pengganti lulus tes konkuren (ADR-0019, `AGENTS.md`).

## Konsekuensi

- Satu jalur tulis baru: scan, manual entry, Reversal, dan Adjustment semuanya menulis ke `transactions`/`transaction_corrections`; tidak ada `UPDATE attendance` baru.
- Laporan/riwayat efektif memakai predikat `reversed_at IS NULL AND superseded_at IS NULL`; query non-efektif tetap bisa dibaca untuk audit.
- `source` dan `operation` terpisah membuat scanner tidak bisa salah menampilkan koreksi sebagai metode scan (`FR-072`, `BR-072`).
- Tabel lebih lebar dari baseline; kolom khusus tipe dijaga `CHECK`, dan indeks parsial (ADR-0019) memisahkan ruang lingkup.
- Audit allowlist perlu entitas `transaction` baru (ADR-0020) dan tidak boleh memuat `note` mentah atau PII.
- Biaya tulis per scan menjadi 1 transaksi + 1 outbox + 1 audit; koreksi menjadi 1–2 baris transaksi + 1 correction + 1 audit. Angka statement wajib diukur, bukan diasumsikan (`AGENTS.md`).
- `slot_no` menambah satu kolom yang belum dipakai sampai Q7; ini disengaja untuk menghindari migrasi merusak.

## Arahan pemilik proyek (9 November 2026, untuk rencana Q5)

1. **Shim Tema lama:** migrasi Q5 membuat **satu Aktivitas default** per Tema yang belum punya Aktivitas, lalu **backfill baris `attendance` lama** ke `transactions` pada Aktivitas default itu. Tujuan: scan dan laporan tidak berhenti karena produksi saat ini memiliki 0 Aktivitas.
2. **Adaptasi web minimal ikut Q5:** halaman scan/koreksi yang ada disesuaikan seperlunya agar tetap berfungsi; scanner/kiosk baru tetap Q6.
3. Arahan ini tidak mengubah status ADR: implementasi menunggu ADR diterima dan Q5 dibuka di roadmap.

## Butir yang disetujui pemilik

Disetujui seluruhnya 9 November 2026.

- [x] Opsi C (satu `transactions` + `transaction_corrections`).
- [x] `status` Attendance dipertahankan dengan empat nilai baseline.
- [x] `slot_no` disiapkan sekarang untuk Q7 (tanpa penegakan kuota di Q5).
- [x] Shim Aktivitas default + backfill `attendance` → `transactions` seperti pada arahan di atas.
- [x] `recorded_by` nullable hanya demi baris hasil backfill; transaksi baru wajib mengisinya di route.

## Referensi

- `docs/REQUIREMENTS.md` §4.10–§4.11 (`FR-066`–`FR-072`, `FR-088`), §5 (`BR-030`–`BR-035`, `BR-064`–`BR-066`, `BR-072`), §12 (`D-003`, `D-006`, `D-009`, `D-011`, `D-022`).
- `docs/ARCHITECTURE.md` §5.2–§5.4, §6 AQ-002.
- `migrations/0005_attendance_sync.sql` (baseline `attendance`), `migrations/0007_q1_activities_sessions.sql` (`activities`, `activity_sessions`).
- `apps/api/src/routes/scan.ts`, `apps/api/src/routes/attendance.ts`, `apps/api/src/db/attendance.ts`.
- ADR-0019 (constraint), ADR-0020 (Reversal/Adjustment), ADR-0021 (penugasan), ADR-0022 (kontrak hasil scan).
