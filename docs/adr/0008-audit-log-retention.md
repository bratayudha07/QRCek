# ADR-0008 — Retensi audit log: append-only permanen, arsip manual sebelum pemangkasan

| Atribut | Nilai |
|---|---|
| Status | **Diterima** — diterapkan di Fase 6 (pemantauan via `/api/admin/usage`; prosedur di `docs/OPERASIONAL.md` §9.3) |
| Asal | `docs/ARSITEKTUR.md` ADR-008 (diekstrak 3 November 2026 tanpa perubahan keputusan) |
| Terkait kebutuhan | `FR-137`, `BR-058`, `NFR-012`, `NFR-023` di [`../REQUIREMENTS.md`](../REQUIREMENTS.md) |
| Menutup | Keputusan terbuka lama `AGENTS.md` #3 ("batas D1 untuk audit jangka panjang") |
| Dampak keputusan produk QRCek | `D-023` [A] memperluas cakupan aksi audit dan menyisakan "kebijakan retensi" sebagai hal yang masih perlu diputuskan product owner. ADR ini tetap berlaku sampai ada keputusan itu. |

> Nomor "ADR-008" juga pernah dipakai `PLAN_TAB_PESERTA.md` untuk desain tab Peserta. Penomoran itu tidak pernah diadopsi; ADR-0008 adalah keputusan retensi audit ini.

## Konteks

`audit_log` tumbuh satu baris per mutasi dan tidak pernah dipangkas. D1 free tier membatasi baris dibaca/hari dan ukuran database (500 MB). `AGENTS.md` menetapkan audit log **append-only**; trigger database (`audit_log_no_delete`, `audit_log_no_update`) menegakkannya.

## Opsi

1. **Cron memangkas baris lama otomatis.** Ditolak: melanggar append-only; riwayat bisa hilang karena salah konfigurasi.
2. **Membuang trigger agar aplikasi bebas memangkas.** Ditolak: aturan keamanan menjadi konvensi kode, bukan properti database.
3. **Append-only permanen + arsip manual terverifikasi.** Dipilih.

## Keputusan

- Tidak ada penghapusan otomatis. Trigger tetap ada.
- `GET /api/admin/usage` melaporkan `counts.auditEntries`, `auditLog.oldestAt`, dan `auditLog.newestAt`.
- Pemangkasan, bila diperlukan, adalah **prosedur operator** (`docs/OPERASIONAL.md` §9.3): ekspor rentang ke file arsip, verifikasi, lalu migrasi pemeliharaan baru yang melepas trigger, menghapus rentang terarsip, dan memasang trigger kembali.
- Ambang yang disarankan: baris tertua > 12 bulan **atau** jumlah baris mendekati batas nyaman D1. Angka final adalah keputusan operator, bukan konstanta kode.

## Konsekuensi

- Riwayat tidak bisa hilang tanpa jejak; setiap pemangkasan punya file arsip dan catatan rilis.
- Biaya baris dibaca untuk audit tumbuh sampai operator bertindak; `/api/admin/usage` membaca tabel, jadi panggil jarang.
- Query audit memakai indeks `(event_id, created_at)`.
- Perluasan cakupan audit (`FR-135`, `D-023` [A]) mempercepat pertumbuhan; anggaran ulang di `COSTS_AND_LIMITS.md` wajib dilakukan saat model transaksi baru dirancang.
