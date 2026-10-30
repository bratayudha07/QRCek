# AGENTS.md

Multi-Event Parent Attendance Management System — platform absensi berbasis QR untuk banyak acara, dengan admin per acara, petugas lapangan, dan sinkronisasi laporan ke Google Sheets.

**Status: greenfield.** Repo ini belum punya kode. Bagian *Layout*, *Commands*, dan *Roadmap* di bawah adalah **spesifikasi yang mengikat**, bukan deskripsi kondisi saat ini. Agent yang menulis kode wajib membuatnya sesuai ini.

## Aturan yang tidak bisa dinegosiasikan

1. **Tidak ada layanan berbayar.** Semua yang dipakai harus masuk free tier: Cloudflare Workers, D1, Pages/Static Assets, GitHub. Google Sheets API dipakai via service account + kuota gratis. Jangan mengusulkan Cloudflare Access, Workers Paid, Queue, Durable Objects berbayar, R2, atau SaaS auth pihak ketiga tanpa persetujuan eksplisit user.
2. **Jangan tambah dependensi tanpa alasan tertulis.** Setiap dependency baru wajib disertai 1 baris justifikasi di deskripsi PR/commit: masalah apa yang diselesaikan dan kenapa tidak bisa pakai Web API/`node:`/kode sendiri. Perhatikan batasan #1.
3. **Jangan implementasi fitur sebelum fase-nya dibuka.** Ikuti *Roadmap*. Kalau user minta fitur fase lanjut, kerjakan fondasinya dulu atau tanyakan.
4. **Aturan integritas data dan keamanan di bawah bersifat permanen.** Jangan dilemahkan demi kecepatan, jangan dipindah ke level UI saja.
5. **Jangan commit secret.** Token Google, `QR_SIGNING_SECRET`, `SESSION_SECRET` hanya lewat `.dev.vars` (gitignored) dan `wrangler secret put`.

## Target layout (monorepo, npm workspaces)

```
apps/web/          React + Vite + Tailwind + shadcn/ui (SPA)
apps/api/          Cloudflare Worker (TypeScript), satu-satunya pemegang secret
packages/shared/   Tipe TS + skema validasi + helper murni yang dipakai web & api
migrations/        Migrasi SQL D1 (wrangler d1 migrations)
docs/              architecture.md, api.md, adr/
```

Pakai **npm workspaces** (bukan pnpm/yarn/turborepo) — tidak menambah tooling. Jangan buat paket tambahan di luar empat direktori itu tanpa alasan kuat.

## Commands (kanonik — harus ada persis seperti ini di root `package.json`)

```
npm run dev:web        # vite dev, http://localhost:5173
npm run dev:api        # wrangler dev, http://localhost:8787
npm run typecheck      # tsc --noEmit di semua workspace
npm run lint
npm run test           # vitest (sekali jalan, bukan watch)
npm run bench          # spike pengukuran hot path (apps/api/src/test/spike.measure.test.ts)
npm run build          # build web + dry-run bundle api
```

Menjalankan tes terfokus:

```
npm run test -- apps/api/src/routes/scan.test.ts        # satu file
npm run test -- -t "menolak scan ganda"                # satu test case
```

Database:

```
npm run db:migrate:local    # wrangler d1 migrations apply <DB> --local
npm run db:migrate:remote   # wajib konfirmasi user sebelum dijalankan
npm run db:reset:local      # hapus .wrangler/state lalu migrate ulang
```

Urutan verifikasi sebelum menyatakan selesai: **`typecheck` → `lint` → `test`**. Jangan melaporkan "selesai" kalau salah satu belum dijalankan.

## Quirk Cloudflare (baca ini sebelum menulis kode)

- **Worker bukan Node.** Tidak ada `fs`, `path`, `process.env`, `Buffer` default, atau `crypto` dari Node. Baca config lewat parameter `env` (`env.DB`, `env.QR_SIGNING_SECRET`). Web Crypto tersedia sebagai `globalThis.crypto`.
- **D1 adalah SQLite**, bukan Postgres. Tidak ada stored procedure, tidak ada transaksi interaktif. Untuk operasi atomik multi-statement gunakan `env.DB.batch([...])`, dan `ALTER TABLE` sangat terbatas — rencanakan skema dengan hati-hati karena mengubahnya setelah migrasi berjalan itu mahal.
- **Auth hashing pakai PBKDF2-SHA256 via Web Crypto** (native, nol dependensi). Jangan pakai `bcrypt` native (tidak kompilasi di workerd); `bcryptjs` hanya kalau PBKDF2 terbukti tidak cukup, dengan justifikasi tertulis.
  - ⚠️ **Aturan ini sedang dipertanyakan.** PBKDF2 di iterasi yang layak diperkirakan melebihi batas **10 ms CPU** Workers Free. Usulan penggantinya adalah autentikasi token sepenuhnya (tanpa password) — lihat `docs/ARSITEKTUR.md` ADR-002. **Jangan implementasi PBKDF2 sebelum ADR-002 disetujui.**
- **Rate limiting tanpa layanan berbayar**: ambil dari tabel D1 (token bucket/sliding window). Jangan mengandalkan Cloudflare Rate Limiting Rules (berbayar).
- **State lokal `wrangler dev`** hidup di `.wrangler/state`. Kalau skema terasa "tidak berubah", reset state lokal dulu, jangan menuduh migrasinya salah.
- **Kamera & `getUserMedia` butuh secure context.** `localhost` aman; domain wajib HTTPS. Di iOS Safari, akses kamera harus dipicu gesture user, bukan `useEffect` otomatis.
- **Kuota free tier itu nyata**: Workers ~100k req/hari, D1 punya batas baris dibaca/hari, Google Sheets API ~300 req/menit/project. Rancang endpoint scan supaya 1 scan = 1 request kecil, dan sinkronisasi Sheets supaya **batch**, bukan per-scan.

## Integritas data (permanen)

- **Absensi ganda dicegah di database, bukan di kode aplikasi.** Wajib ada unique index `(event_id, participant_id)` pada tabel kehadiran. Tangani error unique-constraint sebagai hasil "sudah absen", bukan error 500.
- **QR peserta bersifat opaque + bertanda tangan.** Payload = id/token acak + HMAC-SHA256, bukan NIK/email/nama. QR harus bisa dicabut/dirotasi tanpa mengubah data peserta.
- **Tidak ada pemindaian lintas acara.** Setiap scan wajib memvalidasi bahwa peserta, petugas, dan sesi acara berada di `event_id` yang sama.
- **Audit log append-only.** Tidak ada klien yang boleh `UPDATE`/`DELETE` baris audit. Koreksi absensi = operasi baru yang tercatat (siapa, kapan, alasan, nilai lama → nilai baru), bukan penimpaan diam-diam.
- **Koreksi absensi butuh otorisasi server-side** (admin acara, bukan petugas), dan tercatat di audit log pada request yang sama.
- **Semua waktu disimpan UTC** (ISO-8601 / epoch), konversi zona waktu hanya di lapisan presentasi.

## Keamanan (permanen)

- Otorisasi **selalu** dievaluasi di Worker pada setiap route. Guard di React hanya UX, bukan kontrol keamanan.
- Model peran minimal: `superadmin` (lintas acara), `event_admin` (satu acara), `officer` (scan untuk acara yang ditugaskan). Cek kepemilikan acara secara eksplisit — jangan hanya cek "sudah login".
- Secret Google Sheets dan penandatanganan QR **tidak boleh** pernah sampai ke bundle frontend. Frontend tidak boleh bicara langsung ke Google API.
- Aktivasi akun petugas lewat QR undangan: token sekali pakai, punya masa berlaku, dan diinvalidasi setelah dipakai.
- Jangan log PII (nama, email, nomor telepon, token QR mentah). Log id, event id, dan hasil.
- Validasi semua input di boundary Worker (body, query, CSV) dengan skema di `packages/shared`. Jangan percaya tipe TypeScript sebagai validasi runtime.
- Import CSV: batasi ukuran file, validasi header, tolak baris yang tidak valid alih-alih menyimpannya setengah jadi.

## Pengujian

- **Vitest** di semua workspace. Tes Worker memakai `@cloudflare/vitest-plugin` (paket lama bernama `@cloudflare/vitest-pool-workers`; plugin baru butuh Vitest ≥ 4.1) agar berjalan di `workerd` dengan binding asli (`env.DB`).
- Logika murni (parsing CSV, verifikasi HMAC, normalisasi nomor, aturan status kehadiran) **wajib** punya unit test tanpa I/O.
- Setiap aturan integritas di atas harus punya tes yang gagal kalau aturannya dihapus: scan ganda, scan lintas acara, koreksi tanpa otorisasi, token undangan dipakai dua kali.
- Tidak ada tes yang bergantung pada jam nyata — inject waktu.
- Jangan pakai tes yang memanggil Google Sheets API sungguhan. Isolasi di balik interface dan pakai fake di tes.
- E2E browser belum ada; jangan menambah Playwright/Cypress sebelum fase yang membutuhkannya dibuka.

## Kualitas kode

- TypeScript `strict` di semua workspace. Tidak ada `any` implisit; `any` eksplisit butuh alasan di komentar.
- **Bahasa**: identifier, komentar, nama file, pesan commit → Inggris. Teks yang dilihat pengguna (UI, email, pesan error ke user) → Bahasa Indonesia.
- Logika bisnis di `apps/api/src/` (fungsi murni di `domain/`, akses DB di `db/`). React component tidak boleh berisi aturan bisnis.
- Handler Worker tipis: parse → validasi → panggil domain → bentuk respons. Jangan menaruh SQL di dalam komponen React.
- shadcn/ui bersifat **copy-in**: komponen ditambahkan ke `apps/web/src/components/ui/`. Jangan menganggapnya library yang di-import; jangan menambah design system kedua.
- Bentuk respons API konsisten dan bertipe, dipakai bersama lewat `packages/shared`.

## Dokumentasi

- `docs/ARSITEKTUR.md` — diagram alur, boundary, model data, keputusan arsitektur. Perbarui saat boundary berubah.
- `docs/adr/NNNN-judul.md` — satu file per keputusan arsitektural yang sulit dibalik (auth, strategi QR, sinkronisasi Sheets, layout origin). Format: konteks → opsi → keputusan → konsekuensi.
- `docs/DESAIN_API.md` — tabel endpoint (method, path, peran, ringkas). Perbarui setiap menambah route.
- `docs/DESAIN_DATABASE.md` — skema, indeks, strategi migrasi, kebijakan retensi.
- `docs/RENCANA_PENGUJIAN.md` — daftar tes wajib dan gerbang kualitas.
- `COSTS_AND_LIMITS.md` — batas free tier terverifikasi dan anggaran pemakaian. Perbarui bila angka platform berubah.
- `IMPLEMENTATION_PLAN.md` — fase, kriteria penerimaan, status. Perbarui saat fase dibuka/ditutup.
- Jangan membuat dokumen duplikat dengan nama lain (mis. `architecture.md`, `api.md`); dokumen di atas adalah nama kanonik.
- Setiap perubahan skema = file migrasi baru di `migrations/` + catatan di `docs/DESAIN_DATABASE.md`. **Jangan pernah mengedit migrasi yang sudah pernah dijalankan.**
- Jangan menulis tutorial panjang di README; README cukup: apa ini, cara jalan lokal, cara deploy.

## Roadmap bertahap (gate: jangan lompat)

**Fase 0 — Fondasi.** Workspace, TS strict, Vite+Tailwind+shadcn, Worker hello-world, D1 binding, pipeline migrasi, Vitest, CI GitHub Actions (typecheck+lint+test). *Gate: semua command di atas hijau.*

**Fase 1 — Identitas & acara.** Skema DB (users, events, memberships). Auth + sesi. CRUD acara oleh superadmin, penugasan admin/petugas. *Gate: tes otorisasi lintas acara lulus.*

**Fase 2 — Peserta & QR.** Import CSV, pembuatan peserta, QR bertanda tangan, halaman cetak/unduh QR. *Gate: tes HMAC + tes parsing CSV lulus.*

**Fase 3 — Scan & kehadiran.** Undangan/aktivasi petugas via QR, endpoint scan, pemindai kamera di mobile, pencegahan ganda di DB. *Gate: tes scan ganda & lintas acara lulus.*

**Fase 4 — Rekap & audit.** Dashboard rekap per acara, audit log, koreksi absensi ber-otorisasi. *Gate: tes koreksi tanpa otorisasi ditolak.*

**Fase 5 — Google Sheets.** Export + sinkronisasi batch, idempoten, dengan status sinkronisasi yang bisa di-retry. *Gate: tes dengan fake Sheets client lulus.*

**Fase 6 — Hardening & deploy.** Rate limiting, observability, deploy produksi, dokumentasi operasional.

## Keputusan yang masih terbuka

Selesaikan di sesi perencanaan arsitektur, catat sebagai ADR — jangan diam-diam dipilih saat menulis kode:

1. **Topologi origin**: satu Worker yang menyajikan static assets (same-origin, tanpa CORS) vs Pages terpisah + Worker API di subdomain (perlu CORS). Trade-off: kesederhanaan vs independensi deploy.
2. **Mekanisme sesi**: cookie `HttpOnly` same-origin vs bearer token di `Authorization`. Bergantung pada #1.
3. **Bentuk token QR**: random opaque yang di-lookup di DB vs payload berisi data + HMAC. Trade-off: rotasi/revokasi vs jumlah query saat scan.
4. **Mode sinkronisasi Sheets**: append-only vs upsert per `participant_id`, dan bagaimana mencegah duplikasi saat retry.
5. **Batas free tier D1** untuk audit log jangka panjang — perlu strategi arsip?
