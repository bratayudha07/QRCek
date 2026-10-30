# Absensi Acara

Sistem absensi peserta berbasis QR untuk **banyak acara sekaligus**. Setiap acara punya admin dan petugas lapangan sendiri; hasil absensi disinkronkan ke Google Sheets.

Stack: React + Vite (SPA) · Cloudflare Workers + D1 (API dan database) · Google Sheets API (laporan). Semua di free tier.

> **Status: Fase 0 selesai sebagian.** Fondasi, skema database, dan spike pengukuran sudah ada. Belum ada fitur absensi yang aktif. Lihat `IMPLEMENTATION_PLAN.md` untuk status per fase dan `docs/OPERASIONAL.md` untuk hasil pengukuran serta hal yang belum terverifikasi.

## Menjalankan di lokal

Prasyarat: Node ≥ 22 dan npm.

```bash
npm install
npm run db:reset:local      # hapus state D1 lokal
npm run db:migrate:local    # terapkan migrations/*.sql
npm run build               # wrangler dev menyajikan apps/web/dist
```

Lalu dua terminal:

```bash
npm run dev:api             # http://localhost:8787
npm run dev:web             # http://localhost:5173  (proxy /api -> :8787)
```

Cek: `curl http://localhost:8787/api/health` → `{"ok":true,...}`.
Lewat web: <http://localhost:5173/api/health>.

Untuk secret lokal, salin `.dev.vars.example` menjadi `.dev.vars` (gitignored).

## Verifikasi

```bash
npm run typecheck
npm run lint
npm run test        # vitest, sekali jalan
npm run build
```

## Deploy

Belum pernah dijalankan (belum ada akun Cloudflare yang terhubung). Langkah yang disiapkan:

```bash
cd apps/api
npx wrangler d1 create absensi-db          # lalu isi database_id di wrangler.jsonc
npx wrangler d1 migrations apply absensi-db --remote
npx wrangler secret put QR_PEPPER
npx wrangler secret put SESSION_PEPPER
npm run build && npx wrangler deploy
```

Prosedur lengkap dan hal yang belum terverifikasi: `docs/OPERASIONAL.md`.

## Dokumen

| File | Isi |
|---|---|
| `IMPLEMENTATION_PLAN.md` | Fase, kriteria penerimaan, status |
| `docs/ARSITEKTUR.md` | Alur, boundary, model data, keputusan |
| `docs/DESAIN_API.md` | Tabel endpoint |
| `docs/DESAIN_DATABASE.md` | Skema, indeks, migrasi |
| `docs/RENCANA_PENGUJIAN.md` | Tes wajib dan gerbang kualitas |
| `docs/OPERASIONAL.md` | Hasil spike, quirk lingkungan, item belum terverifikasi |
| `COSTS_AND_LIMITS.md` | Batas free tier |
