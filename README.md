# Absensi Acara

Sistem absensi peserta berbasis QR untuk **banyak acara sekaligus**. Setiap acara punya admin dan petugas lapangan sendiri; hasil absensi akan disinkronkan ke Google Sheets.

Stack: React + Vite (SPA) · Cloudflare Workers + D1 (API dan database) · Google Sheets API (laporan, fase lanjut). Semua di free tier.

> **Status: fondasi selesai.** Yang ada sekarang: SPA, Worker, binding D1, pipeline migrasi, pengujian, CI. Yang **belum** ada: login, acara, peserta, QR, absensi, dan sinkronisasi Sheets — semuanya dikerjakan per fase sesuai `IMPLEMENTATION_PLAN.md`.
>
> Skema database saat ini **sengaja minimal**: hanya satu tabel `app_meta`. Tabel bisnis (`events`, `participants`, `attendance`, `audit_log`, `outbox`, …) baru dibuat pada fase yang membutuhkannya.

## Prasyarat

| Kebutuhan | Versi yang diuji |
|---|---|
| Node | 26.8.1 (minimal 22) |
| npm | 11.19.0 (workspace npm, bukan pnpm/yarn) |

## Instalasi

```bash
npm install
```

> **npm ≥ 11.19**: instalasi memblokir `postinstall` `esbuild` dan `workerd`. Tanpa persetujuan, biner tidak terunduh dan tes gagal dengan error yang membingungkan. Persetujuan disimpan di `package.json` → `allowScripts`. Kalau `npm install-scripts ls` melaporkan paket baru, jalankan `npm install-scripts approve <pkg>` lalu commit `package.json`.

## Menjalankan di lokal

Siapkan database dan aset (sekali di awal, ulangi setelah mengubah skema atau kode web):

```bash
npm run db:reset:local      # hapus state D1 lokal
npm run db:migrate:local    # terapkan migrations/*.sql
npm run build               # wrangler dev menyajikan apps/web/dist
```

Jalankan dua proses di dua terminal:

```bash
npm run dev:api             # Worker  -> http://localhost:8787
npm run dev:web             # Vite    -> http://localhost:5173
```

Buka **<http://localhost:5173>**. Halaman awal menampilkan status API; `fetch("/api/health")` diproksikan Vite ke Worker, jadi browser tetap satu origin seperti produksi.

Cek manual:

```bash
curl http://localhost:8787/api/health   # Worker langsung
curl http://localhost:5173/api/health   # lewat proxy Vite
```

Keduanya mengembalikan:

```json
{"ok":true,"data":{"service":"absensi-api","version":"v1","status":"ok","timestamp":1793414986488}}
```

## Konfigurasi environment

Dua lapis, dipisah tegas: **secret Worker tidak pernah masuk bundle frontend**.

| Lapis | File | Isi | Git |
|---|---|---|---|
| Worker (secret) | `apps/api/.dev.vars` | `QR_PEPPER`, `SESSION_PEPPER`, `GOOGLE_SA_KEY` | **tidak** di-commit |
| Worker (contoh) | `.dev.vars.example` | daftar kunci dengan nilai kosong | di-commit |
| Web (publik) | `apps/web/.env.local` | `VITE_API_BASE_URL` | **tidak** di-commit |
| Web (contoh) | `apps/web/.env.example` | dokumentasi variabel | di-commit |

`VITE_API_BASE_URL` **kosong secara default** dan itu memang yang diinginkan: SPA dan Worker berbagi origin (ADR-001), jadi tidak ada URL production yang di-hardcode. Isi hanya kalau frontend benar-benar disajikan dari origin lain (mis. preview ke Worker staging).

Untuk secret Worker: `cp .dev.vars.example apps/api/.dev.vars` lalu isi. Di production pakai `wrangler secret put`, bukan file.

## Struktur direktori

```
apps/web/                  SPA — React + Vite + Tailwind + shadcn/ui
  src/app.tsx              composition root (routing menyusul)
  src/pages/               halaman (home.tsx)
  src/components/ui/       komponen shadcn/ui copy-in (button.tsx)
  src/lib/                 helper murni: api.ts (base URL), health.ts (parsing)
  vite.config.ts           dev server + proxy /api -> :8787
  .env.example             VITE_API_BASE_URL

apps/api/                  Cloudflare Worker — satu-satunya pemegang secret
  src/index.ts             entry: route /api/*, fallback SPA
  src/env.ts               tipe binding (DB, ASSETS)
  src/test/                tes integrasi + spike D1 (berjalan di workerd)
  wrangler.jsonc           config produksi (D1 + Static Assets)
  wrangler.test.jsonc      config tes (tanpa assets)
  scripts/reset-local-db.mjs

packages/shared/           tipe + kontrak API dipakai web & api
migrations/                migrasi SQL D1 (urutan = nama file)
docs/                      arsitektur, API, database, pengujian, operasional
```

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev:web` | Vite dev server, port 5173 |
| `npm run dev:api` | `wrangler dev`, port 8787 |
| `npm run typecheck` | `tsc --noEmit` di semua workspace |
| `npm run lint` | ESLint, 0 warning |
| `npm run test` | Vitest sekali jalan |
| `npm run bench` | Spike pengukuran hot path (verbose) |
| `npm run build` | Build SPA + dry-run bundle Worker |
| `npm run db:migrate:local` | Terapkan migrasi ke D1 lokal |
| `npm run db:migrate:remote` | Terapkan ke D1 remote — **minta konfirmasi dulu** |
| `npm run db:reset:local` | Hapus `.wrangler/state` |

Tes terfokus:

```bash
npm run test -- apps/api/src/test/health.test.ts
npm run test -- -t "rejects an empty key"
```

## Pengujian

| Lapis | Jumlah | Lokasi |
|---|---|---|
| Kontrak API bersama | 2 | `packages/shared/src/types.test.ts` |
| Worker: health + 404 envelope | 3 | `apps/api/src/test/health.test.ts` |
| Integrasi D1 (skema nyata di `workerd`) | 6 | `apps/api/src/test/db.integration.test.ts` |
| Spike D1 (atomisitas, `RETURNING`, index parsial, query plan, biaya) | 24 | `apps/api/src/test/spike.*.test.ts` |
| Frontend (parsing respons, base URL) | 9 | `apps/web/src/lib/*.test.ts` |

**Total: 44 tes di 10 file.**

Tes API berjalan di `workerd` dengan binding D1 asli (`@cloudflare/vitest-plugin`), memakai file migrasi yang sama dengan wrangler. Tes frontend berjalan di Node tanpa DOM karena yang diuji logika murni.

## Migrasi database

```bash
# 1. buat file baru — JANGAN mengedit migrasi yang sudah pernah dijalankan
touch migrations/0002_<nama>.sql

# 2. terapkan ke lokal
npm run db:migrate:local
```

Aturan: satu perubahan skema = satu file baru + catatan di `docs/DESAIN_DATABASE.md`. Migrasi yang sudah dijalankan tidak boleh diedit, termasuk di lokal — pakai `npm run db:reset:local` kalau ingin mengulang dari nol.

## Build

```bash
npm run build
```

Menghasilkan `apps/web/dist/` (SPA) dan dry-run bundle Worker di `apps/api/dist/`. `wrangler dev` membaca `apps/web/dist`, jadi build dulu sebelum `dev:api` menyajikan halaman.

## Troubleshooting

| Gejala | Sebab | Solusi |
|---|---|---|
| `curl http://127.0.0.1:5173` gagal, tapi `localhost` bisa | Vite mengikat ke `localhost` (IPv6) | Pakai `localhost`, atau `npx vite --host 127.0.0.1` |
| `dev:api` error soal direktori assets | `apps/web/dist` belum ada | `npm run build` dulu |
| Skema "tidak berubah" padahal migrasi baru ditambah | state lokal `wrangler dev` masih lama | `npm run db:reset:local && npm run db:migrate:local` |
| Tes gagal dengan biner `workerd`/`esbuild` hilang | `postinstall` diblokir npm | `npm install-scripts approve esbuild workerd` |
| `SQL code did not contain a statement` | `db.exec()` memecah SQL per baris | Pakai `db.prepare(...).run()`, atau `applyD1Migrations()` untuk file migrasi |
| `ON CONFLICT clause does not match ...` | unique index parsial tanpa predikat | Ulangi predikatnya: `ON CONFLICT (...) WHERE status IN (...)` |
| `npm run test` lambat (~1,5 s/berkas) | satu `workerd` per file tes | Normal. Jangan set `isolate: false` tanpa mengukur ulang isolasi D1 |
| Worker merespons 404 JSON untuk `/api/*` yang tidak ada | memang perilaku yang diinginkan | Tambahkan route-nya di `apps/api/src/index.ts` |

Detail lingkungan dan hasil pengukuran: `docs/OPERASIONAL.md`.

## Deploy

Belum pernah dijalankan — belum ada akun Cloudflare yang terhubung. Urutan yang disiapkan:

```bash
cd apps/api
npx wrangler d1 create absensi-db            # isi database_id di wrangler.jsonc
npx wrangler d1 migrations apply absensi-db --remote
npx wrangler secret put QR_PEPPER
npx wrangler secret put SESSION_PEPPER
cd ../.. && npm run build
cd apps/api && npx wrangler deploy
```

`wrangler.jsonc` masih memakai `database_id` placeholder (`00000000-…`) dan **wajib** diganti sebelum deploy.

## Dokumen

| File | Isi |
|---|---|
| `IMPLEMENTATION_PLAN.md` | Fase, kriteria penerimaan, status |
| `docs/ARSITEKTUR.md` | Alur, boundary, model data, keputusan |
| `docs/DESAIN_API.md` | Tabel endpoint |
| `docs/DESAIN_DATABASE.md` | Skema target, indeks, migrasi |
| `docs/RENCANA_PENGUJIAN.md` | Tes wajib dan gerbang kualitas |
| `docs/OPERASIONAL.md` | Hasil spike, quirk lingkungan, item belum terverifikasi |
| `COSTS_AND_LIMITS.md` | Batas free tier |
