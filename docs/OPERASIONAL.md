# OPERASIONAL — Hasil Spike Fase 0 dan Catatan Lingkungan

Dokumen ini mencatat **hasil pengukuran nyata** Fase 0 dan quirk lingkungan yang tidak terlihat dari kode.

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
| 5 | Migrasi D1 pada database kosong | ✅ **terverifikasi** | 1 file, 3 command, 1 tabel (`app_meta`) |
| 6 | `Set-Cookie` lewat Static Assets | ❌ **belum dapat diverifikasi** | Tidak ada endpoint penerbit cookie di Fase 0 |
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
# 1. deploy
npm run build
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

## 4.3 Skema dipangkas jadi minimal (31 Okt)

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

`app_meta` (key/value + `updated_at`) dipilih supaya pipeline migrasi punya sesuatu
yang nyata untuk diterapkan, dan supaya migrasi fase berikutnya punya jangkar versi.

Konsekuensi yang disengaja:

- Tes `db.integration.test.ts` punya penjaga batas: **gagal** kalau `events`,
  `participants`, `attendance`, `audit_log`, `outbox`, `users`, `staff` muncul.
  Menambah tabel tanpa membuka fasenya kini menghasilkan tes merah, bukan scope creep diam-diam.
- Temuan spike tetap sah karena diuji pada tabel sekali-pakai dengan bentuk dan
  indeks yang identik; yang berubah hanya nama tabelnya.
- `docs/DESAIN_DATABASE.md` §3 tetap menjadi **desain target**, bukan keadaan sekarang.

---

## 6. Migrasi lokal (terverifikasi)

```bash
npm run db:reset:local    # hapus apps/api/.wrangler/state
npm run db:migrate:local  # terapkan 0001_init.sql
npm run db:migrate:local  # "✅ No migrations to apply!" (idempoten)
```

Hasil: 1 tabel aplikasi — `app_meta` (`key`, `value`, `updated_at`) dengan satu baris
awal `schema_version = 1`. Tidak ada tabel bisnis; lihat §4.3.

```bash
# bukti dari database lokal
npx wrangler d1 execute absensi-db --local \
  --command "SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"
# -> app_meta (table), d1_migrations (table)
```

---

## 7. Yang belum diverifikasi dan kapan akan diverifikasi

| Item | Kapan | Cara |
|---|---|---|
| CPU p95 ≤ 5 ms | Setelah deploy pertama (butuh akun Cloudflare) | `wrangler tail`, lihat §2 |
| `Set-Cookie` lewat Static Assets | Fase 1, endpoint `POST /api/auth/activate` | `curl -i` ke Worker ter-deploy, pastikan `Set-Cookie` utuh |
| CI hijau | Setelah repo di-push ke GitHub | Workflow `.github/workflows/ci.yml` sudah ada, belum pernah dijalankan |
| Batas baris import final | Setelah pengukuran CPU | Naikkan `MAX_IMPORT_ROWS` bertahap sambil memantau CPU |

**Repo ini sekarang sudah menjadi git repository** (commit awal `3cb7568`), tetapi
**belum punya remote**, sehingga CI belum dapat dijalankan. Workflow ditulis tetapi
statusnya *belum diverifikasi*.
