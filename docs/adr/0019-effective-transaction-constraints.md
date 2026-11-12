# ADR-0019 — Penegakan transaksi efektif dan konteks di database

| Atribut | Nilai |
|---|---|
| Status | **Diterima** 9 November 2026 (pemilik proyek menyetujui seluruh butir) |
| Tanggal | 2026-11-09 |
| Menjawab | AQ-003 (`docs/ARCHITECTURE.md` §6) — **dijawab** |
| Terkait kebutuhan | `FR-068`, `FR-069`, `FR-075`, `FR-165`, `FR-183`–`FR-188`; `BR-032`, `BR-033`, `BR-040`, `BR-071`; `D-003`, `D-006`, `D-009`, `D-010` [A] |
| Tetap berlaku | `AGENTS.md` §Integritas data ("duplikasi dicegah di database"); ADR-0010 (additive); ADR-0012 (lifecycle); ADR-0015 (Tema terarsip read-only) |
| Bergantung pada | ADR-0018 (bentuk `transactions`) |
| Memblokir (sebelum diterima) | Q5 dan Q6 — Q5 dibuka 9 November 2026 setelah ADR ini diterima |
| Dampak | Migrasi `0011_*`: 4 partial unique index, 2 index baca efektif, 1 trigger konteks, tes konkuren ≥50 iterasi |

## Konteks

Target: **satu transaksi Attendance efektif per peserta per ruang lingkup**, dengan ruang lingkup = Aktivitas tanpa Sesi **atau** Sesi tertentu (`FR-068`, `BR-032`). Transaksi yang di-Reversal tidak boleh menghalangi check-in baru (`BR-040`). Sesi berbeda harus tetap diterima bila berhak (`FR-069`).

Kendala teknis yang mengikat:

1. **SQLite menganggap `NULL` berbeda di unique index.** `session_id NULL` tidak bisa menjadi bagian kunci ruang lingkup "Aktivitas tanpa Sesi" tanpa pemisahan predikat.
2. **Partial unique index wajib mengulang predikatnya di `ON CONFLICT`** bila target konflik disebut eksplisit (temuan Fase 0, `docs/OPERASIONAL.md` §4.1).
3. Dua request paralel harus tetap menghasilkan tepat satu baris; `SELECT` sebelum `INSERT` tidak cukup (`BR-033`).
4. Reversal harus membebaskan slot pada batch yang sama (`BR-040`).
5. Kuota Consumption (Q7) membutuhkan mekanisme berbeda (nomor slot), tetapi tidak boleh memaksa migrasi merusak setelah Q5.

## Opsi

### Opsi A — Kolom `scope_key` non-null

`scope_key = activity_id` atau `activity_id || ':' || session_id`, lalu partial unique index pada `(theme_id, participant_id, scope_key) WHERE reversed_at IS NULL`.

- Kelebihan: satu index untuk Attendance.
- Kekurangan: nilai turunan yang harus dijaga trigger agar tidak menyimpang; duplikasi data; tetap perlu bentuk berbeda untuk kuota.

### Opsi B — Tabel "slot efektif" terpisah

Tabel `effective_slots` menyimpan klaim slot dan dihapus/dilepas oleh Reversal.

- Kelebihan: konsep kuota mudah diperluas.
- Kekurangan: dua baris tulis per transaksi, dua sumber kebenaran, risiko baris slot yatim bila batch gagal; bertentangan dengan anggaran baris tulis D1.

### Opsi C — Partial unique index terpisah per ruang lingkup (dipilih)

Dua index Attendance: satu untuk `session_id IS NULL`, satu untuk `session_id IS NOT NULL`. Predikat `reversed_at IS NULL AND superseded_at IS NULL` membuat Reversal/Adjustment otomatis membebaskan slot.

- Kelebihan: tidak ada kolom turunan; `NULL` tidak lagi ambigu karena tiap index hanya mencakup satu kasus; Reversal cukup `UPDATE` penanda; tetap satu baris tulis per transaksi.
- Kekurangan: jumlah index bertambah (4 untuk dua tipe × dua ruang lingkup); `ON CONFLICT` tidak bisa menyebut satu target index, sehingga dipakai `ON CONFLICT DO NOTHING` tanpa target.

## Keputusan

**Opsi C.**

### Index duplikasi efektif

```sql
-- Attendance pada Aktivitas tanpa Sesi
CREATE UNIQUE INDEX uq_tx_attendance_activity
  ON transactions(theme_id, participant_id, activity_id)
  WHERE type = 'attendance'
    AND session_id IS NULL
    AND reversed_at IS NULL
    AND superseded_at IS NULL;

-- Attendance pada Sesi tertentu
CREATE UNIQUE INDEX uq_tx_attendance_session
  ON transactions(theme_id, participant_id, activity_id, session_id)
  WHERE type = 'attendance'
    AND session_id IS NOT NULL
    AND reversed_at IS NULL
    AND superseded_at IS NULL;

-- Consumption pada Aktivitas tanpa Sesi (penegakan kuota = Q7)
CREATE UNIQUE INDEX uq_tx_consumption_activity
  ON transactions(theme_id, participant_id, activity_id, slot_no)
  WHERE type = 'consumption'
    AND session_id IS NULL
    AND reversed_at IS NULL
    AND superseded_at IS NULL;

-- Consumption pada Sesi tertentu (penegakan kuota = Q7)
CREATE UNIQUE INDEX uq_tx_consumption_session
  ON transactions(theme_id, participant_id, activity_id, session_id, slot_no)
  WHERE type = 'consumption'
    AND session_id IS NOT NULL
    AND reversed_at IS NULL
    AND superseded_at IS NULL;
```

Index baca untuk jalur efektif:

```sql
CREATE INDEX idx_tx_effective_activity
  ON transactions(theme_id, activity_id, session_id, occurred_at DESC)
  WHERE reversed_at IS NULL AND superseded_at IS NULL;

CREATE INDEX idx_tx_effective_participant
  ON transactions(theme_id, participant_id, occurred_at DESC)
  WHERE reversed_at IS NULL AND superseded_at IS NULL;
```

### Cara menulis transaksi baru

```sql
INSERT INTO transactions (...) VALUES (...)
ON CONFLICT DO NOTHING;
```

- **Tanpa conflict target** karena dua partial unique index tidak dapat ditunjuk sekaligus dalam satu `ON CONFLICT`. `DO NOTHING` hanya menelan pelanggaran **uniqueness**; pelanggaran `CHECK`, `FOREIGN KEY`, atau trigger tetap gagal dan menjadi error sistem.
- `meta.changes = 0` berarti transaksi efektif untuk ruang lingkup itu sudah ada (atau kalah balapan) → hasil bisnis `DUPLICATE`, bukan 500 (`AGENTS.md`). Route kemudian membaca baris efektif yang menang untuk payload.
- Tidak ada `SELECT` pendahulu untuk memutuskan duplikasi; keputusan tetap milik database.

### Trigger konteks

Satu trigger `BEFORE INSERT ON transactions` menolak baris yang:

1. Aktivitas tidak berada di `theme_id` yang sama, atau `activities.transaction_type` berbeda dari `transactions.type`;
2. Peserta bukan milik Tema yang sama (`participants.event_id`);
3. `session_id` diisi tetapi Sesi bukan milik `activity_id`;
4. `session_id` kosong padahal Aktivitas memiliki Sesi (`FR-185`);
5. Tema berstatus `archived` (read-only, ADR-0015);
6. **Khusus transaksi baru** (`adjusts_transaction_id IS NULL`): Tema harus `active`, Aktivitas harus `active`, peserta harus `active`, dan Sesi (bila ada) harus `in_progress` serta belum diarsipkan (`FR-183`–`FR-186`, `FR-206`).
7. **Khusus Adjustment** (`adjusts_transaction_id IS NOT NULL`): pemeriksaan lifecycle (5–6) dilonggarkan agar koreksi tetap mungkin setelah Aktivitas/Sesi selesai. Konteks (1–4) tetap wajib. Reversal tidak melakukan `INSERT`, hanya `UPDATE` penanda pada baris asli.

Alasan pelonggaran butir 7: koreksi administratif setelah acara selesai adalah kasus nyata (`FR-076`–`FR-080`); menolaknya karena lifecycle sudah tertutup akan membuat kesalahan data permanen. Tema `archived` tetap menolak semua mutasi.

### Trigger append-only koreksi

```sql
CREATE TRIGGER trg_txc_no_update
BEFORE UPDATE ON transaction_corrections
BEGIN SELECT RAISE(ABORT, 'transaction_corrections is append-only'); END;

CREATE TRIGGER trg_txc_no_delete
BEFORE DELETE ON transaction_corrections
BEGIN SELECT RAISE(ABORT, 'transaction_corrections is append-only'); END;
```

Satu transaksi hanya boleh punya satu Reversal:

```sql
CREATE UNIQUE INDEX uq_txc_reversal
  ON transaction_corrections(transaction_id)
  WHERE operation = 'reversal';

CREATE INDEX idx_txc_transaction
  ON transaction_corrections(transaction_id, created_at);
```

### Reversal dan slot

Reversal hanya menulis `reversed_at`/`reversed_by` pada baris asli. Karena semua index duplikasi memakai predikat `reversed_at IS NULL AND superseded_at IS NULL`, baris itu langsung keluar dari ruang efektif dan check-in baru untuk ruang lingkup yang sama dapat diterima pada batch berikutnya. Tidak ada `DELETE`.

### Kuota Consumption

Q5 **tidak** menegakkan kuota. Q7 akan menetapkan `slot_no` (mis. `1..kuota`) melalui statement `INSERT ... SELECT` yang dibatasi kuota; unique index `uq_tx_consumption_*` sudah menjamin tidak ada dua baris efektif dengan `slot_no` sama. Keputusan bentuk kuota tetap milik Q7/`D-014` [A].

## Konsekuensi

- Duplikasi Attendance ditegakkan oleh database pada dua ruang lingkup yang berbeda tanpa kolom turunan; `session_id NULL` tidak lagi ambigu.
- Reversal membebaskan slot secara konstruktif; tidak ada kode aplikasi yang perlu menghapus index atau baris.
- Empat index unik + dua index baca + satu index koreksi menambah biaya tulis D1. Jumlah baris tulis per scan tetap satu; biaya index harus diukur pada `OPERASIONAL.md`, bukan diasumsikan.
- Trigger menambah beberapa subquery per insert (konteks + lifecycle). CPU wajib diukur di `workerd`; bila melebihi anggaran, sebagian pemeriksaan lifecycle dipindah ke route tanpa melemahkan constraint duplikasi.
- `ON CONFLICT DO NOTHING` tanpa target berarti setiap konflik unik pada tabel itu menjadi `DUPLICATE`. Saat ini hanya index duplikasi yang berlaku untuk insert baru; penambahan unique index lain di masa depan wajib mempertimbangkan ulang pemetaan hasil.
- Tes konkuren wajib: dua scan paralel pada ruang lingkup sama, **≥50 iterasi**, tepat satu sukses dan satu `DUPLICATE`, tanpa flakiness (`RENCANA_PENGUJIAN.md` §9).
- `UNIQUE (event_id, participant_id)` pada `attendance` tetap dipertahankan sampai route baru terbukti dan gate Q5 ditutup.

## Butir yang disetujui pemilik

Disetujui seluruhnya 9 November 2026.

- [x] Opsi C (partial unique index per ruang lingkup, tanpa `scope_key`).
- [x] `ON CONFLICT DO NOTHING` tanpa target sebagai mekanisme `DUPLICATE`.
- [x] Trigger lifecycle dilonggarkan untuk Adjustment setelah Aktivitas/Sesi selesai, tetapi Tema `archived` tetap read-only.
- [x] Kuota Consumption tidak ditegakkan di Q5; hanya skema `slot_no` + index yang disiapkan.

## Referensi

- `docs/REQUIREMENTS.md` §4.10 (`FR-068`, `FR-069`, `FR-075`), §4.12 (`FR-183`–`FR-188`, `FR-206`), §5 (`BR-032`, `BR-033`, `BR-040`, `BR-071`).
- `docs/ARCHITECTURE.md` §5.2, §5.3, §6 AQ-003.
- `docs/OPERASIONAL.md` §4.1 (partial index + `ON CONFLICT`), `docs/RENCANA_PENGUJIAN.md` §9 (tes integritas dan konkuren).
- ADR-0010 (additive), ADR-0012 (lifecycle), ADR-0015 (Tema terarsip), ADR-0018 (bentuk tabel).
- `migrations/0007_q1_activities_sessions.sql`, `migrations/0009_entitlement_rules.sql` (pola partial unique index + trigger konteks).
