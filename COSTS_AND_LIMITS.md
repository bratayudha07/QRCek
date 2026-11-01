# BIAYA DAN BATASAN — Free Tier

Dokumen ini menjawab satu pertanyaan: **kapan sistem ini akan menabrak batas, dan apa yang terjadi saat itu.**

Semua angka di bawah dikutip dari dokumentasi resmi pada tanggal verifikasi (lihat §7). Angka yang tidak bisa diverifikasi ditandai ⚠️ dan tidak dipakai sebagai dasar keputusan.

---

## 1. Ringkasan eksekutif

| Kesimpulan | Dampak |
|---|---|
| Sistem ini **bisa berjalan sepenuhnya gratis** untuk skala satu sekolah/kecamatan | Tidak ada biaya bulanan |
| Batas paling cepat tercapai adalah **100.000 baris tulis D1/hari** dan **500 MB ukuran database** | Import besar + audit log panjang |
| Batas paling berbahaya adalah **10 ms CPU per request** | Membunuh desain auth berbasis password (lihat §4) |
| Risiko biaya tak terduga berasal dari **Google Sheets**, bukan Cloudflare | Google menyatakan kelebihan kuota akan berbayar (lihat §3.3) |
| Tidak ada layanan berbayar yang perlu diaktifkan | ✅ sesuai `AGENTS.md` |

---

## 2. Cloudflare Workers

### Batas (Workers Free)

| Fitur | Free | Paid |
|---|---|---|
| Request | **100.000/hari** | tanpa batas |
| **CPU time** | **10 ms/request** | 5 menit |
| Memori | 128 MB | 128 MB |
| Subrequest | 50/request | 10.000/request |
| Koneksi keluar bersamaan | 6 | 6 |
| Environment variable | 64/Worker, 5 KB masing-masing | 128/Worker |
| Ukuran Worker | 64 MiB | 64 MiB |
| Jumlah Worker | 100 | 500 |
| **Cron Trigger per akun** | **5** | 250 |
| File static asset per versi | **20.000** | 100.000 |
| Ukuran satu file aset | 25 MiB | 25 MiB |

Sumber: <https://developers.cloudflare.com/workers/platform/limits/> (diperbarui 29 Okt 2026).

### Arti praktisnya

**CPU 10 ms adalah batas yang paling membentuk arsitektur.**

Cloudflare mencatat rata-rata Worker memakai ~2,2 ms CPU per request, dan beban yang menangani autentikasi/parsing payload besar biasanya 10–20 ms — artinya **sudah melewati batas free tier**. Setiap endpoint kita harus diukur, bukan diasumsikan.

Anggaran CPU per endpoint (target, bukan janji):

| Endpoint | Perkiraan | Catatan |
|---|---|---|
| `GET /health` | < 0,1 ms | Tanpa DB |
| `POST /scan` | 1–3 ms | 1 HMAC + 4 statement D1 + serialisasi JSON kecil |
| `POST /auth/activate` | 2–4 ms | 2 HMAC + batch 6 statement |
| `POST /participants/import` (1.000 baris) | **5–9 ms** ⚠️ | Risiko tertinggi; wajib diukur dan mungkin perlu diturunkan ke 500 baris/request |
| `GET /attendance` (50 baris) | 1–2 ms | |
| Cron sync (5 item, 1 batch write) | 1–3 ms + jaringan | Waktu tunggu jaringan tidak dihitung sebagai CPU |

**Aturan**: bila sebuah endpoint terukur di atas 5 ms p95, endpoint itu harus dipecah atau dibatasi payload-nya. Margin 2× wajib dipertahankan karena angka CPU bervariasi antar mesin.

**Request 100.000/hari** cukup untuk ±100.000 scan/hari. Satu acara 1.000 peserta = ~1.000 request scan + polling dashboard. Aman. Yang perlu diwaspadai adalah **polling agresif** di dashboard: gunakan interval ≥ 30 detik, bukan WebSocket/polling per detik.

**Cron Trigger maksimum 5 per akun.** Kita memakai 1 (`*/5 * * * *`). Sisa 4 cadangan.

⚠️ Yang belum terverifikasi: apakah invokasi Cron Trigger **dihitung** sebagai request dalam kuota 100.000/hari. Rencana pengamanan: frekuensi 5 menit = 288 invokasi/hari; bahkan bila dihitung dua kali, dampaknya < 1% kuota. Tidak perlu tindakan khusus.

---

## 3. Cloudflare D1

### 3.1 Batas (D1 Free)

| Metrik | Free | Paid |
|---|---|---|
| **Baris dibaca** | **5.000.000/hari** | 25 miliar/bulan termasuk |
| **Baris ditulis** | **100.000/hari** | 50 juta/bulan termasuk |
| **Storage total akun** | **5 GB** | 5 GB termasuk, lalu $0,75/GB-bulan |
| **Ukuran maksimum satu database** | **500 MB** (tidak bisa dinaikkan) | 10 GB |
| Database per akun | 10 | 50.000 |
| Time Travel (PITR) | **7 hari** | 30 hari |
| **Query per invokasi Worker** | **50** | 1.000 |
| Kolom per tabel | 100 | 100 |
| Ukuran baris/string/BLOB | 2 MB | 2 MB |
| Panjang statement SQL | 100 KB | 100 KB |
| Parameter terikat per query | 100 | 100 |
| Durasi query | 30 detik | 30 detik |

Sumber: <https://developers.cloudflare.com/d1/platform/limits/> (24 Okt 2026) dan <https://developers.cloudflare.com/d1/platform/pricing/> (21 Apr 2026).

### 3.2 Perilaku saat batas tercapai

- **Batas baca/tulis harian habis** → D1 menolak query; aplikasi tidak bisa berfungsi sampai 00:00 UTC (batas harian direset harian pada 00:00 UTC).
- **Storage 500 MB penuh** → tidak bisa `INSERT`, `CREATE TABLE`, `ALTER`, atau `CREATE INDEX`. Sistem berhenti menerima absensi.
- **Tidak ada penagihan otomatis** pada paket Free — yang terjadi adalah kegagalan, bukan tagihan.

### 3.3 Anggaran baris tulis (paling ketat)

⚠️ **Setiap indeks menambah satu baris tulis.** Ini yang paling sering membuat orang salah hitung.

| Operasi | Baris ditulis | Perhitungan |
|---|---|---|
| 1 scan absensi | **≈ 9** | `attendance` +2 indeks, `outbox` +2 indeks, `audit_log` +3 indeks, `sessions.last_seen_at` (kadang) |
| 1 peserta baru (import) | **≈ 5** | `participants` +4 indeks |
| 1 koreksi | **≈ 8** | `attendance` +2, `audit_log` +3, `outbox` +2 |
| 1 aktivasi petugas | **≈ 12** | user + membership + credential + session + recovery + audit + indeks |
| 1 siklus cron (5 item + housekeeping) | **≈ 30** | |

Dengan 100.000 baris tulis/hari:

| Skenario | Baris ditulis | Status |
|---|---|---|
| 1 acara, 1.000 peserta, 1 hari | ~9.000 + 5.000 import | ✅ 14% kuota |
| 1 acara, 5.000 peserta, 1 hari | ~45.000 + 25.000 import | ✅ 70% kuota |
| 2 acara × 5.000 peserta di hari yang sama | ~140.000 | ❌ **melebihi** |
| Import 10.000 peserta dalam sehari | ~50.000 | ✅ (tetapi terpecah ke 2 request karena batas 5.000/request) |

**Rekomendasi operasional**: jangan menjadwalkan dua acara besar pada tanggal yang sama, atau bagi import ke beberapa hari sebelum acara.

### 3.4 Anggaran baris baca

5.000.000 baris/hari terdengar besar, tetapi **satu full table scan menghabiskan banyak sekaligus**: tabel `attendance` berisi 50.000 baris → satu query tanpa indeks = 50.000 baris dibaca. Tiga puluh query seperti itu = 1,5 juta baris.

Aturan:
- Setiap query pada tabel besar **wajib** memakai indeks (`EXPLAIN QUERY PLAN` → `SEARCH`, bukan `SCAN`).
- Dashboard **tidak** boleh menghitung ulang dari tabel mentah setiap poll; gunakan query agregat terindeks dengan `GROUP BY status` pada rentang `event_id`.
- Anggaran: ≤ 1.000 baris dibaca per request dashboard.

### 3.5 Umur database terhadap 500 MB

| Tabel | Estimasi/baris | Isi realistis | Total |
|---|---|---|---|
| `participants` (dengan indeks) | ~450 B | 20.000 | ~9 MB |
| `attendance` (dengan indeks) | ~300 B | 20.000 | ~6 MB |
| `audit_log` (dengan indeks) | ~700 B | 200.000 | **~140 MB** |
| `outbox` (setelah pruning) | ~400 B | 500 | < 1 MB |
| `sheet_rows` | ~120 B | 20.000 | ~2,5 MB |
| `sessions` + `credentials` + `rate_limits` | kecil | — | < 5 MB |

**Kesimpulan**: sekitar **160 MB untuk 20.000 peserta + 200.000 baris audit**. Batas 500 MB memberi ruang untuk ~600.000 baris audit.

`audit_log` adalah penentu umur database. Kebijakan retensi + arsip (lihat `docs/DESAIN_DATABASE.md` §8) **wajib** ada sebelum pemakaian produksi pertama, bukan fitur "nanti".

---

## 4. Mengapa auth berbasis password tidak dipakai

Ini keputusan yang lahir langsung dari batas CPU 10 ms.

PBKDF2-SHA256 membutuhkan puluhan hingga ratusan milidetik CPU pada jumlah iterasi yang dianggap layak saat ini. Pada Workers Free, request seperti itu akan diterminasi (Error 1102, `exceededCpu`) sebelum selesai.

Tiga pilihan yang tersedia:

| Pilihan | Masalah |
|---|---|
| Turunkan iterasi sampai muat 10 ms | Hash menjadi cepat ditebak; keamanan hilang |
| Naikkan ke Workers Paid ($5/bulan) | Melanggar batasan "tidak ada layanan berbayar" |
| **Hilangkan password** (ADR-002) | Tidak ada KDF sama sekali; aman karena token berentropi 128–256 bit |

Pilihan ketiga dipakai. Ini **bukan** kompromi keamanan: HMAC-SHA256 atas token 256-bit acak lebih tahan tebak daripada password apa pun yang dipilih manusia.

⚠️ **Perlu diukur di Fase 0**: waktu CPU nyata untuk 1 HMAC + 4 statement D1, untuk memastikan margin 2× terhadap 10 ms.

---

## 5. Google Sheets API

### 5.1 Kuota

| Kuota | Nilai |
|---|---|
| Baca per menit per project | 300 |
| **Baca per menit per user per project** | **60** |
| Tulis per menit per project | 300 |
| **Tulis per menit per user per project** | **60** |
| Batas harian | **tidak ada** (selama kuota per menit dipatuhi) |
| Ukuran payload yang direkomendasikan | ≤ 2 MB per request |
| Waktu proses maksimum per request | 180 detik |
| Batas sel per spreadsheet | **20 juta** (naik dari 10 juta, Sept 2026) |

Sumber: <https://developers.google.com/sheets/api/limits> dan <https://support.google.com/drive/answer/37603>.

### 5.2 Batasan yang mudah terlewat

**Service account dihitung sebagai satu user.** Artinya kuota efektif kita adalah **60 tulis/menit**, bukan 300. Ini yang menentukan desain cron:

- 1 siklus cron = 1 panggilan `batchUpdate` per acara.
- 5 siklus per 5 menit → jauh di bawah 60/menit.
- Satu request batch (beserta sub-request-nya) dihitung sebagai **satu** request — jadi batching sangat menguntungkan.

**Batas 20 juta sel.** Untuk acara 20.000 peserta dengan 8 kolom = 160.000 sel. Sangat aman. Batas ini hanya relevan jika satu spreadsheet dipakai untuk puluhan acara sekaligus — karena itu kita memakai **satu spreadsheet/tab per acara**.

### 5.3 Risiko biaya

Dokumentasi Google menyatakan: *"All standard use of the Google Sheets API is available at no additional cost. Exceeding the quota request limits is planned to incur charges to your Google Cloud billing account later in 2026."*

Artinya:

- Saat ini: gratis.
- Ke depan: **kelebihan kuota bisa ditagihkan.**
- Mitigasi: (a) throttle ketat di bawah 60 tulis/menit; (b) pemantauan 429; (c) fitur `sync_enabled = 0` per acara agar sinkronisasi bisa dimatikan tanpa menghentikan absensi; (d) **jangan pernah** mendaftarkan metode pembayaran di Google Cloud untuk proyek ini, sehingga kelebihan kuota menghasilkan error 429, bukan tagihan.

⚠️ **Perlu diverifikasi saat implementasi**: apakah project Google Cloud tanpa billing tetap mendapat kuota 300/60 per menit atau dikurangi. Uji dengan `POST /sync/test`.

---

## 6. Konfigurasi eksternal yang dibutuhkan

Tidak ada langkah berbayar, tetapi ada langkah **manual** yang harus dilakukan sekali:

| # | Langkah | Di mana | Biaya |
|---|---|---|---|
| 1 | Akun Cloudflare (Free) | dash.cloudflare.com | Gratis |
| 2 | Buat D1 database `absensi-db` → catat `database_id` | Dashboard / `wrangler d1 create` | Gratis |
| 3 | Domain (opsional; `*.workers.dev` cukup untuk awal) | Registrar | Domain berbayar, tapi bukan layanan aplikasi. **`workers.dev` gratis dan sudah HTTPS** — wajib HTTPS karena kamera butuh secure context |
| 4 | Google Cloud project + aktifkan **Google Sheets API** | console.cloud.google.com | Gratis |
| 5 | Buat **service account**, unduh kunci JSON | Google Cloud | Gratis |
| 6 | Share spreadsheet ke email service account sebagai **Editor** | Google Sheets | Gratis |
| 7 | Simpan `GOOGLE_SA_KEY`, `QR_PEPPER`, `QR_ENCRYPTION_KEY`, `QR_KEY_VERSION`, `SESSION_PEPPER` sebagai secret Worker | `wrangler secret put` | Gratis |
| 8 | Repo GitHub + Actions | github.com | Gratis (repo publik/privat dalam kuota free) |

**Secret yang dibutuhkan** (semuanya dibuat sendiri, tidak ada yang dibeli):

| Nama | Isi | Cara membuat |
|---|---|---|
| `QR_PEPPER` | 32 byte acak base64 (HMAC token QR) | `openssl rand -base64 32` |
| `QR_ENCRYPTION_KEY` | base64 dari tepat 32 byte (AES-256-GCM) | `openssl rand -base64 32` |
| `QR_KEY_VERSION` | bilangan bulat ≥ 1; default `1` | Tetapkan `1` sampai ada rotasi |
| `SESSION_PEPPER` | 32 byte acak base64 | `openssl rand -base64 32` |
| `GOOGLE_SA_KEY` | isi `private_key` dari JSON service account | Unduh dari Google Cloud |

`IP_HASH_PEPPER` dapat memakai `SESSION_PEPPER` (domain terpisah via prefix), atau dibuat terpisah bila diinginkan.

**Secret ini tidak boleh berubah sembarangan setelah produksi berjalan.** Mengganti `QR_PEPPER` membuat seluruh QR peserta yang sudah dicetak tidak valid; mengganti `SESSION_PEPPER` mengeluarkan semua pengguna. Mengganti `QR_ENCRYPTION_KEY` hanya aman lewat prosedur rotasi di `docs/OPERASIONAL.md` §7.5 (token dan hash tidak berubah).

---

## 7. Sumber terverifikasi

| Dokumen | URL | Diperbarui |
|---|---|---|
| Workers limits | https://developers.cloudflare.com/workers/platform/limits/ | 29 Okt 2026 |
| D1 limits | https://developers.cloudflare.com/d1/platform/limits/ | 24 Okt 2026 |
| D1 pricing | https://developers.cloudflare.com/d1/platform/pricing/ | 21 Apr 2026 |
| Pages limits | https://developers.cloudflare.com/pages/platform/limits/ | 5 Sep 2026 |
| Workers Static Assets | https://developers.cloudflare.com/workers/static-assets/ | 12 Okt 2026 |
| Sheets API limits | https://developers.google.com/sheets/api/limits | — |
| Drive file limits | https://support.google.com/drive/answer/37603 | — |
| Vitest integration | https://developers.cloudflare.com/workers/testing/vitest-integration/ | Okt 2026 |
| `BarcodeDetector` support | https://caniuse.com/mdn-api_barcodedetector_barcodedetector | — |

---

## 8. Kapan harus naik ke paket berbayar

Sistem ini **tidak** memerlukan Workers Paid untuk beroperasi. Tetapi ada tiga kondisi yang membuat paket berbayar ($5/bulan) menjadi pilihan rasional — dan keputusan itu milik pemilik proyek, bukan agent:

1. **CPU 10 ms terbukti membatasi** setelah pengukuran Fase 0 (bukan spekulasi).
2. **Lebih dari ~5.000 peserta per hari** secara rutin (batas baris tulis D1).
3. **Butuh absensi offline** (memerlukan Durable Objects).

Sampai salah satu terjadi, tetap di Free.
