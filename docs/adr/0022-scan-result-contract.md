# ADR-0022 — Kontrak hasil scan dan kode penolakan

| Atribut | Nilai |
|---|---|
| Status | **Diterima** 9 November 2026 (pemilik proyek menyetujui seluruh butir) |
| Tanggal | 2026-11-09 |
| Menjawab | AQ-008 (`docs/ARCHITECTURE.md` §6) — **dijawab** |
| Terkait kebutuhan | `FR-045`, `FR-070`–`FR-072`, `FR-088`, `FR-119`, `FR-203`; `BR-035`, `BR-072`; `AC-019`, `AC-020`, `AC-040`, `AC-044`, `AC-048`, `AC-053`; `D-011`, `D-012` [A] |
| Tetap berlaku | `D-011` [A] (lima result code stabil, terpisah dari pesan); ADR-0008/ADR-0011 (audit); `NG-01`–`NG-06` (tanpa mode offline) |
| Bergantung pada | ADR-0018, ADR-0019, ADR-0021 |
| Memblokir (sebelum diterima) | Q5 dan Q7 — Q5 dibuka 9 November 2026 setelah ADR ini diterima |
| Dampak | `packages/shared` (result code, reason, skema respons), `routes/scan.ts`, `routes/attendance.ts`, adaptasi minimal web, tes kontrak Q5/Q6 |

## Konteks

`FR-088`/`D-011` [A] menetapkan lima result code stabil: `SUCCESS`, `DUPLICATE`, `NOT_ENTITLED`, `INVALID_QR`, `SYSTEM_ERROR`, terpisah dari pesan yang dilihat pengguna. Baseline memakai enam nilai berbeda (`present`, `duplicate`, `not_found`, `wrong_event`, `event_closed`, `participant_inactive`) dan tidak punya `NOT_ENTITLED` maupun `INVALID_QR`.

Target menambah kondisi yang belum punya kode: peserta nonaktif, entitlement ditolak, Tema/Aktivitas/Sesi tidak menerima transaksi, QR dirotasi, konteks salah, dan Petugas tidak ditugaskan. `REQUIREMENTS.md` tidak menetapkan pemetaan kondisi → kode → HTTP; itulah AQ-008.

Kontrak ini dipakai ulang oleh Q6 (scanner/kiosk) dan Q7 (Consumption), jadi harus stabil, tidak membocorkan identitas lintas Tema, dan tidak pernah menampilkan sukses palsu (`FR-071`, `BR-035`).

## Opsi

### Opsi A — Semua hasil sebagai HTTP 200, termasuk kegagalan sistem

- Kelebihan: scanner hanya memeriksa satu bentuk respons.
- Kekurangan: proxy/retry tidak bisa membedakan kegagalan sistem; risiko UI menampilkan "sukses" untuk respons 200 yang sebenarnya rusak. Ditolak.

### Opsi B — Hasil bisnis 200, kegagalan sistem 5xx, kode alasan terpisah (dipilih)

- Hasil bisnis (termasuk penolakan yang wajar) = HTTP 200 + `result` stabil + `reason` + pesan.
- Kesalahan teknis/otorisasi/validasi = HTTP 4xx/5xx dengan envelope error; scanner memetakan jaringan/5xx ke keadaan `SYSTEM_ERROR`.

### Opsi C — Setiap penolakan memakai HTTP berbeda (409/422/403 untuk semua)

- Kelebihan: semantik HTTP ketat.
- Kekurangan: scanner harus menangani banyak status untuk hal yang secara bisnis sama (peserta tidak berhak); memperbesar risiko salah tampil. Hanya dipakai untuk kesalahan *request*, bukan hasil bisnis.

## Keputusan

**Opsi B**, dengan pemetaan berikut.

### Envelope

```jsonc
// 200 — hasil bisnis
{
  "ok": true,
  "data": {
    "result": "SUCCESS",                 // SUCCESS | DUPLICATE | NOT_ENTITLED | INVALID_QR
    "reason": null,                      // alasan mesin, lihat tabel
    "message": "Kehadiran tercatat",     // pesan siap tampil (Bahasa Indonesia)
    "participant": { "id": "...", "fullName": "...", "externalRef": null, "category": "..." },
    "transaction": {
      "id": "...", "activityId": "...", "sessionId": null,
      "occurredAt": 1730000000123, "status": "present"
    }
  }
}

// 4xx/5xx — bukan hasil bisnis
{ "ok": false, "error": { "code": "SYSTEM_ERROR", "message": "..." } }
```

- `result` stabil dan tidak diterjemahkan; `reason` adalah enum mesin; `message` untuk pengguna.
- `participant` hanya dikembalikan bila data peserta memang boleh diketahui dalam konteks Tema itu (sukses, duplikat, peserta nonaktif di Tema yang sama). QR lintas Tema tidak mengembalikan peserta, Tema asal, atau nama.
- `transaction` hanya untuk `SUCCESS` dan `DUPLICATE`.

### Pemetaan kondisi → HTTP → kode

| Kondisi | HTTP | `result` / `error.code` | `reason` |
|---|---|---|---|
| Attendance baru tercatat | 200 | `SUCCESS` | — |
| Transaksi efektif sudah ada pada ruang lingkup | 200 | `DUPLICATE` | `duplicate` |
| QR malformed, tidak dikenal, sudah dirotasi, atau milik Tema lain | 200 | `INVALID_QR` | `qr_invalid` |
| Peserta nonaktif/arsip | 200 | `NOT_ENTITLED` | `participant_inactive` |
| Entitlement ditolak atau tidak ada aturan (fail-closed) | 200 | `NOT_ENTITLED` | `entitlement_denied` |
| Tema `archived` | 200 | `NOT_ENTITLED` | `theme_archived` |
| Tema `draft`/`closed` atau di luar jendela waktu | 200 | `NOT_ENTITLED` | `theme_not_active` |
| Aktivitas `draft`/`completed` | 200 | `NOT_ENTITLED` | `activity_not_active` |
| Aktivitas `archived` | 200 | `NOT_ENTITLED` | `activity_archived` |
| Sesi `scheduled`/`completed`/`disabled` | 200 | `NOT_ENTITLED` | `session_not_in_progress` |
| Sesi diarsipkan | 200 | `NOT_ENTITLED` | `session_archived` |
| Body tidak valid (skema) | 400 | `VALIDATION` | — |
| Tidak ada sesi/cookie tidak sah | 401 | `UNAUTHENTICATED` | — |
| Tidak ditugaskan / peran tidak berwenang | 403 | `FORBIDDEN` | — |
| Aktivitas/Sesi/peserta/transaksi tidak ada di Tema | 404 | `NOT_FOUND` | — |
| Transaksi sudah di-Reversal/superseded, atau `expectedUpdatedAt` basi | 409 | `CONFLICT` | — |
| Aktivitas punya Sesi tetapi `sessionId` tidak dikirim | 422 | `BUSINESS_RULE` | `session_required` |
| Sesi bukan milik Aktivitas, atau tipe transaksi tidak cocok | 422 | `BUSINESS_RULE` | `context_mismatch` |
| Rate limit | 429 | `RATE_LIMITED` | — |
| Kegagalan tak terduga/konstraint tak terpetakan | 5xx | `SYSTEM_ERROR` | — |

Catatan:

1. **QR lintas Tema = `INVALID_QR`, bukan `wrong_event`.** Audit tetap mencatat `attendance.wrong_theme` (tanpa ID Tema asal) untuk investigasi; respons tidak membocorkan apa pun.
2. **Penolakan lifecycle = `NOT_ENTITLED`.** Semua kondisi "saat ini tidak berhak" memakai kode yang sama tetapi `reason` dan `message` berbeda (mis. "Sesi belum berlangsung", "Aktivitas sudah selesai"). Ini menjaga lima kode stabil tanpa menambah kode bisnis baru.
3. **`SYSTEM_ERROR` tidak pernah 200.** Scanner memetakan 5xx, timeout, dan kegagalan jaringan ke keadaan System Error yang sama.
4. **Duplikat Attendance** memakai pesan "Sudah tercatat hadir" (`FR-203`); Q7 akan menambahkan "Sudah diambil" untuk Consumption dengan kode `DUPLICATE` yang sama.
5. Pesan `NOT_ENTITLED` tidak boleh menyebut identitas peserta lain atau Tema asal QR.

### Pemetaan ke lima keadaan scanner (`FR-119`, Q6)

| `result` | Keadaan scanner |
|---|---|
| `SUCCESS` | Success |
| `DUPLICATE` | Duplicate / Already Attended |
| `NOT_ENTITLED` | Not Entitled |
| `INVALID_QR` | Invalid QR |
| 5xx/jaringan (`SYSTEM_ERROR`) | System Error |

`reason` boleh dipakai untuk pesan tambahan, tetapi **tidak** menambah keadaan kelima. `D-011` [A] dan `D-012` [A] tetap berlaku.

### Kompatibilitas dan perubahan yang disengaja

- Endpoint `POST /api/events/:eventId/scan` berubah kontrak: `activityId` wajib (kecuali shim Aktivitas default untuk Tema lama), `sessionId` wajib bila Aktivitas punya Sesi. Respons memakai `result` baru.
- Nilai lama (`present`, `not_found`, `wrong_event`, `event_closed`, `participant_inactive`) **tidak** dipertahankan sebagai alias. Menjaga dua kosakata akan melanggar `FR-088` dan membingungkan Q6.
- Klien web yang ada diperbarui minimal pada Q5 (pemetaan `SCAN_RESULT_COPY`, pemilihan Aktivitas/Sesi) agar build dan operasi tetap jalan. Scanner/kiosk penuh tetap Q6 (arahan pemilik, 9 November 2026).
- `GET /attendance` dan rekap tetap memakai kontrak lama sampai Q8; jangan mencampurkan bentuk transaksi baru ke endpoint itu tanpa adapter eksplisit.

## Konsekuensi

- Satu kontrak stabil untuk Attendance (Q5) dan Consumption (Q7); kode `DUPLICATE`/`NOT_ENTITLED` dipakai ulang dengan pesan berbeda.
- Penolakan lifecycle tidak lagi menjadi `event_closed`/`participant_inactive`; klien lama wajib diperbarui pada rilis yang sama.
- Scanner tidak perlu memahami status HTTP bisnis; hanya 5xx/jaringan diperlakukan sebagai System Error.
- `reason` menambah satu field yang harus dijaga sebagai enum di `packages/shared`; penambahan nilai baru bukan breaking change, penghapusan/renama adalah breaking change.
- Audit `wrong_theme` tetap ada, tetapi respons tidak menyebut Tema asal.
- Tes pemetaan murni wajib menjadi tabel lengkap kondisi → HTTP/kode/reason, dan tes API membuktikan tidak ada penulisan saat `NOT_ENTITLED`/`INVALID_QR`.

## Butir yang disetujui pemilik

Disetujui seluruhnya 9 November 2026.

- [x] Opsi B: hasil bisnis 200, kegagalan sistem 5xx dengan `SYSTEM_ERROR`.
- [x] Penolakan lifecycle dipetakan ke `NOT_ENTITLED` + `reason`, bukan kode bisnis baru.
- [x] QR lintas Tema menjadi `INVALID_QR` (bukan `wrong_event`), audit tetap mencatat `wrong_theme`.
- [x] `result` lama dihapus tanpa alias; web diperbarui pada rilis yang sama.
- [x] Pesan duplikat Attendance "Sudah tercatat hadir" (`FR-203`).

## Referensi

- `docs/REQUIREMENTS.md` §4.10 (`FR-070`–`FR-072`, `FR-088`), §4.11 (`FR-119`), §4.14 (`FR-045`), §5 (`BR-035`, `BR-072`), §9 (`AC-019`, `AC-020`, `AC-040`, `AC-044`, `AC-048`, `AC-053`), §12 (`D-011`, `D-012`).
- `docs/ARCHITECTURE.md` §5.3, §6 AQ-008; §7.5 (baseline result code).
- `packages/shared/src/attendance.ts` (`SCAN_RESULTS`), `packages/shared/src/schemas/attendance.ts` (`ScanRequestSchema`).
- `apps/api/src/routes/scan.ts`, `apps/web/src/lib/scanner.ts`, `apps/web/src/lib/attendance.ts`.
- `docs/DESAIN_API.md` §7; ADR-0018, ADR-0019, ADR-0021.
