# ADR-0020 — Struktur Reversal dan Adjustment

| Atribut | Nilai |
|---|---|
| Status | **Diterima** 9 November 2026 (pemilik proyek menyetujui seluruh butir) |
| Tanggal | 2026-11-09 |
| Menjawab | AQ-004 (`docs/ARCHITECTURE.md` §6) — **dijawab** |
| Terkait kebutuhan | `FR-076`–`FR-080`, `FR-201`, `FR-202`, `FR-207`; `BR-036`–`BR-040`, `BR-074`, `BR-079`; `D-006`, `D-011`, `D-024` [A] |
| Tetap berlaku | `AGENTS.md` §Integritas data ("koreksi tidak pernah menimpa"); ADR-0008 (retensi audit), ADR-0011 (allowlist audit), ADR-0015 (Tema terarsip read-only) |
| Bergantung pada | ADR-0018 (tabel), ADR-0019 (transaksi efektif) |
| Memblokir (sebelum diterima) | Q5 — dibuka 9 November 2026 setelah ADR ini diterima |
| Dampak | Route Reversal/Adjustment, tabel `transaction_corrections`, allowlist audit `transaction`, tes koreksi dan batch atomik |

## Konteks

`D-006` [A] menetapkan koreksi non-destruktif: Reversal membatalkan efek tanpa menghapus transaksi asli; Adjustment mencatat perubahan dengan nilai before/after. `FR-077` dan `D-024` [A] membatasi koreksi **hanya Admin Acara Tema itu**; Petugas dan Super Admin tidak berwenang. `FR-078`/`BR-037` mewajibkan alasan. `FR-080`/`FR-207` mewajibkan audit berisi pelaku, waktu, alasan, objek, dan before/after hanya untuk field allowlist.

Baseline melakukan `UPDATE attendance` (`apps/api/src/routes/attendance.ts:210–252`) dan menyimpan snapshot before/after di audit. Pola itu menimpa nilai historis dan mencampur `method = 'correction'` dengan Transaction Source — keduanya delta yang harus diganti (`FR-072`, `D-011` [A]).

Pertanyaan yang harus dijawab ADR ini:

1. Apakah Reversal menulis baris baru atau menandai baris asli?
2. Bagaimana Adjustment menyimpan perubahan tanpa menimpa riwayat?
3. Field mana yang boleh di-Adjust?
4. Bagaimana Adjustment berinteraksi dengan constraint duplikasi?
5. Apakah Reversal boleh dibalik?

## Opsi

### Opsi A — Koreksi sebagai baris transaksi baru (termasuk Reversal)

- Reversal menulis baris "pembalik" bertipe khusus; efektivitas dihitung dari rantai `reversal_of`.
- Kelebihan: satu pola untuk semua koreksi.
- Kekurangan: penentuan "efektif" menjadi rekursif; unique index duplikasi sulit mengecualikan rantai; laporan lambat.

### Opsi B — Menandai baris asli + tabel operasi koreksi (dipilih)

- Reversal: `UPDATE` penanda `reversed_at`/`reversed_by` + baris `transaction_corrections`.
- Adjustment: baris transaksi baru + baris lama ditandai `superseded_at`/`superseded_by` + baris koreksi.
- Kelebihan: predikat efektif sederhana (`reversed_at IS NULL AND superseded_at IS NULL`), kompatibel dengan ADR-0019, riwayat koreksi append-only.
- Kekurangan: Adjustment menambah satu baris transaksi; rantai Adjustment perlu dibaca lewat `adjusts_transaction_id`.

### Opsi C — Menimpa baris dengan snapshot before/after di audit + koreksi

- Kelebihan: satu baris per ruang lingkup, statement paling sedikit.
- Kekurangan: melanggar `AGENTS.md` ("koreksi tidak pernah menimpa"); riwayat hanya hidup di audit yang retensinya terbatas; `FR-079` menyebut "tidak boleh menimpa riwayat secara diam-diam". Ditolak.

## Keputusan

**Opsi B**, dengan detail berikut.

### Reversal

Batch tunggal (urutan wajib):

1. `UPDATE transactions SET reversed_at = ?, reversed_by = ?, updated_at = ? WHERE id = ? AND theme_id = ? AND reversed_at IS NULL AND superseded_at IS NULL`.
2. `INSERT INTO transaction_corrections (operation = 'reversal', reason, actor_user_id, before_json, after_json = NULL, ...)`.
3. `INSERT INTO audit_log (action = 'transaction.reversal', ...)` dengan alasan dan snapshot allowlist.
4. `outbox` enqueue untuk memperbarui proyeksi Sheets (bila sync aktif).

- `meta.changes = 0` pada langkah 1 → `409 CONFLICT` ("Transaksi sudah dibatalkan atau berubah"). Batch tidak menulis audit.
- Baris asli tetap ada dan dapat dibaca; `before_json` menyimpan status efektif terakhir untuk field allowlist.
- Reversal **tidak** membuat transaksi baru dan **tidak** mengubah `occurred_at`.

### Adjustment

Batch tunggal (urutan wajib):

1. Baca baris efektif target (ter-scope `theme_id`). Tidak ada → `404`.
2. `UPDATE transactions SET superseded_at = ?, superseded_by = ?, updated_at = ? WHERE id = ? AND theme_id = ? AND reversed_at IS NULL AND superseded_at IS NULL`.
   - Harus **sebelum** insert agar index duplikasi ADR-0019 tidak menolak baris pengganti.
   - `meta.changes = 0` → `409`.
3. `INSERT` baris transaksi baru: identitas (`theme_id`, `activity_id`, `session_id`, `participant_id`, `type`, `source`, `recorded_by`, `slot_no`) **disalin** dari baris lama; field allowlist memakai nilai baru; `adjusts_transaction_id = id baris lama`; `occurred_at` baru; `created_at`/`updated_at` = waktu koreksi.
4. `INSERT INTO transaction_corrections (operation = 'adjustment', reason, actor_user_id, before_json, after_json, ...)` — hanya field yang berubah.
5. `INSERT INTO audit_log (action = 'transaction.adjustment', ...)`.
6. `outbox` enqueue.

- Jika insert gagal (validasi/trigger), seluruh `db.batch()` gagal dan baris lama **tidak** tetap tersuperseded — D1 menjalankan batch sebagai satu transaksi.
- Adjustment atas transaksi yang sudah di-Reversal → `409`. Adjustment atas transaksi yang sudah disuperseded → `409`; koreksi berikutnya menyasar baris efektif terbaru.
- Adjustment berantai diperbolehkan (versi → versi → versi); setiap versi tetap satu baris.
- Reversal atas baris hasil Adjustment diperbolehkan; yang dibatalkan adalah versi efektif itu.
- Reversal atas Reversal **tidak** diperbolehkan (`409`); koreksi berikutnya adalah transaksi baru atau Adjustment.

### Field yang boleh di-Adjust

| Field | Boleh | Catatan |
|---|---|---|
| `occurred_at` | Ya | Waktu kejadian yang dikoreksi; bukan `device_ts`. |
| `note` | Ya | Nilai lama tetap ada di baris tersuperseded; nilai tidak masuk audit. |
| `status` | Ya | Hanya untuk `type = 'attendance'`; nilai `present`/`late`/`absent`/`excused`. |
| `theme_id`, `activity_id`, `session_id` | Tidak | Memindahkan transaksi ke konteks lain bukan koreksi; gunakan Reversal + transaksi baru. |
| `participant_id`, `type`, `source` | Tidak | Identitas dan provenance tidak boleh berubah. |
| `recorded_by`, `slot_no` | Tidak | Pelaku asli dan nomor slot bukan objek koreksi. |
| `reversed_at`, `superseded_at` | Tidak | Dikelola operasi koreksi, bukan input klien. |

Alasan (`reason`) wajib, 3–500 karakter setelah trim (pola Q4). Baseline memakai minimum 10; angka itu diganti oleh ADR ini.

### Otorisasi

- Aksi baru `transaction:correct`. Hanya `event_admin` pada Tema itu.
- **Super Admin ditolak eksplisit di route**, meskipun `isAllowed` global meloloskannya (`FR-077`, `D-024` [A]). Petugas selalu `403`, termasuk atas transaksinya sendiri (`FR-106`).
- Admin Acara Tema lain → `404` (query ter-scope `theme_id`), bukan `403`, agar tidak membocorkan keberadaan transaksi.
- Tema `archived` → `409`/`422` sesuai ADR-0022; Tema read-only tidak menerima koreksi.

### Audit dan allowlist

- Action: `transaction.reversal`, `transaction.adjustment` (nama final mengikuti `DESAIN_API.md`).
- Entitas allowlist baru `transaction`: `themeId`, `activityId`, `sessionId`, `participantId`, `type`, `source`, `status`, `occurredAt`, `noteChanged`, `adjustsTransactionId`, `reversedAt`, `supersededAt`.
- **Nilai `note` tidak pernah masuk audit** (bisa memuat PII). Perubahan catatan dicatat sebagai `noteChanged: true`.
- Snapshot hanya berisi field yang berubah; nama peserta, token QR, hash, dan ciphertext tidak pernah masuk.
- `transaction_corrections` append-only ditegakkan trigger (ADR-0019); route tidak pernah `UPDATE`/`DELETE` baris koreksi.

### Interaksi dengan duplikasi

- Reversal mengeluarkan baris dari ruang efektif → check-in baru untuk ruang lingkup yang sama diterima.
- Adjustment memindahkan efektivitas ke baris baru; baris lama tidak lagi menghalangi check-in.
- Tidak ada dua baris efektif untuk peserta + ruang lingkup yang sama (ADR-0019).

## Konsekuensi

- Riwayat koreksi dapat dibaca tanpa bergantung pada retensi audit; audit tetap menjadi jejak otorisasi.
- Reversal = 1 update + 1 correction + 1 audit (+1 outbox); Adjustment = 1 update + 1 insert + 1 correction + 1 audit (+1 outbox). Keduanya jauh di bawah 50 statement D1.
- Laporan/riwayat harus memakai predikat efektif; UI yang menampilkan semua baris harus membedakan versi efektif dan tersuperseded.
- Adjustment menambah baris transaksi sehingga tabel tumbuh lebih cepat daripada "satu baris per kejadian"; ini harga dari larangan menimpa riwayat.
- Parameter `expectedUpdatedAt` opsional dapat dipakai untuk optimistic concurrency; tanpa itu, guarded update tetap mencegah koreksi ganda.
- Endpoint `POST /api/events/:eventId/attendance/:attendanceId/correction` yang lama diganti; tidak dipertahankan sebagai fallback (`UPDATE attendance` tidak boleh menjadi jalur kedua).

## Butir yang disetujui pemilik

Disetujui seluruhnya 9 November 2026.

- [x] Reversal = penanda pada baris asli + baris `transaction_corrections` (bukan transaksi pembalik).
- [x] Adjustment = baris transaksi baru + supersede baris lama.
- [x] Field Adjustment: `occurred_at`, `note`, `status`; identitas/source/recorded_by/slot_no tidak boleh.
- [x] Reversal atas Reversal ditolak `409`; Adjustment berantai diperbolehkan.
- [x] Nilai `note` tidak disimpan di audit/correction JSON, hanya `noteChanged`.

## Referensi

- `docs/REQUIREMENTS.md` §4.10 (`FR-076`–`FR-080`), §5 (`BR-036`–`BR-040`), §9 (`AC-022`, `AC-023`, `AC-041`, `AC-045`, `AC-049`), §12 (`D-006`, `D-011`, `D-024`).
- `docs/ARCHITECTURE.md` §5.2–§5.3, §6 AQ-004.
- `docs/adr/0008-audit-log-retention.md`, `docs/adr/0011-audit-allowlist-mechanism.md`.
- `packages/shared/src/audit-allowlist.ts`, `apps/api/src/routes/attendance.ts`, `apps/api/src/db/audit.ts`.
- ADR-0018, ADR-0019, ADR-0022.
