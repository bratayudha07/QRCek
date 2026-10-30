# ARSITEKTUR — Multi-Event Parent Attendance Management System

Status: **draf perencanaan, menunggu persetujuan**. Tidak ada kode aplikasi pada tahap ini.

Dokumen terkait: [`DESAIN_DATABASE.md`](./DESAIN_DATABASE.md), [`DESAIN_API.md`](./DESAIN_API.md), [`RENCANA_PENGUJIAN.md`](./RENCANA_PENGUJIAN.md), [`../COSTS_AND_LIMITS.md`](../COSTS_AND_LIMITS.md), [`../IMPLEMENTATION_PLAN.md`](../IMPLEMENTATION_PLAN.md).

---

## 1. Tujuan dan batasan yang mengikat

Sistem mencatat kehadiran orang tua/peserta pada banyak acara terpisah, dengan admin per acara dan petugas lapangan yang memindai QR dari kamera HP.

Batasan yang membentuk seluruh desain (dari [`AGENTS.md`](../AGENTS.md)):

| Batasan | Konsekuensi arsitektural |
|---|---|
| Tidak ada layanan berbayar | Tanpa queue, tanpa Durable Objects berbayar, tanpa SaaS auth, tanpa email transaksional |
| Workers Free: **10 ms CPU/request** | Tidak ada KDF mahal (PBKDF2/bcrypt/argon2) di jalur request; tidak ada PDF generation di server |
| D1 Free: **50 query per invokasi Worker** | Setiap endpoint dirancang ≤ 6 statement; cron memproses batch kecil |
| D1 Free: **500 MB per database** | Skema hemat byte; kebijakan retensi audit wajib ada sejak awal |
| Kamera hanya di secure context | HTTPS wajib; `localhost` untuk dev |
| iOS Safari tanpa `BarcodeDetector` | Library scan QR pure-JS wajib dibundel |

---

## 2. Keputusan arsitektur (menunggu persetujuan)

Setiap keputusan di bawah akan diekstrak menjadi `docs/adr/NNNN-*.md` saat implementasi dimulai.

### ADR-001 — Topologi origin: **satu Worker, same-origin** (Diusulkan)

Satu Worker menyajikan SPA (via Workers Static Assets) **dan** API di `/api/*`.

```jsonc
// apps/api/wrangler.jsonc (ringkas)
{
  "assets": {
    "directory": "../web/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  }
}
```

- **Alternatif yang ditolak**: Pages terpisah + Worker di subdomain. Menambah CORS, cookie lintas-site (`SameSite=None` + `Secure`), dua pipeline deploy, dua tempat konfigurasi. Tidak ada manfaat yang sepadan pada skala ini.
- **Konsekuensi**: SPA dan API selalu deploy bersamaan (versi terkunci). Kuota Workers berlaku untuk request API saja — request aset statis yang cocok disajikan tanpa menjalankan Worker (didokumentasikan Cloudflare).
- **Dev**: `vite dev` di `:5173` dengan proxy `/api` → `wrangler dev` di `:8787`. Dari sisi browser tetap same-origin, jadi perilaku cookie identik dengan produksi.

### ADR-002 — Autentikasi **passwordless berbasis token** (Diusulkan, menggantikan aturan PBKDF2 di AGENTS.md)

**Temuan yang memaksa keputusan ini**: Workers Free memberi **10 ms CPU per request**. PBKDF2-SHA256 pada jumlah iterasi yang layak (ratusan ribu) memakan CPU puluhan hingga ratusan milidetik. Login akan gagal dengan error 1102 di paket gratis. Menurunkan iterasi sampai muat 10 ms membuat hash praktis tidak berguna.

Karena sistem **sudah** punya kanal undangan QR, password tidak diperlukan:

| Kredensial | Entropi | Penyimpanan |
|---|---|---|
| Token aktivasi (QR undangan) | 128-bit acak, sekali pakai, kedaluwarsa | `HMAC-SHA256(pepper, token)` |
| Kredensial perangkat | 256-bit acak, per perangkat | `HMAC-SHA256(pepper, token)` |
| Kode pemulihan | 128-bit acak, sekali pakai, ditampilkan sekali | `HMAC-SHA256(pepper, kode)` |
| Sesi | 256-bit acak, cookie `HttpOnly` | `HMAC-SHA256(pepper, token)` |

Karena entropi sumbernya tinggi, hash cepat (HMAC) sudah memadai secara kriptografis — serangan kamus tidak berlaku pada ruang 2^128. Tidak ada KDF mahal, tidak ada CPU spike.

- **Konsekuensi**: tidak ada "lupa password" mandiri via email (email transaksional = layanan pihak ketiga). Pemulihan dilakukan dengan kode pemulihan atau undangan baru dari admin.
- **Perlu persetujuan**: aturan "Auth hashing pakai PBKDF2-SHA256" di `AGENTS.md` harus diganti dengan aturan token di atas.

### ADR-003 — QR peserta: **token opaque, hash di server** (bukan payload bertanda tangan)

QR berisi `absensi:v1:<base64url(128-bit random)>`. Yang disimpan di DB adalah `HMAC-SHA256(QR_PEPPER, token)` dengan indeks unik.

- Alasan memilih ini dibanding payload berisi data + HMAC: tidak ada PII di QR (kalau difoto orang lain, tidak ada yang bocor); rotasi/revokasi cukup mengganti satu baris; ukuran QR tetap kecil sehingga mudah dipindai kamera HP murah dan tetap terbaca saat dicetak kecil.
- **Konsekuensi**: pemindaian **butuh jaringan** (harus lookup ke DB). Tidak ada mode offline. Ini non-goal yang disengaja; lihat §9.

### ADR-004 — Model sinkronisasi Sheets: **proyeksi/upsert per peserta** (bukan append-only)

Setiap peserta menempati **satu baris tetap** di spreadsheet. Absensi = satu sel. Koreksi = menimpa sel yang sama.

- Alasan: operasi `append` **tidak idempoten** — kalau `append` berhasil tapi update DB gagal, retry membuat baris duplikat yang tidak bisa dibedakan. Upsert ke baris deterministik idempoten secara konstruksi, sehingga aman untuk retry.
- Pemetaan `participant_id → row_index` disimpan di D1 (`sheet_rows`), bukan dihitung ulang tiap sync.
- **Konsekuensi**: sheet tidak menyimpan riwayat per-scan (riwayat ada di `audit_log`). Edit manual di sheet akan tertimpa — didokumentasikan sebagai perilaku yang diharapkan.

### ADR-005 — Outbox persisten di D1, digerakkan **Cron Trigger**

Tidak ada queue berbayar. Penulisan ke Google Sheets dilakukan oleh cron yang mengambil sejumlah kecil item dari tabel `outbox` (detail di §7).

---

## 3. Topologi dan komponen

```
┌──────────────────────────────────────────────┐
│ Browser (HP petugas, laptop admin)           │
│  React SPA + Tailwind + shadcn/ui            │
│  - kamera: BarcodeDetector → fallback ZXing  │
│  - cetak QR: HTML print view (bukan PDF srv) │
└───────────────┬──────────────────────────────┘
                │ HTTPS, cookie HttpOnly, same-origin
┌───────────────▼──────────────────────────────┐
│ Cloudflare Worker (apps/api)                 │
│  router → middleware → handler → domain      │
│  ├─ Static Assets (SPA)                      │
│  ├─ /api/*  (semua otorisasi di sini)        │
│  └─ scheduled()  ← Cron Trigger tiap 5 menit │
└──────┬───────────────────────┬───────────────┘
       │ D1 binding            │ fetch (service account JWT)
┌──────▼───────┐        ┌──────▼──────────────┐
│ D1 (SQLite)  │        │ Google Sheets API   │
│ absensi-db   │        │ spreadsheets.values │
└──────────────┘        └─────────────────────┘
```

### Pembagian tanggung jawab

| Lapisan | Lokasi | Isi |
|---|---|---|
| `domain/` | `apps/api/src/domain/` | Fungsi murni: aturan absensi, validasi transisi status, verifikasi token, parsing CSV, backoff. **Tanpa I/O** |
| `db/` | `apps/api/src/db/` | Semua SQL. Tidak ada SQL di luar folder ini |
| `routes/` | `apps/api/src/routes/` | Parse → validasi (zod) → panggil domain/db → bentuk respons |
| `integrations/` | `apps/api/src/integrations/` | Google Sheets client, di balik interface `SheetsClient` agar bisa di-fake |
| UI | `apps/web/src/` | Hanya presentasi + pemanggilan API. **Tanpa aturan bisnis** |
| Kontrak | `packages/shared/` | Skema zod + tipe request/response + konstanta (mis. `MAX_PARTICIPANTS_PER_EVENT`) |

### Dependensi yang diusulkan (masing-masing dengan justifikasi)

| Paket | Untuk | Kenapa tidak dibuat sendiri |
|---|---|---|
| `hono` | Router Worker | Router buatan sendiri = sumber bug parsing path/method; Hono kecil dan berjalan native di workerd |
| `zod` | Validasi runtime di boundary | `AGENTS.md` mewajibkan validasi runtime; tipe TS tidak memvalidasi apa pun saat runtime |
| `@tanstack/react-query` | Server state di SPA | Cache/invalidasi/polling manual rawan bug; dipakai di dashboard rekap |
| `react-router` | Routing SPA | Wajib untuk rute terlindungi dan deep link |
| `qrcode` | Render QR ke canvas/SVG | Membuat encoder QR sendiri berisiko (mode/algoritma Reed-Solomon) |
| `@zxing/browser` | Fallback scan saat `BarcodeDetector` tidak ada | **Terbukti wajib**: `BarcodeDetector` dinonaktifkan di Safari/iOS hingga versi 27 |
| `lucide-react` | Ikon | Bagian dari spesifikasi stack |
| `tailwindcss` + komponen shadcn/ui | Styling | Bagian dari spesifikasi stack |

Yang **tidak** ditambahkan: Prisma/Drizzle (wrangler migrations cukup, dan ORM menambah ukuran bundle + risiko SQL tak terduga), Jest (Vitest sudah dipakai), axios (fetch native), moment/dayjs (Intl sudah cukup), library PDF (render di browser).

---

## 4. Struktur folder

```
absensi/
├── AGENTS.md
├── COSTS_AND_LIMITS.md
├── IMPLEMENTATION_PLAN.md
├── package.json                 # npm workspaces, script kanonik
├── package-lock.json
├── tsconfig.base.json           # strict: true
├── .dev.vars.example            # contoh secret, TANPA nilai nyata
├── .gitignore                   # .dev.vars, .wrangler/, dist/
├── migrations/
│   ├── 0001_init.sql
│   ├── 0002_outbox.sql
│   └── ...
├── docs/
│   ├── ARSITEKTUR.md
│   ├── DESAIN_DATABASE.md
│   ├── DESAIN_API.md
│   ├── RENCANA_PENGUJIAN.md
│   └── adr/
├── packages/shared/
│   ├── package.json
│   └── src/
│       ├── index.ts
│       ├── schemas/             # zod: event, participant, scan, correction
│       └── types.ts
├── apps/api/
│   ├── wrangler.jsonc
│   ├── vitest.config.ts         # @cloudflare/vitest-plugin
│   └── src/
│       ├── index.ts             # fetch + scheduled
│       ├── router.ts
│       ├── middleware/          # auth, csrf, rate-limit, error
│       ├── routes/              # satu file per resource
│       ├── domain/              # fungsi murni
│       ├── db/                  # query + mapper
│       ├── integrations/        # sheets client
│       └── test/
│           ├── fixtures/
│           └── *.test.ts
└── apps/web/
    ├── index.html
    ├── vite.config.ts           # proxy /api → :8787
    ├── components.json          # shadcn
    └── src/
        ├── main.tsx
        ├── routes/              # halaman per fitur
        ├── components/ui/       # shadcn copy-in
        ├── components/scan/     # kamera + decoder
        ├── lib/api.ts           # fetch wrapper, error mapping
        └── hooks/
```

Aturan: **satu file route = satu resource**. Jangan menumpuk semua endpoint di satu file besar (menyulitkan review dan tes).

---

## 5. Database

Ringkasan di sini; detail lengkap di [`DESAIN_DATABASE.md`](./DESAIN_DATABASE.md).

Entitas inti: `events`, `users`, `event_memberships`, `participants`, `attendance`, `audit_log`, `outbox`, `sheet_rows`, `sessions`, `device_credentials`, `invites`, `recovery_codes`, `rate_limits`.

Prinsip yang tidak boleh dilanggar:

1. **Kehadiran ganda = pelanggaran unique index**, bukan hasil pengecekan aplikasi. Constraint: `UNIQUE (event_id, participant_id)` pada `attendance`.
2. **Isolasi acara di level query**: setiap statement yang menyentuh data acara menyertakan `event_id = ?`. Tidak ada `WHERE id = ?` tanpa cek acara.
3. **Audit append-only**: tidak ada statement `UPDATE`/`DELETE` terhadap `audit_log` di seluruh basis kode; dilindungi trigger `RAISE(ABORT)`.
4. **Semua timestamp UTC** dalam milidetik (`INTEGER`).

### Strategi migrasi

- File SQL bernomor di `migrations/`, dijalankan `wrangler d1 migrations apply`. Riwayat tersimpan di tabel `d1_migrations` (perilaku bawaan wrangler).
- **File migrasi yang sudah pernah dijalankan tidak boleh diedit.** Perbaikan = file baru.
- Karena SQLite di D1 punya `ALTER TABLE` terbatas, perubahan kolom yang merusak dilakukan dengan **table rebuild** (buat tabel baru → `INSERT ... SELECT` → `DROP` → `RENAME`), dan `PRAGMA defer_foreign_keys = true` bila perlu (didokumentasikan Cloudflare).
- Migrasi diuji di lokal (`--local`) pada database kosong **dan** pada database hasil migrasi sebelumnya (uji upgrade), sebelum `--remote`.
- `--remote` hanya dijalankan setelah konfirmasi eksplisit pemilik proyek.
- Setiap perubahan skema disertai catatan di `docs/ARSITEKTUR.md` dan pembaruan fixture tes.

---

## 6. Alur utama

### 6.1 Membuat acara

1. `superadmin` → `POST /api/events` (nama, slug, jadwal, timezone, opsional `spreadsheet_id`).
2. Worker memvalidasi dengan `eventCreateSchema`, menulis `events` + baris `audit_log` (`event.created`) dalam **satu `db.batch()`**.
3. Status awal `draft`. Acara hanya menerima scan ketika `status = 'active'` dan waktu sekarang berada di antara `starts_at`/`ends_at` (atau `starts_at` kosong → selalu boleh).
4. Admin acara ditugaskan lewat undangan (6.2), bukan lewat pembuatan akun terpisah.

### 6.2 Undangan petugas/admin via QR

1. `event_admin`/`superadmin` → `POST /api/events/:id/invites` dengan `role` dan `expires_in_hours` (default 72, maksimum 168).
2. Server membuat token 128-bit, menyimpan `HMAC(pepper, token)`, dan **mengembalikan token sekali** (tidak pernah bisa dibaca lagi).
3. Klien merender QR berisi `https://<host>/aktivasi#t=<token>`. Token ditaruh di **fragment**, bukan query string, agar tidak tercatat di log akses/referrer.
4. Petugas memindai dengan kamera HP (aplikasi kamera bawaan, bukan scanner di aplikasi) → membuka halaman aktivasi.
5. `POST /api/auth/activate` memverifikasi: token ada, belum dipakai, belum kedaluwarsa, acara masih `active`/`draft`. Dalam satu `db.batch()`:
   - tandai `invites.used_at`,
   - buat/baca `users`,
   - buat `event_memberships`,
   - buat `device_credentials`,
   - buat `sessions`,
   - buat `recovery_codes`,
   - tulis `audit_log` (`invite.redeemed`).
6. Respons menampilkan **kode pemulihan sekali** di layar, dengan peringatan untuk menyimpannya.
7. Undangan yang sudah dipakai tidak bisa dipakai ulang bahkan oleh pemegang token aslinya.

### 6.3 Import peserta CSV

1. UI mengunggah file ke `POST /api/events/:id/participants/import?dry_run=true`.
2. Worker: batas ukuran 2 MB, batas 5.000 baris per request, decode UTF-8 (BOM dihapus), deteksi delimiter (`,` atau `;`), validasi header terhadap daftar kolom wajib.
3. Setiap baris divalidasi; hasil `dry_run` = ringkasan `{ total, valid, invalid: [{line, reason}] }`. **Tidak ada penulisan** saat dry run.
4. Eksekusi nyata: baris valid di-`INSERT` dalam batch (mis. 200 per batch), dengan `ON CONFLICT (event_id, external_ref) DO UPDATE` agar import ulang bersifat idempoten.
5. Setiap peserta baru mendapat `qr_token_hash` unik yang dibuat di server.
6. Baris tidak valid **tidak** disimpan; hasilnya dilaporkan per nomor baris agar bisa diperbaiki di CSV dan diimpor ulang.
7. Import ditolak seluruhnya jika acara sudah `archived`.

### 6.4 Pemindaian QR dan pencatatan absensi

```
POST /api/events/:eventId/scan   body: { qr: "absensi:v1:<token>" }
```

Urutan di Worker (target ≤ 5 statement):

1. Cek sesi → `SELECT` sesi + user + keanggotaan acara (**1 query**, join).
2. Parse token → `HMAC(QR_PEPPER, token)`.
3. `SELECT` peserta berdasarkan `qr_token_hash` **dan** `event_id = ?` (**1 query**). Tidak ketemu → `not_found`; ketemu tapi `event_id` berbeda → `wrong_event` (dan dicatat di audit sebagai percobaan lintas acara).
4. Cek status acara (sudah didapat pada langkah 1 lewat join) dan jendela waktu → `event_closed` bila di luar.
5. `db.batch([...])`: `INSERT INTO attendance ... ON CONFLICT(event_id, participant_id) DO NOTHING`, `INSERT INTO outbox ...`, `INSERT INTO audit_log ...`.
6. Baca `meta.changes` dari statement pertama. `changes = 1` → `present`; `changes = 0` → **`duplicate`** (bukan error 500), dengan data absensi yang sudah ada agar petugas bisa melihat jam absen sebelumnya.

Kontrak respons selalu HTTP 200 untuk hasil bisnis (`present`, `duplicate`, `not_found`, `wrong_event`, `event_closed`, `participant_inactive`); 4xx/5xx hanya untuk kesalahan autentikasi/validasi/sistem. Ini membuat UI scanner sederhana: satu jalur sukses, satu jalur error.

### 6.5 Koreksi absensi

1. `event_admin` (bukan `officer`) → `POST /api/attendance/:id/correction` dengan `{ status, reason }`; `reason` wajib ≥ 10 karakter.
2. Satu `db.batch()`: `UPDATE attendance`, `INSERT audit_log` (`attendance.corrected`, berisi `before`/`after`), `INSERT/UPDATE outbox`.
3. `officer` yang mencoba → 403 + baris audit `authz.denied`.

---

## 7. Sesi dan pemulihan akses

### Sesi

- Cookie `absensi_session`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age` 30 hari (sliding).
- Nilai cookie = token acak 256-bit. Di DB hanya tersimpan `HMAC(pepper, token)`.
- Setiap request: satu query join `sessions → users → event_memberships`. `last_seen_at` diperbarui paling sering **sekali per 5 menit** per sesi (menghindari tulisan D1 yang tidak perlu).
- Revokasi = `UPDATE sessions SET revoked_at = ?` (instan, karena sesi server-side).
- Rotasi kredensial perangkat (reset HP) mencabut semua sesi milik kredensial itu.

### Pemulihan tanpa Google login

| Skenario | Jalur pemulihan |
|---|---|
| Petugas ganti/lupa HP | Minta admin acara membuat undangan baru; kredensial lama dicabut |
| Petugas tetap punya kode pemulihan | `POST /api/auth/recover` dengan kode → kredensial baru + kode pemulihan baru |
| Admin acara kehilangan akses | Dipulihkan oleh `superadmin` (undangan baru) |
| `superadmin` kehilangan akses | **Break-glass terdokumentasi**: `wrangler d1 execute` untuk menyisipkan undangan baru, dilakukan manual oleh pemilik akun Cloudflare. Prosedur ini dicatat di `docs/OPERASIONAL.md` dan setiap penggunaan wajib menghasilkan entri audit |

Tidak ada email, tidak ada SMS, tidak ada OAuth Google untuk pengguna.

### Proteksi CSRF

`SameSite=Lax` memblokir POST lintas-site. Ditambah lapisan kedua: semua request non-GET wajib menyertakan header `X-Absensi-Csrf: 1` dan `Origin` harus cocok dengan `Host`. Keduanya dicek di middleware sebelum routing.

---

## 8. Integrasi Google Sheets

### Autentikasi

1. Service account JSON disimpan sebagai secret Worker `GOOGLE_SA_KEY` (isi field `private_key` PKCS#8).
2. Worker menyusun JWT (`RS256`, `crypto.subtle`) dengan `scope=https://www.googleapis.com/auth/spreadsheets`, lalu menukarnya di `https://oauth2.googleapis.com/token` (`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`).
3. Access token di-cache di memori modul sampai ~5 menit sebelum kedaluwarsa. Cache hilang saat isolate didaur ulang — itu wajar dan murah (satu penukaran per isolate per jam).
4. Spreadsheet harus di-*share* ke email service account sebagai **Editor**. Langkah manual ini didokumentasikan; sistem menampilkan email service account di UI konfigurasi agar admin bisa melakukannya sendiri.

### Penulisan

- Satu tab per acara. Baris 1 = metadata (`event_id`, versi skema, hash header) untuk mendeteksi tab yang salah.
- Baris 2 = header kolom. Baris 3+ = satu baris per peserta (`sheet_rows.row_index`).
- Update memakai `spreadsheets.values.batchUpdate` dengan `valueInputOption=RAW`, range dihitung dari `sheet_rows`.
- Ukuran payload dibatasi jauh di bawah rekomendasi 2 MB per request; chunk maksimum 500 baris.

### Outbox

Tabel `outbox` ditulis **dalam batch yang sama** dengan mutasi absensi, sehingga tidak ada kejadian "absen tercatat tapi tidak pernah masuk antrean".

Status: `pending → inflight → done`, atau `pending → failed → pending` (retry) → `dead` setelah percobaan maksimum.

Siklus cron (tiap 5 menit):

1. Ambil maksimum 5 item `pending` dengan `next_attempt_at <= now`, urut `next_attempt_at`.
2. Kelompokkan per `event_id`; lewati acara tanpa spreadsheet atau `sync_enabled = 0`.
3. Untuk setiap acara: satu panggilan `values.batchUpdate` (bisa >1 chunk), lalu `db.batch()` untuk menandai item `done` / `failed`.
4. Backoff eksponensial + jitter: `min(2^attempts × 30s, 30 menit)`.
5. Percobaan maksimum 8 → `dead`, muncul di dashboard sebagai kegagalan yang butuh tindakan.

Detail status, kolom, dan algoritma ada di [`DESAIN_DATABASE.md`](./DESAIN_DATABASE.md) §6 dan [`DESAIN_API.md`](./DESAIN_API.md) §7.

---

## 9. Yang secara sengaja TIDAK dibuat

| Non-goal | Alasan |
|---|---|
| Pemindaian offline | Deduplikasi offline butuh konsensus multi-perangkat; tidak layak tanpa Durable Objects berbayar |
| Aplikasi mobile native | Kamera browser cukup; menghindari biaya distribusi dan maintain dua basis kode |
| Login Google/OAuth | Tidak sesuai kebutuhan (petugas lapangan sering tanpa akun Google) |
| PDF QR di server | CPU Worker 10 ms; cetak lewat `window.print()` dari HTML |
| Riwayat absensi per-scan di Sheets | Sheet hanya proyeksi keadaan terkini; riwayat di `audit_log` |
| Notifikasi email/WhatsApp | Butuh layanan pihak ketiga |
| Multi-bahasa | UI Bahasa Indonesia saja |

---

## 10. Risiko utama

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | **CPU 10 ms** terlampaui pada request berat (import CSV besar, verifikasi token) | Error 1102 | Batas 5.000 baris/import; semua kripto memakai HMAC/SHA-256; uji CPU di Fase 0 sebelum fitur dibangun |
| R2 | **50 query/invokasi** (free) terlampaui saat N+1 | Request gagal | Aturan: satu endpoint ≤ 6 statement; agregasi rekap dilakukan dalam satu `GROUP BY`, bukan loop |
| R3 | **D1 500 MB** penuh karena audit log | Write ditolak → sistem mati | Retensi audit dapat dikonfigurasi; export arsip sebelum purge; dashboard menampilkan ukuran DB |
| R4 | **100k baris tulis/hari** habis (indeks ikut dihitung sebagai baris tulis) | Import massal gagal | Import dipecah per hari; estimasi ditulis di `COSTS_AND_LIMITS.md` |
| R5 | Sheets API 60 write/menit/user → service account = satu user | 429 saat event ramai | Cron dibatasi 5 item/siklus dengan 1 batch write per acara |
| R6 | Google menyatakan kelebihan kuota akan berbayar "later in 2026" | Biaya tak terduga | Throttle ketat; pemantauan 429; jalur nonaktifkan sync tanpa menghentikan absensi |
| R7 | Sheet diedit manual → `sheet_rows` melenceng | Data salah | Full resync tersedia; verifikasi hash header; dokumentasi "sheet dikelola sistem" |
| R8 | Token undangan tersebar (QR difoto orang lain) | Penyalahgunaan akun | Sekali pakai, kedaluwarsa 72 jam, audit per redeem, revokasi instan |
| R9 | HP petugas kehilangan sinyal di lokasi | Absensi terhenti | Prosedur operasional: petugas wajib punya koneksi; disediakan input manual oleh admin sebagai fallback |
| R10 | `BarcodeDetector` tidak ada di iOS | Scanner mati di iPhone | Fallback ZXing wajib ada dan diuji di perangkat nyata |

---

## 11. Sumber terverifikasi

Angka dan perilaku platform yang dipakai di dokumen ini:

- Cloudflare Workers limits — <https://developers.cloudflare.com/workers/platform/limits/> (diperbarui 29 Okt 2026)
- Cloudflare D1 limits — <https://developers.cloudflare.com/d1/platform/limits/> (24 Okt 2026)
- Cloudflare D1 pricing/kuota baris — <https://developers.cloudflare.com/d1/platform/pricing/> (21 Apr 2026)
- Cloudflare Pages limits — <https://developers.cloudflare.com/pages/platform/limits/> (5 Sep 2026)
- Workers Static Assets — <https://developers.cloudflare.com/workers/static-assets/> (12 Okt 2026)
- D1 migrations — <https://developers.cloudflare.com/d1/reference/migrations/> (8 Jun 2026)
- Google Sheets API usage limits — <https://developers.google.com/sheets/api/limits>
- Google Drive file limits (batas sel Sheets) — <https://support.google.com/drive/answer/37603>
- `BarcodeDetector` dukungan browser — <https://caniuse.com/mdn-api_barcodedetector_barcodedetector> (Safari & iOS: *disabled by default* s.d. 27.x)

Yang **belum** terverifikasi dan harus diukur saat implementasi ditandai ⚠️ di dokumen terkait.

Pengukuran empiris yang dilakukan di repo ini sendiri (bukan dari dokumentasi vendor) dicatat di **`docs/OPERASIONAL.md`** — hasil spike Fase 0: atomisitas `db.batch()`, dukungan `RETURNING`, partial unique index, rencana query, dan proksi biaya hot path. Angka di sana **bukan** pengganti angka platform: CPU terukur hanya bisa diambil lewat `wrangler tail` pada Worker ter-deploy.
