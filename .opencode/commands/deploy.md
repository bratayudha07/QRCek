---
description: Panduan deploy Worker QRCek lewat GitHub Actions dan verifikasi pasca-deploy
---

Bantu deploy QRCek ke Cloudflare Workers. Jangan menjalankan perintah yang mengubah produksi tanpa konfirmasi eksplisit user.

Permintaan: $ARGUMENTS

## Jalur deploy

- Utama: push/merge ke `main` di `github.com/bratayudha07/QRCek` → workflow **Deploy**
  (`.github/workflows/deploy.yml`) menjalankan verifikasi lalu `wrangler deploy`.
- Workflow **Migrate D1** (`.github/workflows/migrate.yml`) terpisah dan manual; hanya bisa
  dijalankan dari `main`, memakai environment `production`.
- Fallback manual: `npm run build` lalu `npx wrangler deploy` dari `apps/api`.
- Detail, kuota, dan rollback: `docs/OPERASIONAL.md` §10.

## Sebelum deploy

1. Lokal hijau: `npm run typecheck` → `npm run lint` → `npm run test` → `npm run build`.
2. Bila ada migrasi baru: jalankan workflow **Migrate D1** lebih dulu, hanya setelah konfirmasi
   user dan backup `wrangler d1 export`. Deploy hanya mengunggah kode.
   Perhatikan urutan: Worker lama tetap melayani request sampai deploy selesai, jadi migrasi
   yang mengubah kontrak tabel harus dideploy berdekatan.
3. Workers Builds di dashboard Cloudflare harus sudah dimatikan agar tidak deploy ganda.
4. Secret Worker diatur lewat `npx wrangler secret put <NAMA>` dari `apps/api` — jangan pernah menampilkan atau mencatat nilainya: `SESSION_PEPPER`, `QR_PEPPER`, `QR_ENCRYPTION_KEY`, `QR_KEY_VERSION`, `GOOGLE_SA_KEY`.
5. Tidak ada `VITE_*` wajib saat ini. Bila menambah satu, atur sebagai repo variable dan pastikan nilainya publik.

## Verifikasi setelah deploy

```bash
curl -s  https://qrcek.hamdirobbi5.workers.dev/api/health
curl -s  https://qrcek.hamdirobbi5.workers.dev/api/health/ready
curl -sI https://qrcek.hamdirobbi5.workers.dev/ | grep -i "content-security-policy"
```

Catat hasil (tanggal, commit, status) di `docs/OPERASIONAL.md`. Jangan menyimpulkan CI hijau dari hasil lokal.
