# OPERASIONAL — Hasil pengukuran dan Catatan Lingkungan

Dokumen ini mencatat hasil pengukuran, instruksi operasi, status deployment, dan quirk lingkungan yang tidak terlihat dari kode.

> **Konteks (10 November 2026).** Semua pengukuran dan prosedur di sini berlaku untuk baseline (model `events` datar, commit acuan `157c330`) ditambah Q1 (Aktivitas/Sesi), Q2 (kategori, custom field, atribut peserta), Q3 (konfigurasi entitlement), Q4 (QR Identity per Tema), dan Q5 (transaksi Attendance berkonteks, Reversal/Adjustment) — semuanya API-only. Angka CPU/statement/baris **tidak** otomatis berlaku untuk tahap berikutnya dan harus diukur ulang di tahap terkait ([`IMPLEMENTATION_ROADMAP.md`](./IMPLEMENTATION_ROADMAP.md) Q6–Q11). Uji perangkat fisik scanner, akun Google Sheets nyata, dan CPU produksi belum pernah dilakukan (`REQUIREMENTS.md` §7.3). Rujukan "ADR-00N" di dokumen ini = `docs/adr/000N-*.md`.

## Status operasi saat ini (10 November 2026)

- Worker produksi berjalan di `https://qrcek.hamdirobbi5.workers.dev` dan di-deploy lewat
  **Cloudflare Workers Builds** (Git integration): push/merge ke `main` memicu build lalu
  `wrangler deploy` dari runner Cloudflare. Repo ini tidak memakai GitHub Actions. Migrasi D1
  tetap manual — lihat §10.
- Terverifikasi 8 November 2026 02:28 UTC pada URL produksi: `GET /api/health` → `200`,
  `GET /api/health/ready` → `200` (`database: ok`), dan security headers
  (`content-security-policy`, `permissions-policy: camera=(self)`, HSTS) ada. Route Q2
  `GET /api/events/x/categories` dan `/custom-fields` → `401 UNAUTHENTICATED` (route ada,
  sesi belum dikirim), bukan `404`.
- Migrasi remote `0001`–`0010` sudah diterapkan. `0007_q1_activities_sessions.sql`
  diterapkan **6 November 2026** (backup: `/tmp/opencode/qrcek-backup-2026-11-06.sql`,
  122 KB). `0008_q2_categories_custom_fields.sql` diterapkan **8 November 2026 02:28 UTC**
  dari `apps/api`; `app_meta.schema_version = 8`.
- Verifikasi data pasca-`0008`: 80 peserta, 32 kategori, **0** peserta tanpa `category_id`,
  **0** kategori orphan, **0** peserta dengan kategori lintas Tema, **0** `attributes_json`
  invalid, dan 6 trigger `trg_participant_category_*` ada.
- `0009_entitlement_rules.sql` (Q3) **sudah diterapkan di remote** pada 8 November 2026
  (deploy `dc8b8546` lewat Workers Builds pukul 04:26 UTC; sukses). Migrasi diuji di database
  lokal kosong (`schema_version = 9`, lima `uq_ent_*` ada, backfill 0 baris), backfill diukur
  pada fixture representatif: **40 baris**, dan di produksi berkemungkinan **0 baris** (tabel
  `activities` di produksi kosong). Verifikasi pasca-apply: `app_meta.schema_version = 9`,
  tabel + 5 partial unique index + 2 trigger konteks ada, backfill menghasilkan 0 baris.
  Lihat §6.1.
- Backup pra-`0008` **gagal** karena auth token Wrangler kedaluwarsa saat `d1 export`.
  Pemulihan pada jendela itu bergantung pada Time Travel D1 (7 hari). Export pasca-migrasi
  berhasil: `/tmp/opencode/qrcek-backup-2026-11-08-post-0008.sql` (144 KB). Untuk rilis
  berikutnya, pastikan `npx wrangler whoami` dan export sukses sebelum apply.
- Deploy: merge PR #1 (`2a0eeba`) memicu Workers Builds `Workers Builds: qrcek` (success
  02:14 UTC). Deploy manual Q2 dari `main` pukul 02:27 UTC menghasilkan Version ID
  `944951fe-3030-41fb-b55a-34d97a736b6c`. Deploy Q3 (`51103e8`) lewat Workers Builds sukses
  04:26:11 UTC, Version ID `dc8b8546-9a40-46f9-96af-e047987b553e`; `GET /api/health/ready`
  → `200 (database: ok)`.
- **Catatan jendela campuran:** build Workers Builds selesai 02:14, migrasi `0008` baru
  02:28, jadi sekitar 14 menit kode Q2 live di atas skema `0007`. Endpoint peserta yang
  membaca `category_id` tidak kompatibel pada jendela itu; tidak ada bukti kerusakan data
  (verifikasi di atas bersih). Rilis berikutnya yang mengubah kontrak harus memakai pola
  expand/contract atau mematikan auto-deploy sementara agar jendela itu tidak terulang.
- **Rilis Q4 (9 November 2026):** commit `ad02903` memicu Workers Builds dan berstatus
  **success**. Migrasi `0010_qr_identities.sql` diterapkan ke remote pada 02:34 UTC dengan
  backup pra-migrasi `/tmp/opencode/qrcek-backup-2026-11-09-pre-0010.sql` (149 KB). Verifikasi
  remote: `app_meta.schema_version = 10`, `qr_identities = 60` baris (kandidat legacy 60 dari
  80 peserta), 2 index unik + 2 trigger konteks, `mismatched = 0`, dan
  `GET /api/health/ready` → `200`. Route `GET .../qr` dan `PUT .../qr/rotate` → `401`
  (terdaftar, sesi belum dikirim). Smoke dengan sesi produksi belum dijalankan pemilik.
- **Tindak lanjut review keamanan (9 November 2026):** commit `148685e` di-push ke `main` dan
  Workers Builds **success** (versi `dedce6fc-dc96-4fcd-9a00-78d34299720b`, 03:22 UTC).
  Verifikasi ulang: `GET /api/health/ready` → `200`; `GET .../qr`, `PUT .../qr/rotate`, dan
  `POST .../qr-labels` tanpa sesi → `401` (route terdaftar); remote tetap `schema_version = 10`,
  `qr_identities = 60`, `mismatched = 0`. Perbaikan yang ikut rilis: mirror kredensial rotasi
  ke `participants.qr_*`, urutan rilis migrasi-dulu, `expectedRotationCount`, audit
  `wrong_event` tanpa ID lintas Tema, dan batas label 38.
- **Q5 (12 November 2026): migrasi `0011` sudah diterapkan di remote.** Backup pra-migrasi
  `/tmp/opencode/qrcek-backup-2026-11-12-pre-0011.sql` (187 KB). Hasil: `schema_version = 11`,
  **12** Aktivitas Attendance default, **26** transaksi hasil salinan 26 `attendance`, **5**
  penugasan Petugas, **32** aturan entitlement, 13 index baru, 5 trigger baru, dan **0**
  transaksi lintas Tema. Kode Q5 belum di-push/deploy; Workers Builds akan men-deploy setelah
  push pemilik. Gate Q5 masih menunggu smoke produksi dengan sesi nyata (§6.4).
- Pendaftaran mandiri publik sudah dihapus (ADR-0013). `POST /api/auth/register` → 404, dan
  tidak ada lagi `TURNSTILE_SECRET_KEY` maupun `VITE_TURNSTILE_SITE_KEY` yang perlu diatur.
  Akun Admin Acara hanya dibuat lewat undangan Super Admin. Saat deploy pertama setelah
  perubahan ini, hapus secret lama dengan `npx wrangler secret delete TURNSTILE_SECRET_KEY`
  dari `apps/api` (tidak wajib untuk runtime, tetapi menghindari secret menganggur).
- Browser terbaru mengarahkan request daftar acara ke `/api/calendar` untuk menghindari pemblokiran content blocker yang terlihat pada `/api/events` (Network menampilkan “Blocked By uBlock Origin”). Sejak Q1 tersedia pula alias eksplisit `/api/themes`. Keduanya ikut ter-deploy bersama kode Worker, jadi statusnya mengikuti commit yang live.

Lingkungan pengukuran:

| Komponen | Versi |
|---|---|
| Node | 26.8.1 |
| npm | 11.19.0 |
| Wrangler | 4.156.0 |
| workerd | 1.20261023.1 |
| Vitest | 5.0.5 |
| TypeScript | 6.0.3 |
| OS | Linux (lokal, bukan Cloudflare) |

Tanggal pengukuran: 30 Oktober 2026.

---

## 1. Ringkasan status spike

| # | Item | Status | Kesimpulan |
|---|---|---|---|
| 1 | Atomisitas `db.batch()` | ✅ **terverifikasi** | Batch bersifat atomik: statement ke-2 yang gagal me-rollback statement ke-1 |
| 2 | `RETURNING` pada `INSERT ... ON CONFLICT` | ✅ **terverifikasi** | Didukung, termasuk di dalam `db.batch()` |
| 3 | Partial unique index | ✅ **terverifikasi** | Didukung dan ditegakkan |
| 4 | `EXPLAIN QUERY PLAN` query panas | ✅ **terverifikasi** | 10/10 query memakai `SEARCH ... USING INDEX` |
| 5 | Migrasi D1 pada database kosong | ✅ **terverifikasi** | Migrasi `0001`–`0011`; auth, peserta, QR, attendance, sync, self-signup, activities/activity_sessions, entitlement, qr_identities, transactions/koreksi/penugasan |
| 6 | `Set-Cookie` lewat Static Assets | ✅ **terverifikasi pada penggunaan** | Auth/session produksi bekerja dengan cookie |
| 7 | CPU p95 ≤ 5 ms | ⚠️ **hanya proksi** | Wall-clock lokal terukur; CPU platform butuh `wrangler tail` pada Worker ter-deploy |

---

## 2. Angka pengukuran (item 7)

Diukur dengan `npm run bench` di `workerd` lokal. **Ini wall-clock, bukan CPU platform.** Resolusi `performance.now()` di workerd adalah 1 ms, sehingga pengukuran per-operasi dibulatkan; karena itu HMAC diukur secara batch.

Dua run pada mesin yang sama (jeda satu hari) — perhatikan selisihnya, inilah alasan angka ini tidak boleh dipakai sebagai gerbang:

| Skenario | Run 1 (30 Okt) | Run 2 (31 Okt) |
|---|---|---|
| HMAC-SHA256 throughput | 1000 ops / 54,0 ms → 0,054 ms/op | 1000 ops / 24,0 ms → 0,024 ms/op |
| Scan proxy (HMAC + indexed SELECT + batch 2 statement) | p50 7 ms · p95 11 ms · max 14 ms | p50 3 ms · p95 5 ms · max 6 ms |
| Import proxy 500 baris | 180 ms → 0,36 ms/baris | 82 ms → 0,16 ms/baris |
| Import proxy 1.000 baris | 354 ms → 0,35 ms/baris | 149 ms → 0,15 ms/baris |
| Import proxy 2.000 baris | 601 ms → 0,30 ms/baris | 301 ms → 0,15 ms/baris |

Selisih sampai ~2,5× antar-run pada mesin yang sama menunjukkan angka ini didominasi keadaan host (cache, I/O, beban), bukan sifat kode. **Jangan pakai selisih ini untuk menyimpulkan perbaikan atau regresi.**

### Cara membacanya (penting)

- Angka scan proxy **tidak boleh** dibandingkan langsung dengan batas 10 ms CPU. Angka itu didominasi waktu tunggu I/O D1 lokal (tulis ke disk), dan **waktu tunggu I/O tidak dihitung sebagai CPU** oleh Cloudflare. Komponen CPU yang sebenarnya — HMAC + serialisasi JSON — hanya ~0,02–0,05 ms per operasi.
- Angka import proxy juga wall-clock. Yang CPU-nya adalah 1.000 HMAC (±24–54 ms) + parsing; sisanya I/O D1.
- **Kesimpulan yang sah**: tidak ada indikasi biaya CPU tinggi dari operasi kripto. **Kesimpulan yang tidak sah**: "gerbang 5 ms lulus". Gerbang itu belum diuji.

### Cara memverifikasi gerbang CPU (butuh akun Cloudflare)

```bash
# 1. verifikasi lokal lalu push/merge ke main (Workers Builds men-deploy otomatis)
npm run typecheck && npm run lint && npm run test && npm run build
git push origin main

# 2. ukur CPU per request (kolom cpuTime)
npx wrangler tail --format json > /tmp/tail.jsonl

# 3. jalankan beban dari terminal lain
for i in $(seq 1 200); do curl -s https://<worker>/api/health > /dev/null; done
```

Ambil `cpuTime` dari 200 invokasi, hitung p95. Lulus bila ≤ 5 ms (margin 2× terhadap batas 10 ms).

---

## 3. Keputusan yang diambil dari spike

| Keputusan | Dasar |
|---|---|
| Rate limit memakai `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` | Item 2 terverifikasi; tidak perlu `SELECT` kedua |
| Absensi + outbox + audit ditulis dalam satu `db.batch()` | Item 1 terverifikasi atomik |
| Upsert outbox **wajib** menyertakan predikat partial index | Item 3 menemukan batasan SQLite |
| Query panas sudah memakai indeks sebagaimana dirancang | Item 4 |
| Batas import sementara: **1.000 baris/request** | Item 7 belum final; nilai ini konservatif dan dapat dinaikkan setelah pengukuran platform |

---

## 4. Temuan yang mengubah desain

### 4.1 `ON CONFLICT` tidak mengenali partial unique index tanpa predikat

`docs/DESAIN_DATABASE.md` §6 awalnya menulis:

```sql
ON CONFLICT (event_id, participant_id) DO UPDATE SET ...
```

SQLite menolak ini pada tabel `outbox` yang unique index-nya parsial
(`WHERE status IN ('pending','inflight','failed')`):

```
ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint
```

Bentuk yang benar mengulang predikat indeks:

```sql
ON CONFLICT (event_id, participant_id) WHERE status IN ('pending','inflight','failed')
DO UPDATE SET ...
```

Kedua perilaku ini dikunci oleh tes: `spike.index.test.ts` (tes positif dan negatif).
Dokumen desain database sudah diperbarui.

> Sejak skema dipangkas jadi minimal (lihat §4.3), tes itu memakai tabel sekali-pakai
> `spike_outbox` dengan bentuk dan indeks yang sama, bukan tabel `outbox` sungguhan.
> SQL yang diuji identik, jadi temuan tetap berlaku saat `outbox` dibuat di Fase 5.

### 4.2 `db.exec()` tidak bisa dipakai untuk file migrasi multi-baris

`db.exec(sql)` memecah SQL berdasarkan baris, sehingga `CREATE TABLE` multi-baris
gagal dengan `SQL code did not contain a statement`. Karena itu tes memakai
`applyD1Migrations()` dari `cloudflare:test` dengan hasil `readD1Migrations()`
dari `@cloudflare/vitest-plugin` — jalur yang sama dengan wrangler.

---

## 5. Dev loop lokal (terverifikasi)

```bash
npm run dev:api     # http://127.0.0.1:8787
npm run dev:web     # http://127.0.0.1:5173, proxy /api -> :8787
```

Hasil verifikasi nyata:

| Cek | Hasil |
|---|---|
| `GET :8787/api/health` | `{"ok":true,"data":{"service":"absensi-api","version":"v1","status":"ok","timestamp":...}}` |
| `GET :5173/api/health` (lewat proxy Vite) | Respons identik — same-origin seperti produksi |
| `GET :8787/api/nope` | `404` + `{"ok":false,"error":{"code":"NOT_FOUND",...}}` |
| `GET :8787/` | `200` + `index.html` SPA |
| `GET :8787/aktivasi` (deep link) | `200` + `index.html` → `not_found_handling: "single-page-application"` bekerja |
| `POST :5173/api/auth/activate` (lewat proxy, `Origin: http://localhost:5173`) | `200` + `Set-Cookie: absensi_session=…; HttpOnly; SameSite=Lax` — CSRF cocok karena proxy meneruskan `Host` asli |
| `POST :8787/api/auth/logout` tanpa `X-Absensi-Csrf` | `403 CSRF_FAILED` |
| `POST :8787/api/auth/logout` dengan `Origin` berbeda | `403 CSRF_FAILED` |
| `GET :5173/` | `200` + `index.html` |

### Quirk yang akan mengganggu agent berikutnya

1. **Vite mengikat ke `localhost` (IPv6) saja.** `curl http://127.0.0.1:5173` gagal.
   Gunakan `http://localhost:5173` atau jalankan dengan `--host 127.0.0.1`.
2. **npm 11.19 memblokir postinstall `esbuild` dan `workerd`.** Tanpa persetujuan,
   biner tidak terunduh dan tes gagal dengan error aneh. Persetujuan disimpan di
   `package.json` → `allowScripts`. Jika `npm install-scripts ls` melaporkan paket
   baru, jalankan `npm install-scripts approve <pkg>` dan commit perubahannya.
3. **`wrangler dev` butuh `apps/web/dist` ada** karena `assets.directory` menunjuk
   ke sana. Jalankan `npm run build` (atau `npm run build -w @absensi/web`) dulu.
   Tes tidak terpengaruh: tes memakai `wrangler.test.jsonc` tanpa `assets`.
4. **`db.exec()` tidak bisa untuk DDL multi-baris.** Muncul lagi saat menulis tes
   spike: `CREATE TABLE` dengan baris baru gagal dengan `incomplete input`.
   Pakai `db.prepare(sql).run()` (§4.2).

---

## 4.3 Riwayat pemangkasan skema awal (31 Okt)

Keputusan pemilik proyek: Fase 0 **tidak** memuat tabel bisnis. `AGENTS.md` poin 5
aslinya meminta "skema penuh", tetapi itu bertabrakan dengan aturan roadmap
("jangan implementasi fitur sebelum fase-nya dibuka") — tabel `outbox` untuk Fase 5
sudah ada sejak Fase 0.

Yang berubah:

| Sebelum | Sesudah |
|---|---|
| `0001_init.sql`, `0002_auth.sql`, `0003_sync.sql` | satu file `0001_init.sql` |
| 15 tabel + 2 trigger | 1 tabel: `app_meta` |
| 4 tes bergantung pada tabel bisnis | tes memakai tabel sekali-pakai berindeks sama |

> **Status sekarang:** migrasi `0002`–`0007` telah menambahkan skema auth, peserta, QR,
> kehadiran, audit, dan sinkronisasi. Tabel `attendance`, `audit_log`, dan `outbox` bukan lagi
> cakupan tertunda; referensi di atas merekam keputusan historis pada awal proyek.

`app_meta` (key/value + `updated_at`) dipilih supaya pipeline migrasi punya sesuatu
yang nyata untuk diterapkan, dan supaya migrasi fase berikutnya punya jangkar versi.

Konsekuensi yang disengaja:

- Tes integrasi saat ini menerapkan seluruh migrasi yang sudah dibuka. Daftar skema aktual
  harus diselaraskan dengan file `migrations/`, bukan dengan penjaga fase awal.
- Temuan spike tetap sah karena diuji pada tabel sekali-pakai dengan bentuk dan
  indeks yang identik; yang berubah hanya nama tabelnya.
- `docs/DESAIN_DATABASE.md` §3 dan file migrasi mendokumentasikan skema yang telah diterapkan.

---

## 6. Migrasi lokal (terverifikasi)

```bash
npm run db:reset:local    # hapus apps/api/.wrangler/state
npm run db:migrate:local  # terapkan semua migrasi yang belum diterapkan (0001–0011)
npm run db:migrate:local  # "✅ No migrations to apply!" (idempoten)
```

Riwayat awal per Tahap 3: 3 migrasi, 10 tabel aplikasi. Skema saat ini sudah berkembang
melalui migrasi `0004`–`0007`.

| Migrasi | Tabel |
|---|---|
| `0001_init.sql` | `app_meta` |
| `0002_auth.sql` | `users`, `events`, `event_memberships`, `device_credentials`, `sessions`, `invites`, `recovery_codes`, `rate_limits` |
| `0003_participants.sql` | `participants` (+ unique partial index `(event_id, external_ref)`) |
| `0004_qr.sql` | kolom QR peserta, `event_label_config`, `audit_log` |
| `0005_attendance_sync.sql` | `attendance`, `sync_state`, `sheet_rows`, `outbox` |
| `0006_self_signup.sql` | metadata jalur pembuatan akun |
| `0007_q1_activities_sessions.sql` | `activities`, `activity_sessions`, indeks Q1 |
| `0008_q2_categories_custom_fields.sql` | `categories`, `custom_fields`, `participants.category_id` + `attributes_json`, trigger kategori |
| `0009_entitlement_rules.sql` | `entitlement_rules`, 5 partial unique index, 2 trigger konteks, backfill Aktivitas aktif |
| `0010_qr_identities.sql` | `qr_identities`, 2 unique index, 2 trigger konteks, backfill kredensial legacy |
| `0011_q5_transactions.sql` | `transactions`, `transaction_corrections`, `staff_assignments`, 4 partial unique index transaksi, trigger konteks/lifecycle, Aktivitas default + backfill entitlement/penugasan/attendance |

> `participants` kini memiliki kolom kredensial QR dari `0004_qr.sql`. Migrasi yang sudah
> diterapkan tidak boleh diedit.

```bash
# bukti dari database lokal
npx wrangler d1 execute absensi-db --local \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
```

### 6.1 Pengukuran Q3 — entitlement

Diukur 8 November 2026 di `workerd` lokal (D1 uji) dan pada database SQLite salinan
(`/tmp/opencode/q3-measure.sqlite`). Bukan CPU produksi; lihat peringatan §2.

| Metrik | Hasil | Cara |
|---|---|---|
| Query resolver | **1 statement**, paling banyak **5 baris** | `listRulesForContext`; tes "returns at most five rows" |
| Query plan resolver | **5/5** cabang `SEARCH ... USING INDEX` dengan Sesi; **3/3** tanpa Sesi; **0** `SCAN` | `EXPLAIN QUERY PLAN` di `entitlements.db.test.ts` |
| Backfill `0009` pada DB lokal kosong | **0 baris** | `npm run db:reset:local && npm run db:migrate:local` |
| Backfill `0009` pada fixture representatif | **40 baris** (Tema e1: a1 = 16, a2 = 16; Tema e2: b1 = 8) | SQLite salinan `0001`–`0008` + seed, lalu `0009`; `schema_version = 9` |
| Statement batch kategori | 1 baris = 2 (upsert + audit); 15 baris = 30 + 1 kelengkapan + ±4 pembacaan konteks | Anggaran **50 statement/invokasi** D1; karena itu batas 15 |
| Statement Theme default / override individual | 2 (mutasi + audit) + 2–4 pembacaan | Satu `db.batch()` per mutasi |

Angka backfill produksi **sudah diukur setelah apply**: **0 baris** (query `COUNT(*)` kandidat
dengan predikat backfill sebelum apply → **0**; tabel `activities` di produksi kosong, jadi
tidak ada baris backfill yang dihasilkan). Batas 100.000 baris tulis/hari tidak terlampaui;
bila di masa depan Aktivitas aktif mulai dipakai dalam jumlah besar, hitung ulang dan pecah
per Tema bila kandidat >10.000 baris.

### 6.2 Pengukuran Q4 — QR Identity

Diukur 9 November 2026 di `workerd` lokal (D1 uji). Bukan CPU produksi; lihat peringatan §2.

| Metrik | Hasil | Cara |
|---|---|---|
| Lookup scan | **1** `SEARCH ... USING INDEX` pada `uq_qr_identity_hash` + join primary-key ke `participants` dengan `p.event_id = q.theme_id` | `EXPLAIN QUERY PLAN` di `qr-identity.db.test.ts` |
| Statement halaman label 38 peserta (terbit) | **47** dari batas 50/invokasi | `qr-labels.statements.test.ts` menghitung `prepare()` pada env yang di-proxy |
| Statement halaman label 38 peserta (reprint) | **8** | sama; tidak ada insert/audit terbit |
| Statement halaman label 38 peserta (lost-race) | **48** | tes yang menyuntikkan pemenang konkuren setelah SELECT |
| Waktu halaman label 38 (lokal) | terbit **45 ms**, reprint p50 **19 ms**, p95 **21 ms** | `spike.qr-labels.measure.test.ts` |
| Crypto 100 kredensial (lokal) | issue p50 **7 ms** / p95 8 ms; read p50 4 ms | sama |
| Scan proxy (HMAC + lookup + batch) | p50 **4 ms**, p95 7 ms, max 12 ms | `spike.measure.test.ts` |
| Backfill `0010` pada DB lokal kosong | **0 baris** | `npm run db:reset:local && npm run db:migrate:local` |

Karena halaman 38 label memakai 47 statement dan jalur lost-race menambah satu baca ulang
menjadi 48, `QR_LABEL_BATCH_MAX` diturunkan dari 50 ke **38**. Menaikkannya tanpa mengubah
strategi audit (satu baris per request) akan menyentuh batas 50. Angka backfill produksi
dihitung dengan SQL di §6.3 **sebelum** apply remote dan dicatat di §8: **60 kandidat, 60
baris**.

### 6.3 Prosedur rilis `0010` (Q4) — sudah dijalankan

**Urutan wajib untuk rilis yang menambah tabel yang langsung dibaca kode baru: migrasi
dulu, deploy kemudian.** Workers Builds otomatis men-deploy setiap push ke `main`, jadi
migrasi harus selesai sebelum push (atau auto-deploy dimatikan sementara). Kode lama tidak
membaca `qr_identities`, sehingga migrasi additive aman lebih dulu. Urutan yang sempat
ditulis di draf Q4 (deploy lalu migrasi) akan membuat scan/label/rotasi `500` selama jendela
antara deploy dan migrasi.

**Langkah eksplisit bila tidak ingin bergantung pada timing build:** sebelum push, buka
Cloudflare Dashboard → Worker `qrcek` → Settings → Builds, dan **matikan automatic
deployment** (atau putuskan Git integration) sampai migrasi selesai. Setelah migrasi dan
verifikasi, push kode lalu nyalakan kembali auto-deploy. Jangan mengandalkan "kebetulan
build masih berjalan" seperti pada rilis `0010`.

1. Backup remote: `npx wrangler d1 export absensi-db --remote --output /tmp/opencode/qrcek-backup-$(date -u +%Y-%m-%d)-pre-0010.sql`.
2. Hitung kandidat backfill:
   `SELECT COUNT(*) FROM participants WHERE qr_token_hash IS NOT NULL AND qr_token_ciphertext IS NOT NULL AND qr_token_nonce IS NOT NULL AND qr_key_version IS NOT NULL AND qr_issued_at IS NOT NULL`.
   Catat angkanya.
3. Setelah konfirmasi eksplisit pemilik: `npm run db:migrate:remote`.
4. Baru push/merge kode ke `main` (atau biarkan build yang sudah berjalan selesai setelah
   migrasi). Jangan membalik langkah 3 dan 4.
5. Verifikasi: `app_meta.schema_version = 10`, tabel `qr_identities`, dua index, dua trigger
   ada, jumlah baris = kandidat, `GET /api/health/ready` → 200.
6. Smoke di Tema uji dengan sesi produksi: cetak label, scan, rotasi, scan token lama
   (`not_found`), audit `qr.identity_rotated` tanpa token.
7. **Jangan** menghapus `participants.qr_*` pada rilis ini; itu migrasi contract terpisah.

**Yang benar-benar terjadi pada 9 November 2026:**

- Backup: `/tmp/opencode/qrcek-backup-2026-11-09-pre-0010.sql` (149 KB).
- Kandidat: **60** (dari 80 peserta).
- Commit `ad02903` di-push dan Workers Builds berstatus **success**. Migrasi `0010` diterapkan
  ke remote saat build masih berjalan (02:34 UTC), sehingga deploy baru mendarat di atas
  skema `10`.
- Hasil: `schema_version = 10`, `qr_identities = 60`, 2 index unik + 2 trigger, `mismatched = 0`.
- **Follow-up review keamanan:** commit `148685e` (versi `dedce6fc`) mendarat 03:22 UTC;
  health `200`, route QR tanpa sesi `401`, dan query remote di atas diulang dengan hasil
  identik (`mismatched = 0`).
- **Belum dijalankan:** smoke dengan sesi produksi (cetak → scan → rotasi → token lama
  ditolak). Butuh kredensial pemilik; dicatat di §8.

### 6.4 Pengukuran dan prosedur rilis Q5 (`0011`)

Diukur 10 November 2026 di `workerd` lokal (D1 uji). Bukan CPU produksi; lihat §2.

| Metrik | Hasil | Cara |
|---|---|---|
| Statement scan sukses | **15** dari batas 50 | `transactions.statements.test.ts` menghitung `prepare()` pada env yang di-proxy |
| Statement Reversal | **11** | sama |
| Statement Manual Entry | **13** | sama |
| Statement Adjustment | **12** | sama |
| Scan paralel | **50** request, tepat satu `SUCCESS` sisanya `DUPLICATE` | `scan.test.ts`; constraint parsial, bukan cek baca-lalu-tulis |
| Backfill `0011` pada DB lokal kosong | **0 baris** | `npm run db:reset:local && npm run db:migrate:local` |
| Backfill `0011` pada fixture representatif | **Belum diukur sebagai backfill**; tes membuat Aktivitas, entitlement, dan penugasan secara eksplisit | `scan.test.ts`, `transactions.db.test.ts` |

`0011` **sudah diterapkan di remote pada 12 November 2026**. Backfill membuat **satu
Aktivitas Attendance `Absensi`** untuk setiap Tema yang belum punya (**12** Tema), menyalin
aturan entitlement dari pola `0009` (**32** baris), memberi setiap Petugas aktif penugasan pada
Aktivitas Attendance aktif (**5** baris, `can_manual_check_in = 0`), lalu menyalin setiap baris
`attendance` ke `transactions` dengan `id` yang sama (**26** baris). Verifikasi lintas Tema: 0.

**Yang benar-benar terjadi pada 12 November 2026:**

- Backup: `/tmp/opencode/qrcek-backup-2026-11-12-pre-0011.sql` (187 KB).
- Kandidat sebelum apply: `schema_version = 10`, 12 Tema, 26 `attendance`, 0 Aktivitas,
  80 peserta, 12 Tema tanpa Aktivitas Attendance.
- Apply remote: `0011_q5_transactions.sql` → ✅, 27 command, `schema_version = 11`.
- Hasil: 12 Aktivitas, 26 transaksi, 26 `attendance` (tetap), 0 koreksi, 5 penugasan,
  32 aturan entitlement, 13 index baru, 5 trigger baru.
- **Belum dijalankan:** push/deploy kode Q5 dan smoke dengan sesi produksi. Keduanya dicatat
  di §8.

**Urutan rilis wajib: migrasi dulu, deploy kemudian.** Kode Q5 menulis ke `transactions`;
deploy sebelum `0011` membuat setiap scan gagal karena tabel belum ada. Ini sama seperti
§6.3, tetapi lebih ketat: `attendance` tidak lagi ditulis, jadi tidak ada fallback.

1. Backup remote:
   `npx wrangler d1 export absensi-db --remote --output /tmp/opencode/qrcek-backup-$(date -u +%Y-%m-%d)-pre-0011.sql`.
2. Hitung kandidat sebelum apply:
   `SELECT COUNT(*) FROM events;`
   `SELECT COUNT(*) FROM attendance;`
   `SELECT COUNT(*) FROM events e WHERE NOT EXISTS (SELECT 1 FROM activities a WHERE a.theme_id = e.id AND a.transaction_type = 'attendance');`
3. Setelah konfirmasi eksplisit pemilik: `npm run db:migrate:remote`.
4. Verifikasi: `app_meta.schema_version = 11`; tabel `transactions`, `transaction_corrections`,
   `staff_assignments` ada; empat `uq_tx_*`, `uq_txc_reversal`, dan `uq_assignment_*` ada;
   trigger `trg_transaction_context_insert`, `trg_transaction_corrections_no_*`, dan
   `trg_staff_assignment_context_*` ada; `COUNT(transactions) = COUNT(attendance)` untuk baris
   historis; setiap Tema punya Aktivitas Attendance.
5. Baru deploy/push kode Q5.
6. Smoke dengan sesi produksi: scan Petugas pada Aktivitas default, scan kedua → `DUPLICATE`,
   Reversal oleh Admin, Adjustment, dan Manual Entry hanya bila `allow_manual = 1` serta
   penugasan `can_manual_check_in = 1` (Q6 belum menyediakan UI untuk mengaktifkannya).

Quirk yang akan mengganggu:

- **Trigger dibuat setelah backfill.** Baris `attendance` historis boleh memiliki
  `recorded_by = NULL` dan Tema yang kini `closed`; trigger lifecycle hanya berlaku untuk
  transaksi baru (`adjusts_transaction_id IS NULL`). Jangan memindahkan blok trigger ke atas
  backfill.
- **`transactions.adjusts_transaction_id` adalah self-FK.** Saat membersihkan data uji,
  null-kan kolom itu sebelum `DELETE FROM transactions`, atau truncate dengan urutan yang benar.
- **`transaction_corrections` append-only.** `apps/api/src/test/setup.ts` men-drop
  `trg_transaction_corrections_no_delete` sementara di sekitar pembersihan, lalu membuatnya
  kembali. Jangan melonggarkan trigger produksi untuk kenyamanan tes.
- **`attendance` tetap ada.** UNIQUE `(event_id, participant_id)` masih berlaku untuk tabel
  legacy, tetapi tidak ada jalur aplikasi yang menulisnya. Jangan memakai tabel itu untuk
  verifikasi Q5; hitung `transactions`.
- **`slot_no` belum divalidasi.** Kolom ada dan `CHECK type = 'consumption'` mewajibkannya,
  tetapi kuota konsumsi baru ditegakkan di Q7. Jangan menganggap `uq_tx_consumption_*` sebagai
  penegakan kuota; indeks itu hanya mencegah baris efektif ganda.

---

## 7. Autentikasi dan kredensial QR: secret, akun pertama, dan perilaku sesi (Tahap 2–4)

### 7.1 Secret

| Nama | Dipakai untuk | Cara memasang |
|---|---|---|
| `SESSION_PEPPER` | HMAC semua token: sesi, undangan, kode pemulihan, hash IP | lokal: `apps/api/.dev.vars`; produksi: `wrangler secret put SESSION_PEPPER` |

Aturan:

- **Jangan pernah** menaruh `SESSION_PEPPER` di `wrangler.jsonc` `vars` untuk produksi, di
  frontend, atau di commit. `wrangler.test.jsonc` memakai nilai khusus tes yang tidak
  dipakai di mana pun selain `vitest`.
- Mengganti pepper **mencabut semua sesi, undangan, dan kode pemulihan** sekaligus (semua
  hash lama tidak cocok lagi). Itu bukan bug; itulah tombol darurat jika pepper bocor.
- `ALLOWED_ORIGINS` (opsional, dipisah koma) hanya untuk kasus origin browser berbeda dari
  URL Worker. Produksi same-origin tidak memerlukannya.

```bash
# lokal
cp .dev.vars.example apps/api/.dev.vars   # isi SESSION_PEPPER
openssl rand -base64 32                   # nilai yang layak

# produksi (setelah `wrangler deploy`)
cd apps/api && npx wrangler secret put SESSION_PEPPER
```

### 7.2 Akun pertama (bootstrap superadmin)

```bash
npm run db:migrate:local
npm run seed:superadmin
# → URL aktivasi : http://localhost:5173/aktivasi#t=...
```

Skrip menulis satu baris `invites` (peran `superadmin`, tanpa acara, tanpa pembuat) dan
mencetak URL-nya. Token **hanya tampil di output itu**; yang tersimpan hanya HMAC.

Untuk remote, skrip menolak berjalan tanpa konfirmasi dan tanpa pepper produksi:

```bash
export SESSION_PEPPER='<secret produksi>'
npm run seed:superadmin -- --remote --yes
```

Opsi lain: `--expires-hours 24` (1–168), `--base-url https://absensi.example.com`, `--db <nama>`.

### 7.3 Perilaku sesi yang perlu diketahui saat operasional

| Hal | Nilai |
|---|---|
| Nama cookie | `absensi_session` |
| Atribut | `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` (+ `Secure` saat HTTPS) |
| Umur | 30 hari, tidak diperpanjang otomatis |
| Logout | mencabut baris sesi itu saja, bukan sesi lain |
| Pemulihan kode | mencabut **semua** sesi + kredensial user, lalu menerbitkan satu sesi baru |
| Cabut anggota | mencabut semua sesi user tersebut (global, bukan per acara) — konsekuensi sesi tidak terikat acara |
| `last_seen_at` | diperbarui maksimal setiap 5 menit, supaya GET tidak jadi write di setiap request |

### 7.4 Batas percobaan

| Bucket | Batas | Efek |
|---|---|---|
| `auth:activate:<ipHash>` | 10 / 15 menit | 429 + `Retry-After` |
| `auth:recover:<ipHash>` | 5 / 15 menit | 429 + `Retry-After` |

IP di-hash dengan `SESSION_PEPPER`, jadi tidak ada IP mentah di D1. Pembersihan baris
`rate_limits` lama dijalankan cron 5 menit (`runHousekeeping`): jendela yang berakhir lebih
dari 1 jam dihapus, maksimum 500 baris per siklus. Sesi yang `expires_at`-nya lewat juga
dihapus dengan batas yang sama.

### 7.5 Secret QR (Tahap 4)

| Nama | Dipakai untuk | Cara memasang |
|---|---|---|
| `QR_PEPPER` | `HMAC-SHA256(QR_PEPPER, token)` → `qr_token_hash`, kunci lookup saat scan | lokal: `apps/api/.dev.vars`; produksi: `wrangler secret put QR_PEPPER` |
| `QR_ENCRYPTION_KEY` | AES-256-GCM atas token, agar cetak ulang memakai QR yang sama | `wrangler secret put QR_ENCRYPTION_KEY` (nilai base64 dari 32 byte) |
| `QR_KEY_VERSION` | Generasi kunci enkripsi; boleh berupa `vars`/secret, default `1` | `wrangler secret put QR_KEY_VERSION` atau`vars` |

```bash
# Generate kunci AES-256 (base64, tepat 32 byte setelah decode)
openssl rand -base64 32

# Lokal: tambahkan ke apps/api/.dev.vars (gitignored)
QR_PEPPER="$(openssl rand -base64 32)"
QR_ENCRYPTION_KEY="$(openssl rand -base64 32)"
QR_KEY_VERSION="1"

# Produksi
cd apps/api
npx wrangler secret put QR_PEPPER
npx wrangler secret put QR_ENCRYPTION_KEY
npx wrangler secret put QR_KEY_VERSION
```

Aturan:

- **Tidak ada fallback plaintext.** Kalau `QR_PEPPER` kosong/terlalu pendek atau
  `QR_ENCRYPTION_KEY` hilang/bukan base64 32 byte, endpoint label mengembalikan
  `500 INTERNAL` dengan pesan "Periksa konfigurasi server". Itu perilaku yang benar.
- **Mengganti `QR_PEPPER` membatalkan semua QR yang sudah dicetak.** Hash lama tidak cocok
  lagi saat scan. Ini tombol darurat bila pepper bocor; setelahnya semua peserta harus
  dicetak ulang dengan kredensial baru.
- **Mengganti `QR_ENCRYPTION_KEY` tanpa rotasi membuat cetak ulang gagal keras** dengan pesan
  versi kunci tidak cocok. Jangan pernah "memperbaikinya" dengan kembali ke plaintext.
- `QR_KEY_VERSION` harus bilangan bulat ≥ 1. Nilai tidak valid adalah kesalahan konfigurasi,
  bukan default diam-diam.

#### Rotasi kunci enkripsi (tanpa membatalkan QR tercetak)

Tujuan: token dan `qr_token_hash` **tidak berubah**; hanya ciphertext, nonce, dan versi yang
diperbarui. QR yang sudah dicetak tetap sah.

1. Siapkan kunci baru: `NEW_KEY="$(openssl rand -base64 32)"`, `NEW_VERSION=<versi+1>`.
2. Jalankan skrip satu kali (Worker/Node dengan akses D1). **Runtime membaca
   `qr_identities`**, jadi tabel itu wajib diperbarui; `participants` hanya mirror untuk
   rollback dan baris legacy yang belum dipromosikan. Skrip harus:
   - memproses `qr_identities WHERE key_version = <versi lama>` per batch, memanggil
     `reencryptQrCredential(configLama, configBaru, row)`, lalu
     `UPDATE qr_identities SET ciphertext = ?, nonce = ?, key_version = ?
      WHERE id = ? AND key_version = ?` (guard versi lama);
   - untuk setiap identity yang punya mirror `participants.qr_token_hash IS NOT NULL`,
     menulis ciphertext/nonce/key_version yang **sama** ke `participants` dengan guard
     `qr_key_version = <versi lama>`;
   - untuk peserta legacy yang belum punya baris `qr_identities`, memproses
     `participants WHERE qr_token_hash IS NOT NULL AND qr_key_version = <versi lama>` dan
     memperbarui kolom legacy saja (promosi tetap terjadi saat label berikutnya dibaca).
   - `participants.qr_token_hash` **tidak berubah**; token, hash, dan QR tercetak tetap sama.
   Skrip harus berhenti pada error pertama; jangan pernah menulis plaintext.
3. Verifikasi tidak ada baris versi lama tersisa di **kedua** tabel:
   `SELECT COUNT(*) FROM qr_identities WHERE key_version = <versi lama>` dan
   `SELECT COUNT(*) FROM participants WHERE qr_token_hash IS NOT NULL AND qr_key_version = <versi lama>`.
   Keduanya harus `0` sebelum langkah berikutnya.
4. Pasang `QR_ENCRYPTION_KEY` baru dan `QR_KEY_VERSION` baru sebagai secret Worker.
5. Verifikasi: cetak ulang **dua** label — satu peserta yang kredensialnya berasal dari backfill
   legacy dan satu peserta yang diterbitkan setelah `0010` — QR harus identik dengan hasil
   sebelumnya, dan scan harus menemukan peserta yang sama. Jika hanya `participants` yang
   diperbarui, cetak ulang peserta `qr_identities` akan `500` (versi kunci tidak cocok).

Jangan membalik urutan langkah 2 dan 3: Worker dengan kunci baru tidak bisa mendekripsi baris
lama, dan itu akan terlihat sebagai `500` pada cetak ulang (bukan kerusakan data).

### 7.6 Mencetak dan mencetak ulang label QR

- Kredensial dibuat **saat label pertama dicetak**, bukan saat peserta dibuat/diimpor. Peserta
  yang belum pernah dicetak tidak punya baris `qr_identities` dan tidak bisa dipakai untuk scan.
  Kredensial lama pada `participants.qr_*` dipromosikan saat pertama dibaca tanpa mengganti token.
- **Cetak ulang tidak pernah merotasi token.** Halaman label memanggil endpoint yang sama;
  hasilnya `qr` identik. Kalau hasilnya berbeda, itu bug, bukan fitur.
- Dua admin yang mencetak bersamaan untuk peserta yang sama menghasilkan satu kredensial:
  `INSERT ... ON CONFLICT DO NOTHING` pada `uq_qr_identity_participant` menentukan pemenang,
  yang kalah membaca ulang baris pemenang.
- Batas satu request adalah **38 label**. Angka ini diturunkan dari 50 setelah `qr_identities`
  menambah satu insert per peserta: terukur 47 statement untuk 38 label, 48 pada jalur
  lost-race (batas D1 50/invokasi), sedangkan reprint hanya 8. Untuk acara besar, cetak per
  batch.
- Format: A4 3 × 8 (24 label/halaman, margin 8 mm) dan stiker 50 × 30 mm (satu label/halaman).
  Cetak lewat dialog browser (`window.print()`); tidak ada PDF di server. Di dialog cetak,
  matikan "Headers and footers" dan set skala 100% agar ukuran mm tidak berubah.
- Label hanya memuat field yang tidak kosong. QR selalu ada; nama acara opsional. Field yang
  diizinkan: nama, referensi eksternal, kategori, telepon, email, catatan (maksimal 4).
- Setiap cetak sukses menulis `audit_log` `qr.labels_exported` (jumlah, terbit/daur ulang,
  format, field) tanpa token atau PII.

---

## 8. Yang belum diverifikasi dan kapan akan diverifikasi

| Item | Kapan | Cara |
|---|---|---|
| CPU p95 ≤ 5 ms | Setelah deploy pertama (butuh akun Cloudflare) | `wrangler tail`, lihat §2 |
| Atribut cookie pada deployment nyata | Saat rilis auth berikutnya | Auth/session produksi berfungsi; inspeksi atribut `Secure`, `SameSite`, dan `HttpOnly` secara eksplisit masih diperlukan |
| `Origin`/`Host` di balik custom domain | Deploy pertama | `curl -i -X POST` dengan `Origin` domain asli; kalau proxy mengubah host, set `ALLOWED_ORIGINS` |
| Cookie `Secure` di HTTPS | Deploy pertama | Periksa `Set-Cookie` memuat `Secure` |
| Token undangan tidak muncul di log | Deploy pertama | `wrangler tail` saat 20 aktivasi; kode tidak pernah me-log token, ini verifikasi silang |
| Rate limit di balik NAT bersama | Setelah ada pengguna nyata | Amati 429 pada petugas yang berbagi IP; naikkan batas bila perlu |
| Verifikasi lokal | Setiap rilis | `npm run typecheck` → `lint` → `test` → `build`; Workers Builds hanya build + deploy, tidak menjalankan test |
| Batas baris import final | Setelah pengukuran CPU | Naikkan `MAX_IMPORT_ROWS` bertahap sambil memantau CPU |
| Batas batch label 38 | Setelah deploy pertama | Ukur CPU `wrangler tail` saat cetak 38 label; angka lokal (crypto 100 ≈ 7 ms p50) adalah proksi, bukan CPU tertagih |
| Ukuran dan keterbacaan QR hasil cetak | Uji manual sebelum rilis | Cetak A4 + stiker, ukur dengan penggaris, pindai dengan kamera HP |
| Rotasi kunci QR | Sebelum rotasi produksi pertama | Uji prosedur §7.5 di database salinan; pastikan QR lama tetap identik |
| Penerapan `0009` dan jumlah backfill produksi | Selesai (dokumentasi 8 November 2026) | Backup (`/tmp/opencode/qrcek-backup-2026-11-08-post-0008.sql`), hitung kandidat backfill (0), apply remote, verifikasi `schema_version = 9` dan jumlah baris (0) |
| Penerapan `0010` dan jumlah backfill produksi | **Selesai 9 November 2026** | Backup pre-0010 (149 KB), kandidat 60, apply remote, verifikasi `schema_version = 10` dan 60 baris (§6.3) |
| Smoke produksi Q4 dengan sesi nyata | **Belum; menunggu pemilik** | Cetak label, scan, rotasi, scan token lama (`INVALID_QR`), periksa audit `qr.identity_rotated` tanpa token (§6.3 langkah 6) |
| Penerapan `0011` dan jumlah backfill produksi | **Selesai 12 November 2026** | Backup pre-0011 (187 KB), kandidat 12 Tema/26 attendance, apply remote, verifikasi `schema_version = 11`, 26 transaksi, 12 Aktivitas default, 5 penugasan, 32 aturan entitlement (§6.4) |
| Smoke produksi Q5 dengan sesi nyata | **Belum; menunggu deploy kode Q5 + sesi pemilik** | Scan Petugas, scan kedua → `DUPLICATE`, Reversal/Adjustment Admin, Manual Entry hanya bila `allow_manual = 1` dan penugasan mengizinkan; periksa `attendance` tidak bertambah (§6.4 langkah 6) |
| CPU produksi route entitlement | Setelah deploy Q3 | `wrangler tail`; matriks/batch 15 baris adalah kandidat terberat |
| CPU produksi rotasi/QR label | Setelah deploy Q4 | `wrangler tail` saat cetak 38 label dan rotasi; lokal 47 statement / 45 ms adalah proksi |
| CPU produksi scan/koreksi Q5 | Setelah deploy Q5 | `wrangler tail`; lokal 15 statement scan / 11–12 koreksi adalah proksi, bukan CPU tertagih |

Repo ini tidak memakai GitHub Actions. Workers Builds hanya menjalankan build dan deploy, bukan
test suite, jadi verifikasi wajib dijalankan lokal sebelum merge/deploy; jangan menyimpulkan
rilis aman hanya dari build hijau.

---

## 9. Kesehatan, pemakaian, dan retensi audit (Fase 6)

### 9.1 Endpoint operasional

| Endpoint | Peran | Biaya | Dipakai untuk |
|---|---|---|---|
| `GET /api/health` | publik | nol query | Cek "Worker hidup?" Setelah deploy, tidak menyentuh D1 |
| `GET /api/health/ready` | publik | 1 query (`SELECT 1`) | Cek "D1 bisa dipakai?" Balas `503 DB_UNAVAILABLE` bila binding gagal |
| `GET /api/admin/usage` | superadmin | 1 `db.batch` (9 statement `COUNT`) | Perencanaan kapasitas: jumlah baris, sesi aktif, antrean outbox, umur audit log |

Contoh:

```bash
curl -s https://<worker>/api/health/ready
curl -s -b "absensi_session=<cookie-superadmin>" https://<worker>/api/admin/usage
```

`/api/admin/usage` **bukan** endpoint cron. Setiap `COUNT(*)` membaca tabel, jadi
memanggilnya tiap menit akan membakar kuota baris dibaca D1. Panggil manual menjelang
acara besar atau saat kapasitas mulai terasa.

### 9.2 Security headers

Header dipasang di dua jalur, karena `wrangler.jsonc` memakai
`run_worker_first: ["/api/*"]` sehingga aset statis dilayani Cloudflare tanpa Worker:

| Jalur | Sumber |
|---|---|
| Respons Worker (JSON, CSV, proxy aset saat dev) | `SECURITY_HEADERS` di `packages/shared/src/security.ts`, dipasang `apps/api/src/http/security-headers.ts` |
| Aset statis + fallback SPA | `apps/web/public/_headers` (disalin Vite ke `dist/`) |

Tes `apps/web/src/lib/security-headers.test.ts` membandingkan keduanya, jadi
menambah header di satu sisi tanpa sisi lain akan merah.

Nilai yang perlu diingat saat mengubah UI:

- `script-src 'self'`; jangan menambah domain luar atau inline script tanpa mengubah CSP
  lebih dulu. Sejak Turnstile dihapus (ADR-0013), `challenges.cloudflare.com` tidak lagi
  diizinkan di `script-src`, `connect-src`, maupun `frame-src`.
- `style-src 'unsafe-inline'` ada karena React menulis atribut `style` dinamis.
- `Permissions-Policy: camera=(self)` wajib dipertahankan; tanpa itu pemindai QR gagal
  di sebagian browser. Mikrofon dan geolokasi ditutup.
- `Strict-Transport-Security` hanya berlaku di HTTPS; `localhost` mengabaikannya.

### 9.3 Retensi audit log ([ADR-0008](./adr/0008-audit-log-retention.md))

`audit_log` **tidak** dipangkas otomatis. Trigger `audit_log_no_delete` menolak `DELETE`
di level database, dan itu disengaja: riwayat absensi tidak boleh hilang karena job
pembersih yang salah konfigurasi.

Kebijakan:

1. **Pantau** lewat `GET /api/admin/usage` (`counts.auditEntries`, `auditLog.oldestAt`).
2. **Arsipkan sebelum menghapus.** Ekspor rentang yang akan dibuang:
   ```bash
   cd apps/api
   npx wrangler d1 execute absensi-db --remote --json \
     --command "SELECT * FROM audit_log WHERE created_at < <cutoff_ms> ORDER BY created_at" \
     > /tmp/audit-archive-<cutoff>.json
   ```
   Simpan file itu di tempat yang bukan D1 (repositori privat/arsip GitHub). Catat
   `cutoff_ms` dan jumlah baris di catatan rilis.
3. **Baru setelah arsip terverifikasi**, jalankan migrasi pemeliharaan manual yang
   (a) menghapus trigger delete, (b) menghapus rentang tersebut, (c) memasang kembali
   trigger. Migrasi itu harus ditulis sebagai file baru di `migrations/`, direview, dan
   disebutkan di `docs/DESAIN_DATABASE.md`.
4. Jangan pernah menghapus baris audit yang belum diarsipkan, dan jangan menjalankan
   langkah 3 dari `cron`.

Ambang arsip yang disarankan: baris tertua lebih dari **12 bulan**, atau
`counts.auditEntries` mendekati batas nyaman D1 free tier. Angka ini keputusan operator,
bukan aturan yang ditegakkan kode — endpoint usage menyediakan datanya.

---

## 10. Deploy produksi lewat Cloudflare Workers Builds

### 10.1 Alur

```
git push/merge ke main
      │
      ▼
Cloudflare Workers Builds
  ├─ npm ci && npm run build
  └─ npx wrangler deploy --config apps/api/wrangler.jsonc
      │
      ▼
Worker + Static Assets (apps/web/dist)
```

- Production branch: `main`. Pull request boleh memicu preview build, tetapi produksi hanya
  dari `main`.
- Repo ini **tidak** memakai GitHub Actions. Build berjalan di runner Cloudflare, bukan
  runner GitHub.
- Build menulis `apps/web/dist`, lalu deploy mengunggahnya sebagai Static Assets. Berkas
  `apps/web/public/_headers` ikut terunggah.
- Riwayat deployment Cloudflare tersedia untuk rollback (§10.6).

### 10.2 Setup Workers Builds

Buka **Workers & Pages → `qrcek` → Settings → Build**:

| Setelan | Nilai | Kenapa |
|---|---|---|
| Repository | `github.com/bratayudha07/QRCek` | Sumber kode |
| Production branch | `main` | Satu-satunya sumber produksi |
| Root directory | root repo (kosongkan) | Build command dijalankan dari root |
| Build command | `npm ci && npm run build` | Install workspace dan hasilkan `apps/web/dist` |
| Deploy command | `npx wrangler deploy --config apps/api/wrangler.jsonc` | Memakai `wrangler.jsonc` di `apps/api` |
| Build watch paths | opsional | Hindari build untuk perubahan dokumen saja |
| Environment variable | `NODE_VERSION=22` (opsional) | Menyamakan versi Node dengan lokal |

> Alternatif yang setara: root directory `apps/api`, build command
> `cd ../.. && npm ci && npm run build`, deploy command `npx wrangler deploy`. Pilih satu
> susunan, jangan dicampur.

Gejala build hijau tetapi situs 404: build command tidak menghasilkan `apps/web/dist`,
sehingga `assets.directory` kosong.

Workers Builds membuat check run di GitHub. Kalau branch protection `main` mewajibkan status
check, check `Workers Builds: qrcek` harus hijau. Kalau build setting sudah benar tetapi check
lama masih gagal, periksa ulang build log atau matikan requirement status check sementara.

### 10.3 Yang tidak ikut ter-deploy

| Hal | Kenapa | Cara menangani |
|---|---|---|
| **Migrasi D1** | Workers Builds hanya mengunggah kode | `npx wrangler d1 migrations apply absensi-db --remote` dari `apps/api`, setelah backup |
| **Secret runtime** | Secret tidak disimpan di repo | `npx wrangler secret put <NAMA>` dari `apps/api` |
| **Variabel build frontend** | Dibutuhkan saat Vite membangun bundle | Saat ini tidak ada `VITE_*` wajib; bila ditambah, pastikan nilainya publik |
| **Data D1** | Bukan bagian dari deploy | Backup/PITR D1, lihat §9.3 untuk audit |

Backup dan migrasi manual:

```bash
cd apps/api
npx wrangler d1 export absensi-db --remote \
  --output /tmp/opencode/qrcek-backup-$(date -u +%Y-%m-%d).sql
npx wrangler d1 migrations apply absensi-db --remote
```

> Peringatan urutan: `0008` sudah diterapkan 8 November 2026. Jendela campuran pada rilis itu
> (~14 menit) terjadi karena build selesai sebelum migrasi; data akhir bersih. Untuk rilis
> berikutnya, pakai expand/contract: migrasi additive → deploy kode → migrasi penegakan. Bila
> trigger harus aktif segera, matikan auto-deploy sementara dan jalankan migrasi + deploy
> manual tanpa jeda.

### 10.4 Batas free tier Workers Builds

| Metrik | Free |
|---|---|
| Build minutes | **3.000/bulan** |
| Build bersamaan | **1** |
| Timeout satu build | 20 menit |
| Retensi log build | 90 hari |

Sumber: <https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/> (28 Okt 2026).

Satu build repo ini berkisar satu-dua menit, jadi kuota bulanan cukup untuk puluhan rilis.
Karena build bersamaan hanya satu, push berturut-turut akan mengantre.

### 10.5 Verifikasi setelah deploy

```bash
base=https://qrcek.hamdirobbi5.workers.dev

curl -s  "$base/api/health"            # 200, status ok
curl -s  "$base/api/health/ready"      # 200 ready | 503 DB_UNAVAILABLE
curl -sI "$base/" | grep -i "content-security-policy\|permissions-policy"
curl -sI "$base/assets/" 2>/dev/null | head -1   # aset ada
```

`/api/admin/usage` butuh cookie superadmin, jadi tidak bisa dicek dengan `curl` tanpa sesi.

### 10.6 Rollback

- **Kode:** dashboard Cloudflare → Worker → Deployments → pilih versi sebelumnya → Rollback.
  Ini mengembalikan Worker **dan** aset statis ke versi itu.
- **Database:** rollback kode **tidak** membatalkan migrasi. Kalau rilis berisi migrasi yang
  merusak, pemulihan memakai Time Travel D1 (7 hari di free tier) atau snapshot manual, dan
  itu keputusan pemilik proyek.
- Jangan rollback ke versi yang lebih tua dari skema database saat ini tanpa memeriksa
  kompatibilitas query-nya.
- **Khusus Q4:** rotasi menyalin kredensial baru ke `participants.qr_*` dengan guard
  `token_hash`, jadi rollback ke Worker pra-`0010` **tidak** menghidupkan token yang sudah
  dicabut. Namun Worker lama tidak membaca `qr_identities`: peserta yang kredensialnya hanya
  pernah diterbitkan setelah `0010` akan tampak "belum punya QR" dan scan-nya gagal sampai
  Worker baru dipulihkan. Jangan menghapus `qr_identities` saat rollback.
- **Kredensial yang terbit selama rollback belum tentu dikenali setelah roll-forward.**
  Worker pra-`0010` menulis kredensial baru hanya ke `participants.qr_*`; baris
  `qr_identities` tidak bertambah. Setelah Worker baru dipulihkan, lookup **scan** membaca
  `qr_identities` saja, sehingga kartu yang dicetak pada jendela rollback akan `not_found`
  sampai peserta itu dicetak/dipromosikan sekali lewat `POST .../qr-labels`. Setelah
  roll-forward, jalankan promosi untuk setiap peserta yang menerima kartu baru selama
  rollback, lalu scan ulang kartu tersebut. Jangan mengandalkan `qr_identities` yang lebih
  tua sebagai sumber kebenaran untuk kredensial rollback.
