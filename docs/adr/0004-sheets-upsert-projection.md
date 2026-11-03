# ADR-0004 — Model sinkronisasi Google Sheets: proyeksi/upsert per peserta

| Atribut | Nilai |
|---|---|
| Status | **Diterima untuk baseline. Ditinjau ulang** oleh `D-017` [P] dan AQ-011 (bentuk proyeksi setelah ada Sesi dan Consumption). |
| Asal | `docs/ARSITEKTUR.md` ADR-004 (diekstrak 3 November 2026 tanpa perubahan keputusan) |
| Terkait kebutuhan | `FR-193`, `AC-051` di [`../REQUIREMENTS.md`](../REQUIREMENTS.md) |
| Menutup | Keputusan terbuka lama `AGENTS.md` #2 ("mode sinkronisasi Sheets") untuk model satu-kehadiran-per-acara |

## Konteks

Kehadiran disalin ke Google Sheets secara batch (kuota ~60 tulis/menit untuk service account). Penulisan bisa gagal di tengah dan harus aman di-retry.

## Opsi

1. **Append-only** (satu baris per scan). Operasi `append` tidak idempoten: bila `append` berhasil tetapi update DB gagal, retry membuat baris duplikat yang tidak bisa dibedakan.
2. **Proyeksi/upsert**: setiap peserta menempati satu baris tetap; absensi = satu sel; koreksi menimpa sel yang sama.

## Keputusan

Opsi 2. Pemetaan `participant_id → row_index` disimpan di D1 (`sheet_rows`), bukan dihitung ulang setiap sync. Upsert ke baris deterministik idempoten secara konstruksi.

## Konsekuensi

- Sheet tidak menyimpan riwayat per-scan; riwayat ada di D1 (`audit_log`).
- Edit manual di sheet akan tertimpa — perilaku yang diharapkan dan didokumentasikan.
- Satu tab per acara; baris metadata mendeteksi tab yang salah.

## Catatan terhadap target QRCek

- `D-017` [P] merekomendasikan Sheets **opsional per Tema**, bukan sumber kebenaran, dan kegagalannya tidak boleh memblokir transaksi inti. Rekomendasi ini konsisten dengan ADR ini tetapi belum disetujui.
- Model "satu sel kehadiran per peserta" tidak cukup untuk banyak Aktivitas/Sesi dan Consumption. Bentuk proyeksi baru adalah AQ-011 dan harus diputuskan lewat ADR baru sebelum roadmap Q10.
