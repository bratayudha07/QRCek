# deploy

Deploy project Absensi Acara ke Cloudflare Workers.

## Perintah

```bash
# Build semua workspace (web + api)
npm run build

# Deploy Worker (manual)
cd apps/api
npx wrangler deploy

# Atau lewat Git integration (push ke main → Workers Builds otomatis)
```

## Sebelum deploy

1. Migrasi D1 harus dijalankan **terlebih dahulu** (manual, butuh konfirmasi user):
   ```bash
   npm run db:migrate:remote
   ```
2. Secret Worker harus di-set via `wrangler secret put` (tidak ada di `.dev.vars` di production):
   - `SESSION_PEPPER`
   - `QR_PEPPER`
   - `QR_ENCRYPTION_KEY`
   - `QR_KEY_VERSION`
   - `GOOGLE_SA_KEY`
   - `TURNSTILE_SECRET_KEY`
3. `VITE_TURNSTILE_SITE_KEY` harus ada di build environment Cloudflare bila Turnstile dipakai.

## Verifikasi setelah deploy

```bash
curl -s https://qrcek.hamdirobbi5.workers.dev/api/health
curl -s https://qrcek.hamdirobbi5.workers.dev/api/health/ready
curl -sI https://qrcek.hamdirobbi5.workers.dev/ | grep -i "content-security-policy"
```

## Catatan

- Migrasi D1 **tidak dijalankan otomatis** oleh deploy Git.
- Secret **tidak ikut ter-deploy** lewat Git integration.
- Build command di Cloudflare dashboard: `cd ../.. && npm ci && npm run build`
- Root directory: `apps/api`
