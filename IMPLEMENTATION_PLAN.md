# IMPLEMENTATION_PLAN

Rencana implementasi bertahap untuk Multi-Event Parent Attendance Management System.

**Status: menunggu persetujuan.** Tidak ada kode aplikasi yang ditulis pada tahap ini.

Dokumen pendukung: [`AGENTS.md`](./AGENTS.md), [`docs/ARSITEKTUR.md`](./docs/ARSITEKTUR.md), [`docs/DESAIN_DATABASE.md`](./docs/DESAIN_DATABASE.md), [`docs/DESAIN_API.md`](./docs/DESAIN_API.md), [`docs/RENCANA_PENGUJIAN.md`](./docs/RENCANA_PENGUJIAN.md), [`COSTS_AND_LIMITS.md`](./COSTS_AND_LIMITS.md).

---

## Prinsip pelaksanaan

1. **Satu fase = satu PR yang bisa direview habis.** Tidak ada fase yang digabung.
2. **Gerbang fase bersifat keras.** Fase berikutnya tidak dimulai sebelum semua kriteria penerimaan fase sebelumnya terpenuhi dan dibuktikan dengan perintah yang bisa dijalankan ulang.
3. **Tidak ada fitur yang diimplementasikan "sekalian".** Kalau muncul ide di tengah fase, catat sebagai usulan; jangan dikerjakan.
4. **Setiap fase harus meninggalkan repo dalam keadaan hijau**: `typecheck` → `lint` → `test` lulus, dan `build` sukses.
5. **Ukur, jangan tebak.** Setiap klaim performa (CPU, jumlah query, ukuran baris) harus punya angka hasil pengukuran, bukan estimasi di dokumen.

---

## Ringkasan fase

| Fase | Fokus | Fitur yang hidup setelah fase | Perkiraan |
|---|---|---|---|
| 0 | Fondasi & pengukuran | `GET /api/health` | 1–2 hari |
| 1 | Identitas & acara | Login token, buat acara, tugaskan admin | 3–4 hari |
| 2 | Peserta & QR | Import CSV, cetak QR | 3–4 hari |
| 3 | Scan & kehadiran | Absensi berjalan end-to-end | 4–5 hari |
| 4 | Rekap & audit | Dashboard, koreksi ber-otorisasi | 3–4 hari |
| 5 | Google Sheets | Sync idempoten + outbox | 3–4 hari |
| 6 | Hardening & deploy | Produksi | 2–3 hari |

Total: ~20–26 hari kerja efektif. Perkiraan ini mengasumsikan satu orang; tidak mengikat.

---

## FASE 0 — Fondasi, pengukuran, dan gerbang performa

**Tujuan**: membuktikan bahwa platform free tier sanggup menjalankan sistem ini **sebelum** membangun fitur di atasnya. Ini fase yang mencegah seluruh proyek dibangun di atas asumsi yang salah.

> **Status: SELESAI SEBAGIAN — 3 butir belum terverifikasi.** Semua gerbang lokal hijau
> (`typecheck`, `lint`, `test` 34/34, `build`, migrasi lokal, dev loop). Yang **belum**:
> gerbang CPU p95 ≤ 5 ms (butuh akun Cloudflare + `wrangler tail`), perilaku `Set-Cookie`
> lewat Static Assets (belum ada endpoint penerbit cookie — Fase 1), dan CI hijau
> (repo belum di-`git init`, workflow belum pernah dijalankan).
> Hasil lengkap: `docs/OPERASIONAL.md`.

### Catatan deviasi dari rencana

| Rencana | Yang dikerjakan | Alasan |
|---|---|---|
| Satu file `migrations/0001_init.sql` | Tiga file: `0001_init.sql`, `0002_auth.sql`, `0003_sync.sql` | Mengikuti `docs/DESAIN_DATABASE.md` (dokumen desain adalah acuan); memisahkan domain, auth, dan sync membuat migrasi lebih mudah ditinjau |
| `apps/api/src/test/bench.test.ts` | `apps/api/src/test/spike.measure.test.ts` + `npm run bench` | Nama file mengikuti pola `spike.*.test.ts` agar jelas mana tes gerbang dan mana spike |
| `wrangler.jsonc` untuk tes | Tambahan `wrangler.test.jsonc` | Tanpa `assets`, `npm run test` tidak menuntut hasil build SPA lebih dulu |

### Pekerjaan

1. Inisialisasi npm workspaces: `apps/web`, `apps/api`, `packages/shared`.
2. `tsconfig.base.json` dengan `strict: true`, `noUncheckedIndexedAccess: true`.
3. `apps/api`: Worker minimal (`GET /api/health`), `wrangler.jsonc` dengan binding D1 + Static Assets (`run_worker_first: ["/api/*"]`, `not_found_handling: "single-page-application"`).
4. `apps/web`: Vite + React + TS + Tailwind + shadcn/ui (`components.json`), proxy `/api` → `:8787`.
5. `migrations/0001_init.sql` (skema penuh dari `DESAIN_DATABASE.md`).
6. Script kanonik di root `package.json` sesuai `AGENTS.md`.
7. Vitest: unit (node) + integrasi (`@cloudflare/vitest-plugin`), satu tes contoh D1.
8. CI GitHub Actions: `typecheck → lint → test → build`.
9. `.dev.vars.example`, `.gitignore`.
10. **Spike pengukuran** (lihat di bawah).

### Spike pengukuran — keluaran wajib

Buat modul `apps/api/src/test/bench.test.ts` atau skrip `npm run bench` yang mengukur:

| Yang diukur | Cara | Ambang lulus | Hasil Fase 0 |
|---|---|---|---|
| CPU 1 HMAC-SHA256 + 4 statement D1 | `wrangler dev` + `wrangler tail` (kolom CPU time), 100 request berturut | **p95 ≤ 5 ms** | ⚠️ **Belum terverifikasi.** Hanya proksi wall-clock lokal: scan proxy p50 7 ms / p95 11 ms; HMAC 0,054 ms/op. CPU platform butuh Worker ter-deploy |
| Atomisitas `db.batch()` | Batch dengan statement ke-2 melanggar constraint → pastikan statement ke-1 tidak tersimpan | Terbukti atomik | ✅ Atomik (`spike.batch.test.ts`) |
| `RETURNING` pada `INSERT ... ON CONFLICT` | Query langsung | Didukung / tidak (menentukan desain rate limit) | ✅ Didukung, termasuk di dalam `batch()` (`spike.returning.test.ts`) |
| Partial unique index | Migrasi + insert duplikat | Didukung | ✅ Didukung. **Temuan**: `ON CONFLICT` wajib mengulang predikat indeks (`spike.index.test.ts`) |
| `EXPLAIN QUERY PLAN` | Semua query utama | `SEARCH`, bukan `SCAN` | ✅ 10/10 `SEARCH ... USING INDEX` (`spike.explain.test.ts`) |
| Perilaku `Set-Cookie` dengan Static Assets | Request ke `/api/*` | Cookie tidak terpotong | ⚠️ **Belum dapat diuji.** Belum ada endpoint yang menerbitkan cookie; ditunda ke Fase 1 |
| Batas ukuran import | Kirim CSV 500 / 1.000 / 2.000 baris | Menemukan titik di mana CPU > 5 ms | ⚠️ **Sebagian.** Wall-clock: 180 / 354 / 601 ms. Titik CPU belum diketahui → batas sementara **1.000 baris/request** |

**Hasil spike menjadi keputusan konkret**: berapa baris maksimum per import, apakah rate limit memakai `RETURNING`, apakah `batch()` boleh diandalkan untuk atomisitas.

Keputusan yang sudah diambil: rate limit memakai `RETURNING`; absensi + outbox + audit dalam satu `batch()`; import dibatasi 1.000 baris sampai CPU terukur; upsert outbox wajib menyertakan predikat partial index.

### Kriteria penerimaan (terukur)

- [x] `npm run typecheck` → 0 error.
- [x] `npm run lint` → 0 error, 0 warning.
- [x] `npm run test` → lulus, ≥ 1 tes unit + ≥ 1 tes integrasi D1 yang benar-benar menyentuh `env.DB`. *(9 file, 34 tes)*
- [x] `npm run build` → menghasilkan `apps/web/dist/index.html` dan bundle Worker.
- [x] `npm run dev:web` + `npm run dev:api` → `/api/health` merespons `{"ok":true}` dari `http://localhost:5173/api/health`.
- [x] `npm run db:migrate:local` pada database kosong → semua tabel, indeks, dan trigger terbentuk (14 tabel + 2 trigger); migrasi kedua kali → `No migrations to apply`.
- [x] Semua 7 item spike punya angka/kesimpulan tertulis di `docs/ARSITEKTUR.md` §11 atau `docs/OPERASIONAL.md`. *(3 di antaranya tercatat sebagai **belum terverifikasi**, bukan lulus)*
- [ ] CI hijau pada PR fase ini. **Belum terverifikasi** — repo belum di-`git init` dan workflow belum pernah dijalankan.

### Risiko fase ini

| Risiko | Bila terjadi |
|---|---|
| CPU > 5 ms untuk operasi dasar | Turunkan cakupan endpoint, atau ajukan diskusi paket berbayar ke pemilik proyek (**jangan** diputuskan sendiri) |
| `batch()` tidak atomik | Redesain penulisan: satu statement dengan `INSERT ... SELECT`, atau kompensasi manual |
| `RETURNING` tidak didukung | Rate limit memakai `UPDATE` + `SELECT` dalam batch |

---

## FASE 1 — Identitas, sesi, dan manajemen acara

**Tujuan**: seseorang bisa masuk tanpa password dan mengelola acara.

### Pekerjaan

1. `migrations/0002_auth.sql`.
2. `domain/token.ts`: generate + hash + verify (HMAC-SHA256, `crypto.subtle`).
3. `domain/permissions.ts`: matriks peran (sumber kebenaran tunggal).
4. Middleware: `auth` (sesi → user → membership), `csrf`, `error` (pemetaan error → kode respons), `request-id`.
5. Endpoint auth: `activate`, `recover`, `me`, `logout`, `sessions`, `revoke`, `recovery-code`.
6. Seed superadmin awal: skrip `npm run seed:superadmin` yang mencetak URL aktivasi (bukan menyimpan password).
7. Endpoint events: `list`, `create`, `get`, `patch`, `status`, `summary` (hitungan kosong dulu).
8. Endpoint invites: `create`, `list`, `delete`, `members`, `revoke`.
9. UI: halaman aktivasi (`/aktivasi#t=`), halaman login-by-code, layout dashboard, halaman daftar acara + form buat acara.

### Kriteria penerimaan (terukur)

- [ ] Tes `invite.replay`, `invite.expired`, `invite.revoke-kills-sessions`, `recover.rotates-devices` lulus.
- [ ] Tes `authz.unauthenticated` iterasi **semua** route terdaftar → 100% mengembalikan 401.
- [ ] `authz.cross-event-member`: admin acara A mengakses acara B → 404.
- [ ] Matriks otorisasi §5.1 `RENCANA_PENGUJIAN.md` dieksekusi sebagai tes parametrik dan lulus.
- [ ] Token undangan **tidak pernah** muncul di log: `grep` pada output `wrangler tail` selama 20 request aktivasi → 0 kemunculan token.
- [ ] `POST /auth/activate` mengembalikan `recoveryCode` tepat sekali; pemanggilan `GET /auth/me` berikutnya tidak memuatnya.
- [ ] Semua transisi status acara (sah dan terlarang) tercakup tes `domain/event-status.ts`.
- [ ] Setiap endpoint ≤ 6 statement D1 (dihitung manual + `meta` pada tes).

### Yang sengaja belum dikerjakan

Peserta, QR, scan, rekap nyata, sync. Endpoint `summary` mengembalikan angka nol yang sah.

---

## FASE 2 — Peserta, import CSV, dan QR

**Tujuan**: peserta masuk sistem dan punya QR yang bisa dicetak.

### Pekerjaan

1. `domain/csv/`: parser (delimiter, kutip, BOM, newline dalam kutip) + validator baris. **Murni, tanpa I/O.**
2. `domain/qr.ts`: pembuatan token peserta, format `absensi:v1:<token>`.
3. Endpoint participants: `list`, `create`, `patch`, `rotate`, `delete`, `import` (dry-run + eksekusi), `qr-labels`.
4. UI: tabel peserta (paginasi kursor, pencarian), form tambah/edit, halaman import dengan pratinjau hasil dry-run, halaman cetak label QR (`window.print()` + CSS `@page`).
5. Generator QR di klien (`qrcode`) dengan ukuran yang diuji terbaca.

### Kriteria penerimaan (terukur)

- [ ] Parser CSV: **≥ 15 kasus** unit test, termasuk kutip berisi koma, newline di dalam kutip, BOM, delimiter `;`, baris kosong, header duplikat.
- [ ] `import.idempotent`: import file yang sama dua kali → jumlah peserta tidak berubah.
- [ ] `import.partial-invalid`: file 100 baris dengan 3 baris rusak → 97 tersimpan, 3 dilaporkan dengan nomor baris yang benar.
- [ ] Batas keras terbukti: > 2 MB → 413; > batas baris (nilai final dari spike Fase 0) → 413 dengan pesan yang menyebut batasnya.
- [ ] Setiap peserta punya `qr_token_hash` unik; insert 1.000 peserta → 1.000 hash berbeda (tes).
- [ ] Cetak label: 20 QR dicetak dari browser → minimal 19 terbaca oleh `BarcodeDetector` di Android pada jarak 20 cm (uji manual terdokumentasi).
- [ ] `qr-labels` menulis entri audit `qr.labels_exported` setiap pemanggilan.
- [ ] `officer` memanggil `import` atau `qr-labels` → 403.

### Catatan desain

Tidak ada kolom QR di CSV (lihat `DESAIN_API.md` §5). Ini menghilangkan seluruh kelas bug "dua peserta dengan QR sama" dan memastikan token tidak pernah melewati saluran yang tidak aman.

---

## FASE 3 — Pemindaian dan pencatatan kehadiran

**Tujuan**: fitur inti bekerja di HP sungguhan. Ini fase dengan risiko teknis tertinggi.

### Pekerjaan

1. Endpoint `POST /api/events/:id/scan` sesuai `DESAIN_API.md` §6.
2. Endpoint `POST /api/events/:id/attendance/manual` (fallback).
3. UI scanner: akses kamera (`getUserMedia`) dipicu gesture, `BarcodeDetector` bila tersedia, fallback `@zxing/browser`.
4. Umpan balik hasil: `present` (hijau + nama), `duplicate` (kuning + jam pertama), `not_found`/`wrong_event` (merah), dengan bunyi berbeda per hasil.
5. Antrean retry klien: bila request gagal karena jaringan, ulangi dengan `Idempotency-Key`; hasil `duplicate` ditampilkan sebagai "sudah tercatat", bukan error.
6. PWA-lite: `manifest.json` + `display: standalone` agar terasa seperti aplikasi (tanpa service worker offline).

### Kriteria penerimaan (terukur)

- [ ] `scan.present`, `scan.duplicate`, `scan.concurrent`, `scan.cross-event`, `scan.closed-event`, `scan.inactive-participant` lulus.
- [ ] **`scan.concurrent` dijalankan 50 kali** dengan dua request paralel → selalu tepat 1 baris `attendance` (tidak ada flakiness).
- [ ] CPU p95 `POST /scan` ≤ 5 ms diukur dari `wrangler tail` pada 200 request.
- [ ] Statement D1 per scan ≤ 4 (dibuktikan dengan menghitung query di kode + `meta`).
- [ ] Rate limit: scan ke-121 dalam satu menit → 429 dengan `Retry-After`.
- [ ] Di **iPhone fisik**: kamera terbuka (fallback ZXing aktif), 20 scan berturut-turut berhasil tanpa reload halaman.
- [ ] Di **Android fisik**: `BarcodeDetector` terpakai (dibuktikan lewat log non-PII), 20 scan berhasil.
- [ ] Scan dengan QR acara lain menampilkan pesan yang menyebut nama acara yang benar.
- [ ] Dengan jaringan dimatikan: UI menampilkan pesan yang bisa ditindaklanjuti, tidak blank/crash.
- [ ] Tidak ada PII (nama peserta) di log Worker — hanya `participantId`.

### Kriteria gagal (rollback)

Bila `scan.concurrent` tidak bisa dibuat deterministik setelah 2 hari kerja, hentikan fase dan evaluasi ulang asumsi atomisitas `db.batch()`. **Jangan** menambal dengan pengecekan "sudah ada atau belum" di kode aplikasi — itu mengembalikan bug yang justru ingin dicegah.

---

## FASE 4 — Rekap, audit, dan koreksi

### Pekerjaan

1. `GET /api/events/:id/attendance` (paginasi + filter status + pencarian).
2. `GET /api/events/:id/summary` (agregat nyata: total, per status, per kategori).
3. `POST /api/attendance/:id/correction` dengan optimistic check.
4. `GET /api/events/:id/audit` + detail.
5. UI dashboard: kartu angka, grafik sederhana (tanpa library chart — pakai bar CSS), tabel kehadiran, dialog koreksi (wajib alasan), halaman audit.
6. Modul arsip audit (`domain/audit-retention.ts`) — desain, belum diaktifkan.

### Kriteria penerimaan (terukur)

- [ ] `authz.officer-cannot-correct`: officer → 403 **dan** ada baris audit `authz.denied`.
- [ ] `audit.correction-recorded`: `before`/`after` berisi status lama dan baru yang benar, plus `reason`.
- [ ] `audit.immutable`: `UPDATE`/`DELETE` lewat `env.DB` → error dari trigger.
- [ ] `409` saat dua koreksi bersamaan pada baris yang sama (tes paralel).
- [ ] Query rekap: `EXPLAIN QUERY PLAN` menunjukkan `SEARCH`; baris dibaca ≤ 1.000 untuk acara 20.000 peserta (dibuktikan dengan `meta.rows_read` pada tes).
- [ ] Dashboard 20.000 peserta: p95 respons API ≤ 300 ms (diukur lokal dengan data seed).
- [ ] Tidak ada endpoint `PATCH`/`DELETE` untuk audit di tabel router (dites: `404`).
- [ ] Semua aksi mutasi tercatat di audit — tes iterasi: setiap endpoint mutasi menghasilkan ≥ 1 baris audit.

---

## FASE 5 — Sinkronisasi Google Sheets (outbox)

### Pekerjaan

1. `migrations/0003_sync.sql`.
2. `integrations/sheets/`: `SheetsClient` interface (`getAccessToken`, `batchUpdateValues`, `ensureTab`, `getHeader`), implementasi nyata + fake untuk tes.
3. Pembuatan JWT service account (`crypto.subtle` RS256) + penukaran token + cache di memori modul.
4. Penulisan `outbox` disisipkan ke batch scan/koreksi (mengubah Fase 3 & 4 — perubahan ini memang direncanakan).
5. Cron `scheduled()`: sync, reklaim item macet, housekeeping.
6. Endpoint sync: `GET`, `PUT`, `test`, `full`, `run`, `outbox`, `retry`.
7. UI: halaman konfigurasi sync (menampilkan email service account), status antrean, tombol full resync.

### Kriteria penerimaan (terukur)

- [ ] `outbox.coalesce`: 5 koreksi berturut-turut → `COUNT(*) = 1` di outbox.
- [ ] `outbox.retry-backoff`: delay mengikuti `min(2^n × 30s, 30m)` ± jitter (fake clock).
- [ ] `outbox.dead-after-max`: 8 kegagalan → `dead`.
- [ ] `outbox.permanent-error`: fake client mengembalikan 404 → langsung `dead`, **bukan** 8 percobaan.
- [ ] `sync.full-resync`: 1.000 peserta → payload `batchUpdate` terkirim dalam chunk ≤ 500 baris, `sheet_rows` konsisten (tidak ada `row_index` duplikat).
- [ ] Cron dengan fake client: 5 item → 1 panggilan `batchUpdate`, 0 panggilan per item (membuktikan batching).
- [ ] Cron tidak melempar error saat D1 mengembalikan error (tes: DB stub yang gagal).
- [ ] Tidak ada panggilan jaringan nyata di seluruh suite tes (`grep` tidak menemukan `googleapis.com` di luar `integrations/sheets/`).
- [ ] Uji manual di staging: sheet sungguhan menerima 100 baris; koreksi satu absensi mengubah **satu sel** dan tidak menambah baris.
- [ ] Pemakaian Sheets ≤ 60 tulis/menit: dengan 5 item/5 menit, terpakai < 1%.

---

## FASE 6 — Hardening, observability, dan deploy

### Pekerjaan

1. Rate limit seluruh endpoint sesuai tabel `DESAIN_API.md` §10.
2. Header keamanan: `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Content-Security-Policy` (tanpa `unsafe-eval`).
3. `/api/health/ready` + `/api/admin/usage`.
4. Prosedur arsip audit (`docs/OPERASIONAL.md`) + ambang peringatan ukuran DB.
5. `docs/OPERASIONAL.md`: break-glass superadmin, rotasi secret, pemulihan dari snapshot, prosedur event day.
6. Ekstrak ADR 001–005 ke `docs/adr/`.
7. Deploy produksi: `wrangler deploy`, `wrangler d1 migrations apply --remote`, smoke test.
8. Opsional (hanya bila disetujui): E2E Playwright untuk 3 alur kritis.

### Kriteria penerimaan (terukur)

- [ ] Semua header keamanan terverifikasi dengan `curl -I` pada produksi.
- [ ] CSP tidak memblokir kamera, font, atau script aplikasi (diverifikasi di DevTools tanpa error console).
- [ ] `/api/health/ready` mengembalikan 200 saat D1 sehat; 503 saat D1 disimulasikan gagal.
- [ ] Smoke test produksi: buat acara → undang petugas → import 100 peserta → scan 100 QR → rekap menunjukkan 100 → sheet menerima 100 baris.
- [ ] `docs/OPERASIONAL.md` memuat prosedur break-glass yang **sudah diuji sekali** di staging.
- [ ] `AGENTS.md` diperbarui: `@cloudflare/vitest-plugin`, keputusan ADR-002 (passwordless), status fase.
- [ ] Backup: satu snapshot `wrangler d1 export` tersimpan di luar Cloudflare sebelum migrasi remote pertama.

---

## Urutan ketergantungan (mengapa tidak bisa diacak)

```
Fase 0 (ukur platform)
   └─> Fase 1 (user & acara)         ← butuh sesi untuk semua endpoint lain
        └─> Fase 2 (peserta & QR)    ← butuh acara untuk menempelkan peserta
             └─> Fase 3 (scan)       ← butuh QR + peserta + otorisasi
                  └─> Fase 4 (rekap) ← butuh data absensi nyata
                       └─> Fase 5 (sync) ← butuh absensi + audit untuk diproyeksikan
                            └─> Fase 6 (deploy)
```

Fase 5 **tidak** bisa dipindah ke awal karena outbox ditulis bersama mutasi absensi; memindahkannya berarti membangun ulang Fase 3 dan 4.

---

## Definisi "selesai" untuk setiap fase

Sebuah fase dinyatakan selesai hanya bila **semua** benar:

1. Semua kriteria penerimaan tercentang dengan bukti yang bisa dijalankan ulang (perintah + output).
2. `typecheck → lint → test → build` hijau di CI.
3. `docs/` diperbarui untuk perilaku yang berubah.
4. Tidak ada `TODO`/`FIXME` baru tanpa isu tertulis.
5. Tidak ada dependensi baru tanpa justifikasi satu baris.
6. Pemilik proyek menyetujui ringkasan fase.

---

## Hal yang menunggu keputusan sebelum Fase 0 dimulai

| # | Keputusan | Default yang diusulkan | Dampak bila diubah setelah Fase 0 |
|---|---|---|---|
| 1 | ADR-001 topologi: satu Worker same-origin | **Setuju** | Menambah CORS, cookie, dan pipeline deploy kedua |
| 2 | ADR-002 passwordless (mengganti aturan PBKDF2 di `AGENTS.md`) | **Setuju** | Auth harus ditulis ulang seluruhnya |
| 3 | ADR-003 QR opaque + HMAC di server | **Setuju** | Skema `participants` berubah |
| 4 | ADR-004 Sheets upsert, bukan append | **Setuju** | Tabel `sheet_rows` dan outbox berubah |
| 5 | Batas baris per import (nilai dari spike Fase 0) | 1.000 baris, diturunkan bila CPU > 5 ms | Kontrak API berubah |
| 6 | Nama domain / apakah memakai `*.workers.dev` | `*.workers.dev` untuk staging | Perubahan konfigurasi, bukan kode |
| 7 | Apakah `superadmin` boleh mengoreksi absensi | **Ya**, wajib beralasan | Matriks otorisasi berubah |

Tidak ada keputusan di atas yang bisa diambil sendiri oleh agent.

---

## Estimasi konsumsi free tier pada pemakaian realistis

Asumsi: 1 sekolah, 2 acara/bulan, 500 peserta/acara, 1.500 pemindaian/acara.

| Metrik (batas harian) | Pemakaian pada hari acara | % kuota |
|---|---|---|
| Workers request (100.000) | ~2.500 | 2,5% |
| D1 baris tulis (100.000) | ~14.000 | 14% |
| D1 baris baca (5.000.000) | ~50.000 | 1% |
| Sheets tulis per menit (60) | ~1 | 1,7% |
| Storage (500 MB) | ~10 MB | 2% |

Kesimpulan: **pemakaian normal menggunakan < 15% kuota harian yang paling ketat** (baris tulis D1). Lonjakan hanya terjadi pada import besar atau banyak acara di hari yang sama (`COSTS_AND_LIMITS.md` §3.3).
