# OPERASIONAL — Hasil pengukuran dan Catatan Lingkungan

Dokumen ini mencatat hasil pengukuran, instruksi operasi, status deployment, dan quirk lingkungan yang tidak terlihat dari kode.

> **Konteks (4 November 2026).** Semua pengukuran dan prosedur di sini berlaku untuk baseline (model `events` datar, commit acuan `157c330`) ditambah fondasi Q1 (Aktivitas/Sesi, API-only). Model target QRCek ([`REQUIREMENTS.md`](./REQUIREMENTS.md)) akan menambah tabel, indeks, dan jalur transaksi baru; angka CPU/statement/baris di bawah **tidak** otomatis berlaku untuk model itu dan harus diukur ulang di tahap roadmap terkait ([`IMPLEMENTATION_ROADMAP.md`](./IMPLEMENTATION_ROADMAP.md) Q5 dan Q11). Uji perangkat fisik scanner, akun Google Sheets nyata, dan CPU produksi belum pernah dilakukan (`REQUIREMENTS.md` §7.3). Rujukan "ADR-00N" di dokumen ini = `docs/adr/000N-*.md`.

## Status operasi saat ini (8 November 2026)

- Worker produksi berjalan di `https://qrcek.hamdirobbi5.workers.dev` dan di-deploy **manual
  dari mesin lokal** dengan `npx wrangler deploy` (dari `apps/api`). Repo ini tidak memakai
  GitHub Actions maupun Cloudflare Workers Builds, sehingga tidak ada deploy otomatis saat
  push ke `main`. Detail dan urutan rilis ada di §10.
- Terverifikasi 2 November 2026 05:49 UTC pada URL produksi: `GET /api/health` → `200`
  (Worker hidup), sedangkan `GET /api/health/ready` dan `GET /api/admin/usage` masih `404`
  dan security headers belum ada di respons aset. Artinya versi yang live lebih lama dari
  commit yang menambahkan permukaan Fase 6; endpoint itu muncul setelah push berikutnya.
- Migrasi remote `0001`–`0007` sudah diterapkan. `0007_q1_activities_sessions.sql`
  diterapkan **6 November 2026** (sebelum kode Q1 masuk `main`), setelah backup penuh:
  `npx wrangler d1 export absensi-db --remote --output /tmp/opencode/qrcek-backup-2026-11-06.sql`
  (122 KB; 17 `CREATE TABLE`, termasuk `d1_migrations`). Verifikasi pasca-migrasi:
  tabel `activities` dan `activity_sessions` ada, `app_meta.schema_version = 7`.
  Migrasi **tidak** dijalankan otomatis oleh deploy; terapkan manual dari `apps/api` dengan
  `npx wrangler d1 migrations apply absensi-db --remote` — lihat §10.3.
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
| 5 | Migrasi D1 pada database kosong | ✅ **terverifikasi** | Migrasi `0001`–`0007`; auth, peserta, QR, attendance, sync, self-signup, activities/activity_sessions |
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
# 1. verifikasi lalu deploy manual dari mesin lokal
npm run typecheck && npm run lint && npm run test && npm run build
cd apps/api && npx wrangler deploy

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
npm run db:migrate:local  # terapkan semua migrasi yang belum diterapkan (0001–0007)
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

> `participants` kini memiliki kolom kredensial QR dari `0004_qr.sql`. Migrasi yang sudah
> diterapkan tidak boleh diedit.

```bash
# bukti dari database lokal
npx wrangler d1 execute absensi-db --local \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
```

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
2. Jalankan skrip satu kali (Worker/Node dengan akses D1) yang membaca baris
   `WHERE qr_key_version = <versi lama>`, memanggil `reencryptQrCredential(configLama,
   configBaru, row)`, lalu `UPDATE participants SET qr_token_ciphertext = ?, qr_token_nonce = ?,
   qr_key_version = ? WHERE id = ?`. Skrip harus memproses per batch dan berhenti pada error
   pertama; jangan pernah menulis plaintext.
3. Setelah **semua** baris versi lama selesai, pasang `QR_ENCRYPTION_KEY` baru dan
   `QR_KEY_VERSION` baru sebagai secret Worker.
4. Verifikasi: cetak ulang satu label lama → QR harus identik dengan hasil sebelumnya, dan scan
   (Tahap 5) harus menemukan peserta yang sama.

Jangan membalik urutan langkah 2 dan 3: Worker dengan kunci baru tidak bisa mendekripsi baris
lama, dan itu akan terlihat sebagai `500` pada cetak ulang (bukan kerusakan data).

### 7.6 Mencetak dan mencetak ulang label QR

- Kredensial dibuat **saat label pertama dicetak**, bukan saat peserta dibuat/diimpor. Peserta
  yang belum pernah dicetak tidak punya baris QR dan tidak bisa dipakai untuk scan (Tahap 5).
- **Cetak ulang tidak pernah merotasi token.** Halaman label memanggil endpoint yang sama;
  hasilnya `qr` identik. Kalau hasilnya berbeda, itu bug, bukan fitur.
- Dua admin yang mencetak bersamaan untuk peserta yang sama menghasilkan satu kredensial:
  `UPDATE ... WHERE qr_token_hash IS NULL` menentukan pemenang, yang kalah membaca ulang.
- Batas satu request adalah **50 label**. Halaman label memilih maksimal 50 peserta; untuk
  acara besar, cetak per batch. Angka ini diturunkan dari 100 setelah pengukuran CPU lokal
  (lihat §2 dan `docs/RENCANA_PENGUJIAN.md`).
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
| Verifikasi lokal | Setiap rilis | `npm run typecheck` → `lint` → `test` → `build`; tidak ada CI hosted, jadi jangan andalkan status check GitHub |
| Batas baris import final | Setelah pengukuran CPU | Naikkan `MAX_IMPORT_ROWS` bertahap sambil memantau CPU |
| Batas batch label 50 | Setelah deploy pertama | Ukur CPU `wrangler tail` saat cetak 50 label; angka lokal (crypto 100 ≈ 12 ms p50) adalah proksi, bukan CPU tertagih |
| Ukuran dan keterbacaan QR hasil cetak | Uji manual sebelum rilis | Cetak A4 + stiker, ukur dengan penggaris, pindai dengan kamera HP |
| Rotasi kunci QR | Sebelum rotasi produksi pertama | Uji prosedur §7.5 di database salinan; pastikan QR lama tetap identik |

Repo ini tidak memakai GitHub Actions. Verifikasi wajib dijalankan lokal sebelum merge/deploy;
jangan menyimpulkan rilis aman hanya dari hasil build.

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

## 10. Deploy produksi manual (tanpa CI hosted)

### 10.1 Alur

```
mesin lokal
  ├─ npm run typecheck → lint → test → build
  ├─ backup D1 remote
  ├─ npx wrangler d1 migrations apply absensi-db --remote
  └─ npx wrangler deploy  ──▶  Cloudflare Worker + Static Assets
```

- Repo ini **tidak** memakai GitHub Actions atau Cloudflare Workers Builds. Push ke `main`
  tidak memicu deploy apa pun.
- Deploy dijalankan dari `apps/api` memakai Wrangler yang sudah login (`npx wrangler login`).
  Untuk shell non-interaktif, set `CLOUDFLARE_API_TOKEN` (dan `CLOUDFLARE_ACCOUNT_ID` bila
  akun Cloudflare lebih dari satu) di environment lokal. Jangan menyimpan token di repo.
- Build menulis `apps/web/dist`, lalu `wrangler deploy` mengunggahnya sebagai Static Assets.
  Berkas `apps/web/public/_headers` ikut terunggah dan langsung berlaku untuk aset statis.
- Riwayat deployment Cloudflare tersedia untuk rollback (§10.5).

### 10.2 Batas free tier

Tidak ada kuota CI hosted yang dipakai. Yang berlaku hanya batas Cloudflare Workers/D1 di
`COSTS_AND_LIMITS.md` §2–§3. GitHub dipakai untuk menyimpan source dan pull request, bukan
untuk menjalankan build.

Karena tidak ada CI hosted, **jangan aktifkan “Require status checks to pass before merging”**
pada branch protection `main`. Kalau setting itu masih aktif, PR akan menunggu check yang
tidak pernah datang. Verifikasi dilakukan lokal sebelum push/merge.

### 10.3 Yang tidak ikut ter-deploy

| Hal | Kenapa | Cara menangani |
|---|---|---|
| **Migrasi D1** | `wrangler deploy` hanya mengunggah kode | `npx wrangler d1 migrations apply absensi-db --remote` dari `apps/api`. Urutan: backup → migrasi → deploy, dalam satu jendela |
| **Secret runtime** | Secret tidak disimpan di repo | `npx wrangler secret put <NAMA>` dari `apps/api` |
| **Variabel build frontend** | Dibutuhkan saat Vite membangun bundle | Saat ini tidak ada `VITE_*` wajib; bila ditambah, pastikan nilainya publik |
| **Data D1** | Bukan bagian dari deploy | Backup/PITR D1, lihat §9.3 untuk audit |

> Peringatan urutan: setelah trigger `0008` aktif, Worker lama yang belum mengenal
> `category_id` akan gagal membuat peserta. Terapkan migrasi dan deploy kode Q2 berdekatan.
> Wrangler menangkap backup sebelum apply, tetapi tetap lakukan backup manual untuk perubahan
> besar.

### 10.4 Verifikasi setelah deploy

```bash
base=https://qrcek.hamdirobbi5.workers.dev

curl -s  "$base/api/health"            # 200, status ok
curl -s  "$base/api/health/ready"      # 200 ready | 503 DB_UNAVAILABLE
curl -sI "$base/" | grep -i "content-security-policy\|permissions-policy"
curl -sI "$base/assets/" 2>/dev/null | head -1   # aset ada
```

`/api/admin/usage` butuh cookie superadmin, jadi tidak bisa dicek dengan `curl` tanpa sesi.

### 10.5 Rollback

- **Kode:** dashboard Cloudflare → Worker → Deployments → pilih versi sebelumnya → Rollback.
  Ini mengembalikan Worker **dan** aset statis ke versi itu.
- **Database:** rollback kode **tidak** membatalkan migrasi. Kalau rilis berisi migrasi yang
  merusak, pemulihan memakai Time Travel D1 (7 hari di free tier) atau snapshot manual, dan
  itu keputusan pemilik proyek.
- Jangan rollback ke versi yang lebih tua dari skema database saat ini tanpa memeriksa
  kompatibilitas query-nya.
