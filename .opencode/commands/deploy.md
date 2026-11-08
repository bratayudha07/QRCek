---
description: Panduan deploy manual Worker QRCek dengan Wrangler dan verifikasi pasca-deploy
---

Bantu deploy QRCek ke Cloudflare Workers. Jangan menjalankan perintah yang mengubah produksi tanpa konfirmasi eksplisit user.

Permintaan: $ARGUMENTS

## Jalur deploy

Repo ini **tidak** memakai GitHub Actions atau Cloudflare Workers Builds. Deploy dilakukan
manual dari mesin lokal dengan Wrangler:

```bash
npm run build
cd apps/api
npx wrangler deploy
```

Migrasi D1 juga manual:

```bash
cd apps/api
npx wrangler d1 migrations apply absensi-db --remote
```

Detail dan rollback: `docs/OPERASIONAL.md` §10.

## Sebelum deploy

1. Lokal hijau: `npm run typecheck` → `npm run lint` → `npm run test` → `npm run build`.
2. Login Wrangler sekali (`cd apps/api && npx wrangler login`), atau set
   `CLOUDFLARE_API_TOKEN` di environment lokal. Jangan menyimpan token di repo.
3. Bila ada migrasi baru: backup remote dulu, lalu terapkan migrasi **sebelum** deploy kode.
   Urutan ini penting karena Worker lama tetap melayani request sampai deploy selesai.
   ```bash
   cd apps/api
   npx wrangler d1 export absensi-db --remote --output /tmp/opencode/qrcek-backup-$(date -u +%Y-%m-%d).sql
   npx wrangler d1 migrations apply absensi-db --remote
   ```
4. Matikan Workers Builds di dashboard Cloudflare agar push ke `main` tidak memicu deploy lain.
5. Secret Worker diatur lewat `npx wrangler secret put <NAMA>` dari `apps/api` — jangan pernah menampilkan atau mencatat nilainya: `SESSION_PEPPER`, `QR_PEPPER`, `QR_ENCRYPTION_KEY`, `QR_KEY_VERSION`, `GOOGLE_SA_KEY`.
6. Tidak ada `VITE_*` wajib saat ini. Bila menambah satu, pastikan nilainya publik.

## Verifikasi setelah deploy

```bash
curl -s  https://qrcek.hamdirobbi5.workers.dev/api/health
curl -s  https://qrcek.hamdirobbi5.workers.dev/api/health/ready
curl -sI https://qrcek.hamdirobbi5.workers.dev/ | grep -i "content-security-policy"
```

Catat hasil (tanggal, commit, status) di `docs/OPERASIONAL.md`. Jangan menyimpulkan deploy
berhasil dari hasil build lokal.
