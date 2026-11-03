---
description: Buat atau terapkan migrasi D1 QRCek dengan aman (lokal saja; remote butuh konfirmasi user)
---

Kelola migrasi database D1 (`absensi-db`) untuk QRCek.

Permintaan: $ARGUMENTS

## Sebelum membuat migrasi

1. Pastikan perubahan skema termasuk tahap roadmap yang **sudah dibuka** (`docs/IMPLEMENTATION_ROADMAP.md`).
2. Bila skema menyangkut model target (Tema/Aktivitas/Sesi, kategori, custom field, entitlement, transaksi, koreksi, QR per Tema), pastikan AQ terkait sudah dijawab ADR yang **Diterima** (`docs/DECISIONS.md` §4). Bila belum, berhenti dan laporkan — jangan memilih desain sendiri.

## Aturan

1. Satu perubahan skema = satu file baru `migrations/NNNN_nama.sql` (berikutnya `0007_*`; cek `ls migrations/`).
2. **Jangan pernah mengedit migrasi yang sudah dijalankan.** `0001`–`0006` sudah di remote.
3. Perubahan merusak memakai pola table rebuild (`PRAGMA defer_foreign_keys = true`); partial unique index wajib mengulang predikatnya di `ON CONFLICT`; ingat SQLite menganggap `NULL` berbeda di unique index.
4. Jangan melepas `UNIQUE (event_id, participant_id)` pada `attendance` sebelum constraint pengganti ada dan tes konkurennya lulus.
5. Hitung biaya baris tulis setiap indeks baru (`COSTS_AND_LIMITS.md` §3.3).
6. Catat skema baru di `docs/DESAIN_DATABASE.md` di perubahan yang sama.

## Perintah

```bash
npm run db:reset:local      # hapus state D1 lokal
npm run db:migrate:local    # terapkan ke lokal
npm run test                # tes integrasi menerapkan migrasi ke D1 uji
```

`npm run db:migrate:remote` **tidak dijalankan** kecuali user mengonfirmasi secara eksplisit di percakapan ini. Sebelum remote: ambil snapshot `wrangler d1 export`, dan ingat deploy Git tidak menjalankan migrasi (migrasi dulu, baru kode yang bergantung padanya). Reset database remote adalah keputusan pemilik proyek (AQ-010), bukan agent.

## Catatan D1

- SQLite; tanpa transaksi interaktif — operasi atomik via `env.DB.batch()`.
- Maksimum 50 query per invokasi Worker dan 100.000 baris tulis/hari (free tier).
- Bila skema lokal terasa "tidak berubah", reset state lokal dulu.
