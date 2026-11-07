# QRCek

Sistem manajemen kehadiran dan distribusi konsumsi berbasis QR untuk Tema Acara yang memiliki
banyak Aktivitas dan Sesi, dengan Admin Acara, Petugas lapangan, audit, laporan, dan
sinkronisasi opsional ke Google Sheets.

Stack: React + Vite · Cloudflare Workers + D1 · Google Sheets API (opsional).

> **Status:** kode saat ini adalah baseline Fase 0–6 dengan model acara datar (satu kehadiran
> per peserta per acara). Model QRCek (Tema → Aktivitas → Sesi, entitlement, konsumsi,
> Reversal/Adjustment) **belum diimplementasikan**. Kebutuhan ada di
> [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md), urutan kerja di
> [`docs/IMPLEMENTATION_ROADMAP.md`](docs/IMPLEMENTATION_ROADMAP.md).
>
> Identifier teknis tetap memakai `absensi` (`@absensi/*`, cookie `absensi_session`, prefix QR
> `absensi:v1:`, D1 `absensi-db`); nama produk adalah QRCek.

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

Buka **<http://localhost:5173>**. Halaman admin acara berada di `/admin/events` (rute lama
`/acara` tetap didukung). Browser menggunakan API same-origin melalui proxy Vite.

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
| Worker (secret) | `apps/api/.dev.vars` | `SESSION_PEPPER`, `QR_PEPPER`, `QR_ENCRYPTION_KEY`, `QR_KEY_VERSION`, `GOOGLE_SA_KEY` | **tidak** di-commit |
| Worker (contoh) | `.dev.vars.example` | daftar kunci dengan nilai kosong | di-commit |
| Web (publik) | `apps/web/.env.local` | `VITE_API_BASE_URL` (opsional) | **tidak** di-commit |
| Web (contoh) | `apps/web/.env.example` | dokumentasi variabel | di-commit |

`VITE_API_BASE_URL` **kosong secara default** dan itu memang yang diinginkan: SPA dan Worker berbagi origin (ADR-001), jadi tidak ada URL production yang di-hardcode. Isi hanya kalau frontend benar-benar disajikan dari origin lain (mis. preview ke Worker staging).

Untuk secret Worker: `cp .dev.vars.example apps/api/.dev.vars` lalu isi. Di production pakai `wrangler secret put`, bukan file.

## Struktur direktori

```
apps/web/                  SPA — React + Vite + Tailwind + shadcn/ui
  src/App.tsx              composition root + router mini (`lib/router.ts`)
  src/pages/               admin (dashboard, events, event-*, import, labels, activity,
                           account) dan staff (staff.tsx: beranda, scan, riwayat); auth (activation,
                           login, register)
  src/components/          layout, sidebar, bottom-nav, event-tabs, qr-code, qr-scanner, …
  src/components/ui/       komponen shadcn/ui (copy-in atau terinstal via npm)
  src/lib/                 logika UI murni + teruji: router, navigation, api, http (CSRF),
                           scanner, qr-labels, format (zona waktu), …
  vite.config.ts           dev server + proxy /api -> :8787

apps/api/                  Cloudflare Worker `qrcek` — satu-satunya pemegang secret
  src/index.ts             entry tipis (fetch + scheduled) → app.ts
  src/app.ts               tabel ROUTES (+ alias /api/calendar) + handleRequest
  src/routes/              satu file per resource (auth, events, participants, labels,
                           scan, attendance, dashboard, audit, sync, health, admin)
  src/http/                router, security (CSRF/Origin), cookies, auth, errors, headers
  src/domain/              fungsi murni tanpa I/O (token, qr-token, permissions, csv,
                           participant-import, attendance-policy, outbox-policy, …)
  src/db/                  semua SQL, per topik
  src/services/            outbox, housekeeping
  src/test/                tes integrasi + spike D1 (berjalan di workerd)
  wrangler.jsonc           config produksi (D1 + Static Assets + cron)
  wrangler.test.jsonc      config tes (tanpa assets, pepper khusus tes)
  scripts/                 reset-local-db.mjs, seed-superadmin.mjs

packages/shared/           tipe + skema zod + kontrak API dipakai web & api
migrations/                migrasi SQL D1 0001–0006 (urutan = nama file; jangan diedit)
docs/                      kebutuhan, keputusan, arsitektur, roadmap, desain teknis
.opencode/                 konfigurasi agent OpenCode (agents, commands, skills, plans)
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

Jalankan `npm run typecheck`, `npm run lint`, lalu `npm run test`. Tes Worker berjalan di
`workerd` dengan D1 melalui `@cloudflare/vitest-plugin`; tes frontend memeriksa logika murni
di Node. Cakupan terkini dan tes yang masih perlu dikerjakan ada di
[`docs/RENCANA_PENGUJIAN.md`](docs/RENCANA_PENGUJIAN.md).

## Migrasi database

```bash
# 1. buat file baru — JANGAN mengedit migrasi yang sudah pernah dijalankan
touch migrations/0007_<nama>.sql

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
| `npm run test` lambat (~1,5 s/berkas) | satu `workerd` per file tes | Normal. Saat iterasi pakai tes terfokus. Jangan set `isolate: false` tanpa mengukur ulang isolasi D1 |
| Worker merespons 404 JSON untuk `/api/*` yang tidak ada | memang perilaku yang diinginkan | Tambahkan route-nya di `apps/api/src/app.ts` |
| Semua POST mengembalikan 403 `CSRF_FAILED` | request non-browser tanpa `Origin` | Kirim `Origin` yang sama dengan host + header `X-Absensi-Csrf: 1` |
| Aktivasi selalu 401 padahal URL baru dibuat | `SESSION_PEPPER` saat seed ≠ pepper Worker | Seed ulang dengan pepper yang sama, atau samakan `.dev.vars` |
| Undangan hangus setelah percobaan aktivasi yang gagal di tengah | klaim undangan terjadi lebih dulu, lalu batch tulis | Buat undangan baru; ini konsekuensi disengaja agar replay tidak mungkin |
| `npm install` mengubah `package-lock.json` | workspace menambah dependensi | Commit lockfile-nya; jangan hapus |

Detail lingkungan dan hasil pengukuran: `docs/OPERASIONAL.md`.

## Deploy

Deploy produksi memakai **GitHub Actions**, bukan Workers Builds. Hanya push ke `main`
(atau `workflow_dispatch` dari `main`) yang boleh deploy:

| Workflow | Trigger | Tugas |
|---|---|---|
| `.github/workflows/ci.yml` | Pull request | `typecheck` → `lint` → `test` → `build` |
| `.github/workflows/deploy.yml` | Push/`workflow_dispatch` di `main` | Verifikasi yang sama, lalu `wrangler deploy` |
| `.github/workflows/migrate.yml` | `workflow_dispatch` di `main` | `wrangler d1 migrations apply absensi-db --remote` (manual, dengan approval) |

Worker produksi: [`qrcek.hamdirobbi5.workers.dev`](https://qrcek.hamdirobbi5.workers.dev).

### Setup sekali

1. **Putuskan Workers Builds** di dashboard Cloudflare (Worker → Settings → Build) agar tidak
   ada dua deployer. Kalau tidak dimatikan, push ke `main` bisa deploy dua kali.
2. Set repo secret dan variable (nilai tidak pernah masuk repo):

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN      # token dengan izin Workers Scripts:Edit + D1:Edit
   gh secret set CLOUDFLARE_ACCOUNT_ID
   ```

   Tidak ada `VITE_*` wajib saat ini. Bila nanti ditambah, nilainya harus publik dan diatur
   sebagai repo variable/build environment.

3. Opsional: buat GitHub Environment bernama `production` dan tambahkan required reviewers.
   Workflow deploy dan migrate sudah memakai environment itu; tanpa proteksi, deploy dari
   `main` berjalan otomatis setelah verifikasi hijau.

### Urutan rilis saat skema berubah

1. Jalankan **Migrate D1** dari `main` (Actions → Migrate D1 → Run workflow), setujui environment.
2. Jalankan **Deploy** dari `main` (otomatis lewat push, atau `workflow_dispatch`).

Jangan menerapkan migrasi yang mengubah kontrak tabel lebih dulu tanpa kode yang cocok:
Worker lama tetap melayani request sampai deploy selesai. Untuk `0008`, trigger kategori
membuat Worker lama gagal membuat peserta, jadi migrasi dan deploy harus berdekatan
(`docs/IMPLEMENTATION_ROADMAP.md` Q2).

**Yang tidak dilakukan otomatis oleh deploy:**

- **Migrasi D1 tidak ikut deploy.** Workflow `migrate.yml` terpisah dan manual.
- **Secret tidak ikut ter-deploy.** `SESSION_PEPPER`, `QR_PEPPER`, `QR_ENCRYPTION_KEY`,
  `QR_KEY_VERSION`, `GOOGLE_SA_KEY` tetap lewat
  `npx wrangler secret put <NAMA>` dari `apps/api`. Jangan menampilkan atau mencatat nilainya.
- **Tidak ada variabel build frontend yang wajib.** `VITE_API_BASE_URL` kosong secara default
  karena SPA dan Worker berbagi origin. Bila suatu saat menambah `VITE_*`, nilainya harus
  publik dan diatur sebagai repo variable / build environment.

Deploy manual tetap mungkin sebagai fallback:

```bash
npm run build
cd apps/api
npx wrangler deploy
```

Verifikasi setelah deploy:

```bash
curl -s  https://qrcek.hamdirobbi5.workers.dev/api/health
curl -s  https://qrcek.hamdirobbi5.workers.dev/api/health/ready
curl -sI https://qrcek.hamdirobbi5.workers.dev/ | grep -i "content-security-policy"
```

`/api/health/ready`, `/api/admin/usage`, dan security headers baru ada setelah commit yang
memuatnya ter-deploy. Status, kuota build, dan prosedur rollback ada di
[`docs/OPERASIONAL.md`](docs/OPERASIONAL.md) §10.

## Dokumen

| File | Isi |
|---|---|
| `AGENTS.md` | Aturan mengikat untuk agent AI dan kontributor |
| `docs/REQUIREMENTS.md` | Kebutuhan produk, keputusan produk, baseline, delta |
| `docs/DECISIONS.md` | Indeks keputusan produk, ADR, dan pertanyaan arsitektur |
| `docs/adr/` | Keputusan arsitektur individual (ADR-0001–0008) |
| `docs/ARCHITECTURE.md` | Boundary, model domain target, alur baseline |
| `docs/IMPLEMENTATION_ROADMAP.md` | Tahap Q0–Q11, prasyarat, gate |
| `docs/DESAIN_API.md` | Tabel endpoint aktual |
| `docs/DESAIN_DATABASE.md` | Skema aktual, indeks, migrasi |
| `docs/RENCANA_PENGUJIAN.md` | Tes wajib dan gerbang kualitas |
| `docs/OPERASIONAL.md` | Hasil spike, deploy, prosedur, quirk lingkungan |
| `COSTS_AND_LIMITS.md` | Batas free tier dan anggaran |
| `IMPLEMENTATION_PLAN.md` | Arsip historis Fase 0–6 |
