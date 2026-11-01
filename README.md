# Absensi Acara

Sistem absensi peserta berbasis QR untuk **banyak acara sekaligus**. Setiap acara punya admin dan petugas lapangan sendiri; hasil absensi akan disinkronkan ke Google Sheets.

Stack: React + Vite (SPA) · Cloudflare Workers + D1 (API dan database) · Google Sheets API (laporan, fase lanjut). Semua di free tier.

> **Status: Fase 0, Fase 1 (Tahap 2), dan Tahap 3 selesai.** Yang hidup: health check,
> autentikasi passwordless, sesi cookie, peran `superadmin`/`event_admin`/`officer`,
> otorisasi per acara, undangan sekali pakai, kode pemulihan, CRUD acara dengan lifecycle,
> manajemen peserta terisolasi per acara, impor CSV dua langkah, pencarian + paginasi,
> ekspor/template CSV, dan UI-nya. Yang **belum**: QR peserta, pemindaian absensi, rekap,
> audit, dan sinkronisasi Sheets — dikerjakan per fase sesuai `IMPLEMENTATION_PLAN.md`.
>
> Skema database sekarang berisi 10 tabel: `app_meta` (Fase 0); `users`, `events`,
> `event_memberships`, `device_credentials`, `sessions`, `invites`, `recovery_codes`,
> `rate_limits` (Fase 1); `participants` (Tahap 3). Tabel `attendance`, `audit_log`,
> `outbox`, dan `sheet_rows` menyusul pada fasenya; kolom QR pada `participants` juga
> belum ada.

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

Buka **<http://localhost:5173>**. Halaman awal adalah daftar acara (`/acara`); navigasi memakai
bottom floating pill dock. `fetch("/api/*")` diproksikan Vite ke Worker, jadi browser tetap
satu origin seperti produksi.

Buat akun pertama (superadmin). Skrip mencetak URL aktivasi sekali pakai:

```bash
npm run seed:superadmin
# → URL aktivasi : http://localhost:5173/aktivasi#t=...
```

Buka URL itu, klik **Aktifkan akun**, lalu simpan kode pemulihan yang muncul (hanya tampil
sekali). Setelah itu Anda diarahkan ke daftar acara. Untuk masuk lagi dari perangkat lain,
buka `/masuk` dan masukkan kode pemulihan.

> `npm run seed:superadmin` membutuhkan `SESSION_PEPPER` di `apps/api/.dev.vars`. Tanpa itu
> skrip berhenti dengan pesan jelas — lebih baik daripada menulis hash yang tidak akan cocok
> dengan Worker.

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
| Worker (secret) | `apps/api/.dev.vars` | `SESSION_PEPPER`, `QR_PEPPER`, `QR_ENCRYPTION_KEY`, `QR_KEY_VERSION`, `GOOGLE_SA_KEY`, `TURNSTILE_SECRET_KEY` | **tidak** di-commit |
| Worker (contoh) | `.dev.vars.example` | daftar kunci dengan nilai kosong | di-commit |
| Web (publik) | `apps/web/.env.local` | `VITE_API_BASE_URL`, `VITE_TURNSTILE_SITE_KEY` | **tidak** di-commit |
| Web (contoh) | `apps/web/.env.example` | dokumentasi variabel | di-commit |

`VITE_API_BASE_URL` **kosong secara default** dan itu memang yang diinginkan: SPA dan Worker berbagi origin (ADR-001), jadi tidak ada URL production yang di-hardcode. Isi hanya kalau frontend benar-benar disajikan dari origin lain (mis. preview ke Worker staging).

Untuk secret Worker: `cp .dev.vars.example apps/api/.dev.vars` lalu isi. Di production pakai `wrangler secret put`, bukan file.

## Struktur direktori

```
apps/web/                  SPA — React + Vite + Tailwind + shadcn/ui
  src/App.tsx              composition root + router mini (`lib/router.ts`)
  src/pages/               events, event-detail, participant-detail, import, account,
                           activation, login, not-found
  src/components/          app-shell, dock (bottom floating pill), form, badge, page-state
  src/components/ui/       komponen shadcn/ui copy-in (button, field)
  src/lib/                 api, http (fetch + CSRF), auth, router, session, events,
                           participants, format (zona waktu), labels
  vite.config.ts           dev server + proxy /api -> :8787
  .env.example             VITE_API_BASE_URL

apps/api/                  Cloudflare Worker — satu-satunya pemegang secret
  src/index.ts             entry tipis → app.ts
  src/app.ts               tabel ROUTES + handleRequest(request, env, { now })
  src/routes/              auth.ts, events.ts, participants.ts (handler tipis)
  src/http/                auth, cookies, csrf, errors, respond, router, validate
  src/domain/              token, ids, permissions, csv, participant-import,
                           event-status, slug, cursor (murni, tanpa I/O)
  src/db/                  SQL per topik: users, sessions, invites, recovery, rate-limit,
                           events, participants
  src/env.ts               tipe binding (DB, ASSETS, SESSION_PEPPER, ALLOWED_ORIGINS)
  src/test/                tes integrasi + spike D1 (berjalan di workerd)
  wrangler.jsonc           config produksi (D1 + Static Assets)
  wrangler.test.jsonc      config tes (tanpa assets, pepper khusus tes)
  scripts/reset-local-db.mjs
  scripts/seed-superadmin.mjs

packages/shared/           tipe + skema zod + kontrak API dipakai web & api
                           (termasuk tabel transisi status acara di `events.ts`)
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
| `npm run seed:superadmin` | Buat undangan superadmin + cetak URL aktivasi |

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
| Integrasi D1 (skema nyata di `workerd`) | 7 | `apps/api/src/test/db.integration.test.ts` |
| Spike D1 (atomisitas, `RETURNING`, index parsial, query plan, biaya) | 24 | `apps/api/src/test/spike.*.test.ts` |
| Primitif token (base32, HMAC, kode pemulihan) | 16 | `apps/api/src/test/token.test.ts` |
| Generator ID (ULID) | 3 | `apps/api/src/test/ids.test.ts` |
| Matriks izin §5.1 | 6 | `apps/api/src/test/permissions.test.ts` |
| Parser CSV + normalisasi telepon/email | 31 | `apps/api/src/test/csv.test.ts` |
| Lifecycle status acara | 14 | `apps/api/src/test/event-status.test.ts` |
| Auth: aktivasi, umur sesi, logout | 19 | `apps/api/src/test/auth.activate.test.ts` |
| Auth: pemulihan & rotasi kode | 9 | `apps/api/src/test/auth.recover.test.ts` |
| Manajemen sesi perangkat | 5 | `apps/api/src/test/auth.sessions.test.ts` |
| Otorisasi per acara + undangan | 19 | `apps/api/src/test/authz.events.test.ts` |
| Tanpa sesi + CSRF | 9 | `apps/api/src/test/authz.unauthenticated.test.ts` |
| CRUD acara + lifecycle + hapus draf | 20 | `apps/api/src/test/events.crud.test.ts` |
| Peserta: CRUD, cari, paginasi, isolasi, ekspor | 22 | `apps/api/src/test/participants.crud.test.ts` |
| Impor CSV: pratinjau, konfirmasi, idempoten, batas | 16 | `apps/api/src/test/participants.import.test.ts` |
| Frontend: router, format zona waktu, query peserta, base URL | 41 | `apps/web/src/lib/*.test.ts` |

**Total: 266 tes di 26 file.**

Tes API berjalan di `workerd` dengan binding D1 asli (`@cloudflare/vitest-plugin`), memakai file migrasi yang sama dengan wrangler. Tes frontend berjalan di Node tanpa DOM karena yang diuji logika murni.

## Migrasi database

```bash
# 1. buat file baru — JANGAN mengedit migrasi yang sudah pernah dijalankan
touch migrations/0004_<nama>.sql

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
| Worker merespons 404 JSON untuk `/api/*` yang tidak ada | memang perilaku yang diinginkan | Tambahkan route-nya di `apps/api/src/app.ts` |
| Semua POST mengembalikan 403 `CSRF_FAILED` | request non-browser tanpa `Origin` | Kirim `Origin` yang sama dengan host + header `X-Absensi-Csrf: 1` |
| Aktivasi selalu 401 padahal URL baru dibuat | `SESSION_PEPPER` saat seed ≠ pepper Worker | Seed ulang dengan pepper yang sama, atau samakan `.dev.vars` |
| Undangan hangus setelah percobaan aktivasi yang gagal di tengah | klaim undangan terjadi lebih dulu, lalu batch tulis | Buat undangan baru; ini konsekuensi disengaja agar replay tidak mungkin |
| `npm install` mengubah `package-lock.json` | workspace menambah dependensi | Commit lockfile-nya; jangan hapus |

Detail lingkungan dan hasil pengukuran: `docs/OPERASIONAL.md`.

## Deploy

Belum pernah dijalankan — belum ada akun Cloudflare yang terhubung. Urutan yang disiapkan:

```bash
cd apps/api
npx wrangler d1 create absensi-db            # isi database_id di wrangler.jsonc
npx wrangler d1 migrations apply absensi-db --remote
npx wrangler secret put SESSION_PEPPER
npx wrangler secret put QR_PEPPER
npx wrangler secret put QR_ENCRYPTION_KEY   # openssl rand -base64 32
npx wrangler secret put QR_KEY_VERSION      # 1 selama belum ada rotasi
npx wrangler secret put TURNSTILE_SECRET_KEY # secret dari widget yang sama dengan site key di apps/web/.env.production
cd ../.. && npm run build
cd apps/api && npx wrangler deploy

# akun pertama (setelah deploy): ekspor pepper produksi yang sama
cd ../.. && export SESSION_PEPPER='<secret produksi>'
npm run seed:superadmin -- --remote --yes --base-url https://<domain-anda>
```

`wrangler.jsonc` masih memakai `database_id` placeholder (`00000000-…`) dan **wajib** diganti sebelum deploy. Semua pepper/kunci adalah secret, bukan `vars`; jangan pernah menaruhnya di `wrangler.jsonc` atau bundle frontend.

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
