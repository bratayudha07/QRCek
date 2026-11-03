---
description: Panduan deploy Worker QRCek (Git integration Cloudflare) dan verifikasi pasca-deploy
---

Bantu deploy QRCek ke Cloudflare Workers. Jangan menjalankan perintah yang mengubah produksi tanpa konfirmasi eksplisit user.

Permintaan: $ARGUMENTS

## Jalur deploy

- Utama: push ke `main` di `github.com/bratayudha07/QRCek` → Workers Builds → `wrangler deploy` (root directory `apps/api`, build command `cd ../.. && npm ci && npm run build`).
- Fallback manual: `npm run build` lalu `npx wrangler deploy` dari `apps/api`.
- Detail, kuota build, dan rollback: `docs/OPERASIONAL.md` §10.

## Sebelum deploy

1. Lokal hijau: `npm run typecheck` → `npm run lint` → `npm run test` → `npm run build`.
2. Bila ada migrasi baru: `npm run db:migrate:remote` **lebih dulu**, hanya setelah konfirmasi user dan snapshot `wrangler d1 export`. Deploy Git tidak menjalankan migrasi.
3. Secret Worker diatur lewat `npx wrangler secret put <NAMA>` dari `apps/api` — jangan pernah menampilkan atau mencatat nilainya: `SESSION_PEPPER`, `QR_PEPPER`, `QR_ENCRYPTION_KEY`, `QR_KEY_VERSION`, `GOOGLE_SA_KEY`, `TURNSTILE_SECRET_KEY`.
4. `VITE_TURNSTILE_SITE_KEY` harus ada di build environment Cloudflare bila Turnstile dipakai.

## Verifikasi setelah deploy

```bash
curl -s  https://qrcek.hamdirobbi5.workers.dev/api/health
curl -s  https://qrcek.hamdirobbi5.workers.dev/api/health/ready
curl -sI https://qrcek.hamdirobbi5.workers.dev/ | grep -i "content-security-policy"
```

Catat hasil (tanggal, commit, status) di `docs/OPERASIONAL.md`. Jangan menyimpulkan CI hijau dari hasil lokal.
