# db-migrate

Kelola migrasi database D1 untuk project Absensi Acara.

## Perintah

```bash
# Terapkan migrasi ke D1 lokal
npm run db:migrate:local

# Terapkan migrasi ke D1 remote (WAJIB konfirmasi user terlebih dahulu)
npm run db:migrate:remote

# Hapus state D1 lokal dan migrate ulang dari nol
npm run db:reset:local
```

## Aturan migrasi (AGENTS.md + DESAIN_DATABASE.md)

1. Satu perubahan skema = satu file baru di `migrations/` (nomor berurutan: `0007_*.sql`, dst)
2. **Jangan pernah edit migrasi yang sudah dijalankan**, termasuk di lokal
3. Perbaikan = file migrasi baru, tidak edit file lama
4. Setiap perubahan skema harus dicatat di `docs/DESAIN_DATABASE.md`
5. Uji di lokal (`--local`) sebelum remote (`--remote`)
6. Remote hanya setelah konfirmasi eksplisit pemilik proyek

## Contoh membuat migrasi baru

```bash
# 1. Buat file kosong
touch migrations/0007_nama_perubahan.sql

# 2. Isi SQL, uji di lokal
npm run db:reset:local
npm run db:migrate:local

# 3. Jalankan tes integrasi
npm run test

# 4. Hanya setelah konfirmasi user
npm run db:migrate:remote
```

## Catatan Cloudflare D1

- D1 adalah SQLite, tidak ada transaksi interaktif; gunakan `env.DB.batch()` untuk operasi atomik
- `ALTER TABLE` sangat terbatas; perubahan kolom yang merusak perlu pola table rebuild
- Maksimum 50 query per invokasi Worker (free tier)
- Maksimum 100.000 baris tulis/hari (free tier)
