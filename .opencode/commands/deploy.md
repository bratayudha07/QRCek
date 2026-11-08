---
description: Panduan deploy QRCek lewat Cloudflare Workers Builds dan verifikasi pasca-deploy
---

Bantu deploy QRCek ke Cloudflare Workers. Jangan menjalankan perintah yang mengubah produksi tanpa konfirmasi eksplisit user.

Permintaan: $ARGUMENTS

## Jalur deploy

Deploy kode produksi memakai **Cloudflare Workers Builds** (Git integration), bukan GitHub
Actions. Push/merge ke `main` memicu build lalu `wrangler deploy` dari runner Cloudflare.

Migrasi D1 **tidak** ikut build/deploy dan tetap manual dari `apps/api`:

```bash
npx wrangler d1 migrations apply absensi-db --remote
```

Detail, kuota, dan rollback: `docs/OPERASIONAL.md` §10.

## Sebelum merge/push ke main

1. Lokal hijau: `npm run typecheck` → `npm run lint` → `npm run test` → `npm run build`.
2. Bila ada migrasi baru: backup remote **dan pastikan export sukses** sebelum apply. Untuk
   perubahan yang mengubah kontrak, pakai expand/contract: migrasi additive → deploy kode →
   migrasi penegakan. Jangan biarkan build mendahului migrasi lebih dari hitungan detik.
   ```bash
   cd apps/api
   npx wrangler whoami
   npx wrangler d1 export absensi-db --remote --output /tmp/opencode/qrcek-backup-$(date -u +%Y-%m-%d-%H%M).sql
   ```
3. Kalau trigger harus aktif segera, matikan auto-deploy sementara di dashboard Cloudflare,
   lalu jalankan migrasi + `npx wrangler deploy` berurutan tanpa jeda, baru aktifkan lagi.
   Jangan ulangi pola rilis `0008` yang membiarkan kode baru live di atas skema lama.
4. Secret Worker diatur lewat `npx wrangler secret put <NAMA>` dari `apps/api` — jangan pernah menampilkan atau mencatat nilainya: `SESSION_PEPPER`, `QR_PEPPER`, `QR_ENCRYPTION_KEY`, `QR_KEY_VERSION`, `GOOGLE_SA_KEY`.
5. Tidak ada `VITE_*` wajib saat ini. Bila menambah satu, pastikan nilainya publik.

## Setelah push/merge

1. Buka Cloudflare Dashboard → Worker `qrcek` → Builds, atau check run GitHub, dan pastikan
   build hijau.
2. Verifikasi produksi:

```bash
curl -s  https://qrcek.hamdirobbi5.workers.dev/api/health
curl -s  https://qrcek.hamdirobbi5.workers.dev/api/health/ready
curl -sI https://qrcek.hamdirobbi5.workers.dev/ | grep -i "content-security-policy"
```

Catat hasil (tanggal, commit, status) di `docs/OPERASIONAL.md`. Jangan menyimpulkan deploy
berhasil dari build lokal.
