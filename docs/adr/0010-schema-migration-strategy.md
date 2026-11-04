# ADR-0010 — Strategi skema menuju Tema → Aktivitas → Sesi

| Atribut | Nilai |
|---|---|
| Status | **Diterima** — jawaban AQ-010, disetujui pemilik proyek 4 November 2026 |
| Terkait AQ | AQ-010 (`docs/ARCHITECTURE.md` §6) |
| Terkait kebutuhan | `D-007` [A] (tanpa kewajiban migrasi data produksi); integritas constraint lama tetap |
| Dampak keputusan produk QRCek | Menentukan nomor migrasi, tabel baru, dan urutan deprecate tabel lama |

## Konteks

Migrasi `0001`–`0006` sudah diterapkan di remote dan **tidak boleh diedit**. `D-007` [A] menghapus kewajiban migrasi data produksi, tetapi constraint duplikasi lama (`UNIQUE (event_id, participant_id)`) tidak boleh dilepas sebelum penggantinya ada dan teruji. `db:migrate:remote` butuh konfirmasi eksplisit.

## Opsi

1. **Additive bertahap** (direkomendasikan). Tambah tabel/entitas baru lewat migrasi `0007` dan seterusnya (`themes` alias atas `events`, `activities`, `sessions` dengan kolom awal sesuai ADR-0009). Tabel lama tetap; deprecate dan hapus hanya setelah penggantinya teruji (juga gate each Q). Audit log/attribution diisi sejak mutasi pertama Q1.
2. **Set migrasi baru + reset remote.** Reset database remote (konfirmasi eksplisit) lalu terapkan skema baru dari awal. Bersih, tetapi butuh konfirmasi dan wipe data produksi.

## Rekomendasi (status usulan)

Opsi 1. Alasan: (a) migrasi lama tidak disentuh (aturan D1), (b) constraint duplikasi lama tetap aktif selama migrasi (keamanan), (c) rollback selisih satu migrasi. Opsi 2 boleh dipakai jika product owner menerima wipe data produksi (gated `db:migrate:remote`).

## Konsekuensi (bila adopsi Opsi 1 — additive)

- Nomor migrasi naik: `0007_*` dst. Setiap PR tambah file di `migrations/` + catatan di `docs/DESAIN_DATABASE.md`.
- Pola D1: rollback manual via `db:reset:local` + migrate ulang (state lokal). Untuk remote: migrasi baru hanya `--apply`, tidak pernah ubah `0001`–`0006`.
- `events` tetap (compatibility) sampai Q8 deprecation; Aktivitas/Sesi dibuat oleh Q1.
- Audit append-only tetap (ADR-0008); tabel audit tetap satu set.

## Catatan implementasi

ADR ini diterima. Migrasi Q1 adalah `0007_q1_activities_sessions.sql`; `0001`–`0006` tidak diedit.