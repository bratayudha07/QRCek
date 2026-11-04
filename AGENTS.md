# AGENTS.md

**QRCek** — sistem manajemen kehadiran dan distribusi konsumsi berbasis QR untuk Tema Acara yang memiliki banyak Aktivitas dan Sesi, dengan Admin Acara, Petugas lapangan, audit, laporan, dan sinkronisasi opsional ke Google Sheets.

**Status:** baseline Fase 0–6 berjalan (commit acuan `157c330`); produk sedang diarahkan ulang ke model QRCek. Kebutuhan ada di `docs/REQUIREMENTS.md`, urutan kerja di `docs/IMPLEMENTATION_ROADMAP.md`. Aturan di file ini mengikat.

## Baca dulu, sesuai urutan

1. `docs/REQUIREMENTS.md` — **sumber kebutuhan produk** (FR/BR/NFR/AC, keputusan D-xxx, pertanyaan OQ-xxx). Bedakan **Target** (§4–§6, §9), **Baseline** (§7), dan **Delta** (§8).
2. `docs/DECISIONS.md` — indeks keputusan produk, ADR, dan pertanyaan arsitektur (AQ-xxx) beserta statusnya.
3. `docs/IMPLEMENTATION_ROADMAP.md` — tahap Q0–Q11, prasyarat keputusan, dan gate. **Tahap mana yang sedang dibuka.**
4. `docs/ARCHITECTURE.md` — boundary, model domain target, alur baseline, AQ dengan opsinya.
5. Dokumen teknis aktual sesuai pekerjaan: `docs/DESAIN_API.md`, `docs/DESAIN_DATABASE.md`, `docs/RENCANA_PENGUJIAN.md`, `docs/OPERASIONAL.md`, `COSTS_AND_LIMITS.md`.

## Aturan yang tidak bisa dinegosiasikan

1. **Tidak ada layanan berbayar.** Semua harus masuk free tier: Cloudflare Workers, D1, Static Assets, GitHub. Google Sheets API via service account + kuota gratis. Jangan mengusulkan Cloudflare Access, Workers Paid, Queues, Durable Objects berbayar, R2, atau SaaS auth pihak ketiga tanpa persetujuan eksplisit user.
2. **Jangan tambah dependensi tanpa alasan tertulis.** Setiap dependency baru wajib disertai 1 baris justifikasi di deskripsi PR/commit: masalah apa yang diselesaikan dan kenapa tidak bisa pakai Web API/`node:`/kode sendiri. Perhatikan batasan #1.
3. **Jangan implementasi fitur sebelum tahapnya dibuka** di `docs/IMPLEMENTATION_ROADMAP.md`. Kalau user minta fitur tahap lanjut, kerjakan fondasinya dulu atau tanyakan.
4. **Hormati status keputusan** (`REQUIREMENTS.md` §0.2):
   - `[A]` disepakati → boleh dan wajib diikuti.
   - `[P]` proposed → **jangan** diimplementasikan sebagai keputusan final. Tanyakan, atau siapkan fondasi yang tidak mengunci pilihan.
   - `[O]` terbuka dan `AQ-xxx` → **jangan** memilih jawaban sendiri. AQ dijawab lewat ADR baru yang disetujui pemilik proyek.
   - Keputusan `[A]` tidak dibuka kembali tanpa keputusan baru yang eksplisit. Agent tidak mengubah status keputusan di `REQUIREMENTS.md`.
5. **Aturan integritas data dan keamanan di bawah bersifat permanen.** Jangan dilemahkan demi kecepatan, jangan dipindah ke level UI saja.
6. **Jangan commit secret.** `SESSION_PEPPER`, `QR_PEPPER`, `QR_ENCRYPTION_KEY`, `QR_KEY_VERSION`, `GOOGLE_SA_KEY` hanya lewat `.dev.vars` (gitignored) dan `wrangler secret put`.
7. **Jangan klaim selesai tanpa bukti.** Endpoint atau komponen yang ada ≠ fitur selesai (`FR-178`). Baseline tidak boleh ditulis sebagai pemenuhan target.

## Layout (monorepo, npm workspaces)

```
apps/web/          React + Vite + Tailwind + shadcn/ui (SPA)
apps/api/          Cloudflare Worker `qrcek` (TypeScript), satu-satunya pemegang secret
packages/shared/   Tipe TS + skema validasi + helper murni yang dipakai web & api
migrations/        Migrasi SQL D1 (wrangler d1 migrations)
docs/              REQUIREMENTS, ARCHITECTURE, DECISIONS, adr/, IMPLEMENTATION_ROADMAP, DESAIN_*, RENCANA_PENGUJIAN, OPERASIONAL
.opencode/         agent, command, skill, plans/ (rencana eksekusi per tahap)
```

Pakai **npm workspaces** (bukan pnpm/yarn/turborepo). Jangan buat paket tambahan di luar empat direktori kode itu tanpa alasan kuat.

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

Urutan verifikasi sebelum menyatakan selesai: **`typecheck` → `lint` → `test`**. Jangan melaporkan "selesai" kalau salah satu belum dijalankan. Mesin dev pemilik lemah (Celeron, RAM 4 GB): saat iterasi pakai tes terfokus; suite penuh di akhir.

## Quirk Cloudflare (baca ini sebelum menulis kode)

- **Worker bukan Node.** Tidak ada `fs`, `path`, `process.env`, `Buffer` default, atau `crypto` dari Node. Baca config lewat parameter `env` (`env.DB`, `env.SESSION_PEPPER`, `env.QR_PEPPER`). Web Crypto tersedia sebagai `globalThis.crypto`.
- **D1 adalah SQLite**, bukan Postgres. Tidak ada stored procedure, tidak ada transaksi interaktif. Operasi atomik multi-statement memakai `env.DB.batch([...])`. `ALTER TABLE` sangat terbatas; perubahan merusak memakai pola table rebuild. SQLite menganggap `NULL` berbeda di unique index, dan partial unique index wajib mengulang predikatnya di `ON CONFLICT`.
- **Auth passwordless berbasis token — tidak ada password, tidak ada PBKDF2/bcrypt** (`docs/adr/0002-passwordless-token-auth.md`). Aturan:
  - Kredensial (token aktivasi, token sesi, kode pemulihan) dibuat dari `crypto.getRandomValues` dengan entropi ≥ 100 bit (sesi 256-bit).
  - Yang disimpan di D1 **hanya** `HMAC-SHA256(SESSION_PEPPER, token)`; token mentah tidak pernah masuk DB, log, atau bundle frontend.
  - Sesi dikirim sebagai cookie `absensi_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` 30 hari, `Secure` saat HTTPS. Frontend tidak menyimpan token di `localStorage`/state yang bisa dibaca skrip.
  - Semua request non-GET wajib `X-Absensi-Csrf: 1` **dan** `Origin` cocok dengan host (cek di Worker sebelum routing). Jangan mengganti ini dengan guard React.
  - Rate limit login/aktivasi/pemulihan dari tabel D1 (per IP-hash), bukan UI atau Cloudflare Rate Limiting Rules.
  - Jangan menurunkan entropi token, memperpanjang masa berlaku, atau menonaktifkan CSRF demi kemudahan development. Perubahan pada aturan ini wajib lewat ADR baru.
- **Rate limiting tanpa layanan berbayar**: tabel D1. Jangan mengandalkan Cloudflare Rate Limiting Rules (berbayar).
- **State lokal `wrangler dev`** hidup di `.wrangler/state`. Kalau skema terasa "tidak berubah", reset state lokal dulu, jangan menuduh migrasinya salah.
- **Kamera & `getUserMedia` butuh secure context.** `localhost` aman; domain wajib HTTPS. Di iOS Safari, akses kamera harus dipicu gesture user, bukan `useEffect` otomatis. iOS tidak punya `BarcodeDetector`; fallback `@zxing/browser` wajib.
- **Kuota free tier itu nyata**: Workers 10 ms CPU/request dan ~100k req/hari; D1 50 query/invokasi, 100k baris tulis/hari (indeks ikut dihitung), 500 MB/database; Google Sheets ~60 tulis/menit untuk service account. Rancang **1 scan = 1 request kecil**, sinkronisasi Sheets **batch**, dan tidak ada render gambar/PDF/arsip berat di Worker. Angka: `COSTS_AND_LIMITS.md`.

## Model domain (target, `D-003` [A])

- Hierarki: **Tema Acara → Aktivitas → Sesi (0..n)**. Peserta, Kategori, dan QR Identity melekat ke Tema.
- Setiap transaksi wajib punya konteks Tema + Aktivitas; bila Aktivitas punya Sesi, wajib Sesi valid milik Aktivitas itu. Sesi **tidak pernah** disimpulkan dari jam.
- Transaction Type (Attendance/Consumption) ≠ Transaction Source (QR Scan/Manual Entry) ≠ Correction Operation (Reversal/Adjustment).
- Baseline masih memakai `events` datar dan `attendance` satu baris per `(event_id, participant_id)`. Jangan menganggap model target sudah ada; jangan memilih pemetaan `events` → Tema sendiri (AQ-001).

## Integritas data (permanen)

- **Duplikasi dicegah di database, bukan di kode aplikasi.** Target: constraint unik atas **transaksi efektif** (belum di-reversal) per peserta per ruang lingkup — Aktivitas tanpa Sesi, atau Sesi (`BR-032`, `D-006` [A]); kuota konsumsi juga ditegakkan di database. Baseline: `UNIQUE (event_id, participant_id)` pada `attendance` — **jangan dilepas sebelum constraint pengganti ada dan tes konkurennya lulus**. Pelanggaran constraint = hasil "sudah tercatat/sudah diambil", bukan error 500.
- **Tidak ada transaksi lintas konteks.** Setiap scan wajib memvalidasi bahwa peserta, petugas, Aktivitas, dan Sesi berada di Tema yang sama dan Sesi milik Aktivitas itu. Query selalu di-scope (`event_id = ?` di baseline).
- **QR peserta bersifat opaque.** Payload `absensi:v1:<token 256-bit acak>`, tanpa NIK/email/nama. D1 menyimpan `HMAC-SHA256(QR_PEPPER, token)` untuk lookup **dan** ciphertext AES-256-GCM (`QR_ENCRYPTION_KEY`) untuk cetak ulang; tidak ada plaintext (ADR-0003, ADR-0006). Scope target: **satu QR per Tema + Peserta** (`D-004` [A]). Rotasi membuat token lama langsung tidak berlaku tanpa mengubah riwayat, dan tercatat di audit.
- **Koreksi tidak pernah menimpa.** Koreksi = Reversal (membatalkan efek, transaksi asli tetap ada) atau Adjustment (mencatat before/after). Transaksi yang di-reversal tidak lagi menghalangi transaksi valid berikutnya. Baseline `UPDATE attendance` pada jalur koreksi adalah delta yang harus diganti (roadmap Q5), bukan pola untuk ditiru.
- **Koreksi butuh otorisasi server-side**: hanya Admin Acara (`D-006` [A]); Petugas tidak pernah, termasuk atas transaksinya sendiri. Kewenangan Super Admin tidak termasuk koreksi (`D-024` [A]) — tidak ada emergency override pada rilis awal. Alasan wajib, dan audit ditulis dalam `db.batch()` yang sama.
- **Perubahan entitlement hanya berlaku ke depan**; transaksi sukses lama tidak di-reversal otomatis (`D-005` [A]).
- **Audit log append-only.** Tidak ada klien yang boleh `UPDATE`/`DELETE` baris audit; trigger DB menegakkannya. Retensi: ADR-0008.
- **Riwayat tidak hilang karena konfigurasi.** Menonaktifkan/mengarsipkan peserta, Aktivitas, atau Sesi, atau mencabut tugas Petugas, tidak menghapus transaksi.
- **Semua waktu disimpan UTC** (`INTEGER` ms epoch); konversi zona waktu hanya di lapisan presentasi.

## Keamanan (permanen)

- Otorisasi **selalu** dievaluasi di Worker pada setiap route. Guard di React hanya UX.
- Sesi diverifikasi dari cookie `absensi_session` + hash token di DB pada setiap request. Detail: ADR-0001 (satu Worker same-origin) dan ADR-0002 (passwordless).
- Peran: `superadmin` (Super Admin, lintas Tema), `event_admin` (Admin Acara, Tema yang ditugaskan), `officer` (Petugas, scan sesuai penugasan). Cek kepemilikan Tema/acara dan penugasan secara eksplisit — jangan hanya cek "sudah login". Izin legacy `attendance:correct` tidak boleh dipakai ulang sebagai izin Manual Check-in target (`AC-055`).
- Pendaftaran Admin Acara hanya melalui undangan Super Admin (`D-018` [A]); pendaftaran mandiri publik dinonaktifkan.
- Secret Google Sheets, QR, dan sesi **tidak boleh** sampai ke bundle frontend. Frontend tidak bicara langsung ke Google API.
- Aktivasi akun lewat QR undangan: token sekali pakai, punya masa berlaku, diinvalidasi setelah dipakai.
- Jangan log PII (nama, email, nomor telepon, token QR mentah). Log id, Tema/acara id, dan hasil. Audit menyimpan before/after hanya untuk field allowlist; field sensitif dicatat "berubah" tanpa nilai (`FR-207`).
- Validasi semua input di boundary Worker (body, query, CSV) dengan skema di `packages/shared`. Jangan percaya tipe TypeScript sebagai validasi runtime.
- Impor CSV: batasi ukuran file, validasi header/pemetaan, tolak baris tidak valid alih-alih menyimpannya setengah jadi, dan jangan pernah memperbarui peserta tanpa konfirmasi admin (`FR-050`).
- Identifier teknis (`@absensi/*`, `absensi_session`, `X-Absensi-Csrf`, `absensi:v1:`, D1 `absensi-db`) **tidak di-rename**; nama produk di teks UI/dokumen adalah QRCek (`D-019` [A]).

## Non-goal (jangan dibangun)

Integrasi Canva, card designer, desain kartu di QRCek, generator PDF kartu (individual/massal), dan transaksi offline di scanner (`NG-01`–`NG-06`). Dashboard tanpa chart (`FR-131`).

## Pengujian

- **Vitest** di semua workspace. Tes Worker memakai `@cloudflare/vitest-plugin` agar berjalan di `workerd` dengan binding asli (`env.DB`). Tes web berjalan di Node tanpa DOM; logika UI ditaruh di `apps/web/src/lib/` agar bisa diuji.
- Logika murni (parsing CSV, HMAC, normalisasi, aturan kehadiran, resolver entitlement, validasi lifecycle/konteks, kuota, allowlist audit) **wajib** punya unit test tanpa I/O.
- Setiap aturan integritas harus punya tes yang **gagal kalau aturannya dihapus**: scan ganda per ruang lingkup, scan paralel, transaksi lintas konteks, koreksi oleh Petugas, Reversal membebaskan slot, token undangan dipakai dua kali, token QR dirotasi, impor tanpa konfirmasi. Daftar lengkap: `docs/RENCANA_PENGUJIAN.md` §9.
- Tidak ada tes yang bergantung pada jam nyata — inject waktu.
- Jangan memanggil Google Sheets API sungguhan di tes; pakai fake di balik interface.
- E2E browser belum ada; jangan menambah Playwright/Cypress sebelum tahap yang membutuhkannya dibuka.

## Kualitas kode

- TypeScript `strict` di semua workspace. Tidak ada `any` implisit; `any` eksplisit butuh alasan di komentar.
- **Bahasa**: identifier, komentar, nama file, pesan commit → Inggris. Teks yang dilihat pengguna (UI, pesan error ke user) → Bahasa Indonesia. Dokumen di `docs/` → Bahasa Indonesia dengan istilah teknis Inggris.
- Logika bisnis di `apps/api/src/` (fungsi murni di `domain/`, SQL hanya di `db/`). React component tidak berisi aturan bisnis.
- Handler Worker tipis: parse → validasi → panggil domain → bentuk respons.
- shadcn/ui adalah komponen utama (boleh diinstal via npm atau copy-in di `apps/web/src/components/ui/`). Jangan menambah design system kedua. Ikon Lucide. Optimalkan penggunaan shadcn/ui dan sebaiknya jangan menggambar/membuat UI dari nol secara manual.
- Bentuk respons API konsisten (`{ ok, data | error }`) dan bertipe lewat `packages/shared`. Result code terpisah dari pesan user-facing.

## Dokumentasi

Nama di bawah adalah **kanonik**. Jangan membuat dokumen duplikat dengan nama lain (mis. `architecture.md`, `api.md`, `ARSITEKTUR.md`, `roadmap.md`).

| Dokumen | Isi | Kapan diperbarui |
|---|---|---|
| `docs/REQUIREMENTS.md` | Kebutuhan produk, keputusan produk, baseline, delta | **Hanya oleh product owner.** Agent tidak mengubah kebutuhan atau status keputusan; usulkan perubahan ke user |
| `docs/DECISIONS.md` | Indeks D-xxx, ADR, AQ | Setiap keputusan/ADR/AQ berubah |
| `docs/adr/NNNN-judul.md` | Satu keputusan arsitektur sulit dibalik. Format: konteks → opsi → keputusan → konsekuensi | Keputusan baru = file baru; ADR diterima tidak diedit, hanya digantikan |
| `docs/ARCHITECTURE.md` | Boundary, model domain, alur, AQ | Boundary/model berubah |
| `docs/IMPLEMENTATION_ROADMAP.md` | Tahap, prasyarat, gate, status | Tahap dibuka/ditutup |
| `docs/DESAIN_API.md` | Tabel endpoint aktual | Setiap route berubah |
| `docs/DESAIN_DATABASE.md` | Skema aktual, indeks, migrasi, retensi | Setiap migrasi |
| `docs/RENCANA_PENGUJIAN.md` | Tes wajib dan gerbang kualitas | Tes wajib/aturan berubah |
| `docs/OPERASIONAL.md` | Pengukuran, deploy, prosedur, quirk | Hasil ukur/prosedur berubah |
| `COSTS_AND_LIMITS.md` | Batas free tier dan anggaran | Angka platform/anggaran berubah. Lokasi final: root (`/COSTS_AND_LIMITS.md`); `OQ-027` ditutup. |
| `README.md` | Apa ini, cara jalan lokal, cara deploy | Singkat; bukan tutorial |
| `.opencode/plans/` | Rencana eksekusi per tahap | Setelah tahap dibuka |

Arsip (dibaca untuk riwayat, bukan rencana aktif): `IMPLEMENTATION_PLAN.md` (Fase 0–6, `D-002` [A]), `PLAN_TAB_PESERTA.md` (dievaluasi di roadmap §5), `docs/RISET_KOMPONEN_UI_OPENCODE.md`. Rujukan lama `docs/ARSITEKTUR.md` → `docs/ARCHITECTURE.md` dan `docs/adr/`.

Aturan tambahan:

- Setiap perubahan skema = file migrasi baru di `migrations/` + catatan di `docs/DESAIN_DATABASE.md`. **Jangan pernah mengedit migrasi yang sudah pernah dijalankan** (`0001`–`0006` sudah di remote).
- Status implementasi selalu dibedakan dari kebutuhan; dokumen tidak boleh mengklaim fitur selesai tanpa bukti implementasi dan tes.
- Rencana merujuk `FR-`/`BR-`/`AC-`, bukan menyalin isi `REQUIREMENTS.md`.
- Jangan menghapus file `.md` tanpa konfirmasi pemilik proyek.

## Roadmap

Roadmap aktif: `docs/IMPLEMENTATION_ROADMAP.md` (Q0 dokumen & keputusan → Q1 Tema/Aktivitas/Sesi → Q2 peserta/kategori/impor → Q3 entitlement → Q4 QR per Tema → Q5 transaksi & koreksi → Q6 scanner/kiosk → Q7 konsumsi → Q8 audit/dashboard/laporan → Q9 design system → Q10 Google Sheets → Q11 hardening). Gate: jangan lompat. Setiap tahap butuh review manusia sebelum tahap berikutnya.

Riwayat Fase 0–6 (fondasi, identitas, peserta & QR, scan, rekap & audit, Sheets, hardening) ada di `IMPLEMENTATION_PLAN.md` dan tidak lagi menjadi rencana aktif.

## Keputusan yang masih terbuka

Semua keputusan produk D-001…D-024 sudah disepakati `[A]`. Pertanyaan produk OQ-001…OQ-034 sudah ditutup. Pertanyaan arsitektur terbuka: AQ-001…AQ-014.

Yang sudah diputuskan dan tidak dibuka kembali: topologi satu Worker (ADR-0001), auth passwordless (ADR-0002), QR opaque + hash/ciphertext (ADR-0003/0006), outbox D1 + cron (ADR-0005), retensi audit append-only (ADR-0008), serta keputusan produk `D-001`–`D-007` [A].
