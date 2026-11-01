# RENCANA PENGUJIAN

Tujuan pengujian di proyek ini **bukan** mengejar angka coverage, tetapi membuktikan bahwa aturan yang mudah dilanggar tetap ditegakkan. Setiap aturan di `AGENTS.md` §"Integritas data" dan §"Keamanan" harus punya tes yang **gagal bila aturannya dihapus**.

---

## 1. Perkakas

| Lapis | Perkakas | Catatan |
|---|---|---|
| Unit | Vitest (environment `node`) | Fungsi murni di `apps/api/src/domain/`, helper di `packages/shared` |
| Integrasi Worker | `@cloudflare/vitest-plugin` + `cloudflareTest()` | Menjalankan kode di `workerd` dengan binding D1 asli |
| Integrasi SPA | Vitest + Testing Library | Hanya untuk logika non-visual (format tanggal, mapping error) |
| E2E | **Belum ada** | Dibuka di Fase 6 bila diperlukan |

⚠️ **Koreksi terhadap `AGENTS.md`**: nama paket yang benar saat ini adalah **`@cloudflare/vitest-plugin`** (bukan `@cloudflare/vitest-pool-workers`, yang merupakan nama lama), dan memerlukan **Vitest ≥ 4.1**. `AGENTS.md` sudah diperbarui pada bagian Pengujian.

Konfigurasi minimal `apps/api/vitest.config.ts`:

```ts
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: { setupFiles: ["./src/test/setup.ts"] },
});
```

`setup.ts` menerapkan migrasi ke D1 uji memakai helper `applyD1Migrations` dari `cloudflare:test` (ikuti resep resmi *Tests using D1 with migrations*). ✅ **Terkonfirmasi di Fase 0**: helper bernama `applyD1Migrations` dan diekspor dari `cloudflare:test`, sedangkan sumber migrasi dibaca dengan `readD1Migrations()` dari `@cloudflare/vitest-plugin`.

Dua hal yang tidak terlihat dari dokumentasi dan ditemukan saat implementasi:

1. **`env.DB.exec()` tidak bisa dipakai untuk file migrasi.** `exec()` memecah SQL per baris, sehingga `CREATE TABLE` multi-baris gagal dengan `SQL code did not contain a statement`. Selalu pakai `applyD1Migrations()`.
2. **`readD1Migrations()` dijalankan di config, bukan di dalam test.** Hasilnya di-inject lewat Vite `define: { __MIGRATIONS__: ... }`, karena modul `node:fs` tidak tersedia di dalam `workerd`.

Konfigurasi nyata yang dipakai (perhatikan `wrangler.test.jsonc`, bukan `wrangler.jsonc`, agar `npm run test` tidak menuntut hasil build SPA):

```ts
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations(
  new URL("../../migrations", import.meta.url).pathname,
);

export default defineConfig({
  define: { __MIGRATIONS__: JSON.stringify(migrations) },
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.test.jsonc" } })],
  test: { setupFiles: ["./src/test/setup.ts"] },
});
```

Versi terpasang saat Fase 0: `@cloudflare/vitest-plugin` 1.4.11, Vitest 5.0.5.

---

## 2. Aturan pengujian yang mengikat

1. **Tanpa jam nyata.** Semua waktu di-inject lewat parameter atau `Clock` interface. Tidak ada `Date.now()` langsung di `domain/`.
2. **Tanpa jaringan nyata.** Google Sheets dan Google OAuth selalu di balik interface dan diganti fake di tes. Tes integrasi tidak boleh memanggil `googleapis.com`.
3. **Setiap tes integrasi memakai D1 bersih.** Tidak ada ketergantungan urutan antar tes.
4. **Nama tes = perilaku, bukan nama fungsi.** `"menolak scan kedua untuk peserta yang sama"` — bukan `"test insertAttendance"`.
5. **Tidak ada tes yang dilewati (`skip`) di branch utama.** Kalau fitur belum ada, tesnya belum ditulis.
6. **Tes keamanan wajib mencoba jalur serang**, bukan hanya jalur bahagia.

---

## 3. Unit test — apa yang wajib ada

Target: setiap fungsi murni punya tes tanpa I/O. Daftar minimum:

| Modul | Kasus wajib |
|---|---|
| `domain/csv.ts` | Delimiter `,` dan `;`; BOM; baris kosong; kutip berisi koma; newline di dalam kutip; kutip ganda; CRLF; kutip tidak ditutup; writer meng-escape dan menetralkan formula |
| `domain/participant-import.ts` | `full_name` kosong/kepanjangan; `external_ref` duplikat dalam file; email tidak valid; telepon dinormalisasi (`08xx` → `+628xx`, `+62`, spasi/tanda hubung); header hilang/duplikat/tidak dikenal; batas 1.000 baris |
| `domain/token.ts` | Token 128/256-bit ter-encode base64url; verifikasi hash cocok/tidak; panjang token tidak valid ditolak lebih awal |
| `domain/event-status.ts` | Semua transisi sah; semua transisi terlarang; `archived` tidak bisa dibuka |
| `domain/cursor.ts` | Encode/decode stabil; cursor rusak → `null`; id sebagai tie-breaker |
| `domain/slug.ts` | Normalisasi aksen/tanda baca; fallback; batas panjang; suffix id unik |
| `domain/scan-result.ts` | Pemetaan `changes 1 → present`, `changes 0 → duplicate`, token tak dikenal → `not_found`, acara lain → `wrong_event`, di luar jendela → `event_closed` |
| `domain/backoff.ts` | Urutan delay; batas maksimum 30 menit; jitter dalam rentang; `attempts = 8` → `dead` |
| `domain/attendance-status.ts` | Koreksi `present → excused` sah; `absent → present` sah; nilai tak dikenal ditolak; `reason` < 10 karakter ditolak |
| `domain/permissions.ts` | Matriks peran → aksi (lihat §5) |
| `web/lib/format.ts` | Konversi datetime-local ↔ UTC memakai zona waktu acara; DST; nilai kosong |
| `web/lib/router.ts` | Semua path kanonis, semua tab acara, path lama (`/acara…`, `/akun`) tetap diparse lalu dipetakan ke URL kanonis, id ter-encode, trailing slash, path tak dikenal |
| `web/lib/navigation.ts` | Navigasi admin vs petugas, label sidebar/bottom, item aktif per route, route → tab acara, id acara hanya di dalam workspace |
| `web/lib/participants.ts` | Query list/ekspor: trim, encoding, cursor, `query=` kosong tidak dikirim |
| `shared/schemas/*` | Batas atas/bawah setiap field; field tak dikenal; tipe salah |

Contoh bentuk tes yang baik:

```ts
it("menolak koreksi tanpa alasan yang memadai", () => {
  const r = validateCorrection({ status: "excused", reason: "salah" });
  expect(r.ok).toBe(false);
  expect(r.errors).toContainEqual({ field: "reason", code: "TOO_SHORT" });
});
```

---

## 4. Integration test — Worker + D1

### 4.1 Daftar tes yang wajib ada (dan tes negatifnya)

| ID | Tes | Yang dibuktikan | Cara |
|---|---|---|---|
| I-01 | `scan.present` | Scan pertama mencatat absensi, outbox, dan audit dalam satu batch | Seed peserta → scan → 3 assert pada 3 tabel |
| I-02 | **`scan.duplicate`** | Scan kedua mengembalikan `duplicate`, **tidak** menambah baris | Assert `COUNT(*) = 1` |
| I-03 | **`scan.concurrent`** | Dua scan paralel pada peserta sama → tepat satu `present`, satu `duplicate` | `Promise.all` dua request |
| I-04 | **`scan.cross-event`** | Token peserta acara A dipakai di acara B → `wrong_event`, tidak menulis apa pun | Assert attendance acara B = 0 |
| I-05 | `scan.closed-event` | Status `closed`/di luar jendela → `event_closed` | Ubah `starts_at`/`ends_at` |
| I-06 | `scan.inactive-participant` | Peserta `inactive` → `participant_inactive` | |
| I-07 | **`authz.officer-cannot-correct`** | `officer` memanggil koreksi → 403 + audit `authz.denied` | |
| I-08 | **`authz.cross-event-member`** | Admin acara A mengakses peserta acara B → 404 (bukan 403, agar tidak membocorkan keberadaan) | |
| I-09 | `authz.unauthenticated` | Tanpa cookie → 401 pada **semua** route non-publik | Iterasi tabel route |
| I-10 | **`invite.replay`** | Token undangan dipakai dua kali → percobaan kedua 401 | |
| I-11 | `invite.expired` | Token melewati `expires_at` → 401 | Inject waktu |
| I-12 | **`invite.revoke-kills-sessions`** | Revokasi anggota mencabut sesi aktifnya seketika | Request setelah revoke → 401 |
| I-13 | `recover.rotates-devices` | Pemulihan mencabut semua sesi/kredensial lama | |
| I-14 | **`import.idempotent`** | Import CSV dua kali → jumlah peserta tidak bertambah | |
| I-15 | `import.partial-invalid` | Baris invalid tidak tertulis; nomor baris dilaporkan benar | |
| I-16 | `import.limits` | >2 MB → 413; >1.000 baris → 413 | |
| I-17 | **`audit.immutable`** | `UPDATE`/`DELETE` pada `audit_log` → error dari trigger | Query langsung via `env.DB` |
| I-18 | **`audit.correction-recorded`** | Koreksi menulis `before`/`after` yang benar | |
| I-19 | **`outbox.coalesce`** | 3 koreksi berturut-turut → 1 item outbox | Assert `COUNT(*) = 1` |
| I-20 | `outbox.retry-backoff` | Item gagal mendapat `next_attempt_at` sesuai rumus | Fake clock |
| I-21 | `outbox.dead-after-max` | 8 kegagalan → `dead` | |
| I-22 | `outbox.permanent-error` | Google 404 → langsung `dead`, bukan retry | Fake Sheets client |
| I-23 | `sync.full-resync` | Full resync menulis ulang semua baris + memperbarui `sheet_rows` | Fake client menangkap payload |
| I-24 | **`csrf.header-required`** | POST tanpa `X-Absensi-Csrf` → 403 | |
| I-25 | **`csrf.origin-mismatch`** | `Origin` berbeda → 403 | |
| I-26 | **`rate-limit.activate`** | Percobaan ke-11 dalam 15 menit → 429 + `Retry-After` | |
| I-27 | `error.no-stack-trace` | Error internal tidak membocorkan stack/pesan D1 mentah | |
| I-28 | `pagination.cursor-stable` | Kursor tetap benar saat ada insert baru di antara halaman | |

#### Status implementasi per akhir Tahap 3

Nama tes di bawah adalah file nyata di `apps/api/src/test/`, bukan rencana.

| ID | Status | File / tes |
|---|---|---|
| I-08 | **PASS** | `authz.events.test.ts` → "returns 404 instead of 403 for another event's admin (IDOR)" dan dua tes IDOR invite/revoke; Tahap 3 menambah IDOR peserta di `participants.crud.test.ts` |
| I-09 | **PASS** | `authz.unauthenticated.test.ts` → "rejects every protected route without a session" (iterasi `ROUTES`) |
| I-10 | **PASS** | `auth.activate.test.ts` → "rejects a replayed invite without writing a second user" |
| I-11 | **PASS** | `auth.activate.test.ts` → "rejects an expired invite" |
| I-12 | **PASS** | `authz.events.test.ts` → "revokes the membership and kills the officer's session" |
| I-13 | **PASS** | `auth.recover.test.ts` → "issues a new session and a new recovery code" |
| I-14 | **PASS** | `participants.import.test.ts` → "creates rows only after an explicit confirm and is idempotent" |
| I-15 | **PASS** | `participants.import.test.ts` → "saves valid rows and reports invalid rows with physical line numbers" |
| I-16 | **PASS** | `participants.import.test.ts` → "rejects more than 1,000 data rows with 413" dan "rejects a body larger than 2 MB" |
| I-24 | **PASS** | `authz.unauthenticated.test.ts` → "rejects a state-changing request without the CSRF header" |
| I-25 | **PASS** | `authz.unauthenticated.test.ts` → "rejects a request whose Origin does not match the host" |
| I-26 | **PASS** | `auth.activate.test.ts` → "rate limits repeated attempts per client" (11 → 429 + `Retry-After`) |
| I-27 | **PASS** | `health.test.ts` → "does not leak stack traces on unknown routes" |
| I-28 | **PASS** | `participants.crud.test.ts` → "paginates with an opaque cursor without duplicates" |
| I-01…I-07, I-17…I-23 | **NOT IMPLEMENTED** | Fase 3+ (scan, audit, outbox). Sengaja belum ada |

Tambahan yang tidak ada di daftar awal tetapi diuji karena Tahap 2 dan 3:

| Tes | File |
|---|---|
| Sesi kedaluwarsa / dicabut / dipalsukan / user suspended → 401 | `auth.activate.test.ts` (describe "session lifetime") |
| Revoke sesi milik orang lain → 404 (IDOR) dan sesi korban tetap hidup | `auth.sessions.test.ts` |
| Kode pemulihan dipakai ulang → 401, pesan identik dengan kode tidak dikenal | `auth.recover.test.ts` |
| `recover` mencabut perangkat lama | `auth.recover.test.ts` |
| Rotasi kode pemulihan menghanguskan kode lama | `auth.recover.test.ts` |
| Batas 50 undangan aktif per acara → 422 | `authz.events.test.ts` |
| Undangan yang sudah dipakai tidak bisa dihapus | `authz.events.test.ts` |
| Tidak bisa mencabut akses sendiri → 422 | `authz.events.test.ts` |
| Route publik dibatasi tepat 3 (health, activate, recover) | `authz.unauthenticated.test.ts` |
| Matriks §5.1 lengkap, termasuk aksi baru yang lupa didaftarkan | `permissions.test.ts` |
| Primitif token: base32, normalisasi kode, HMAC, panjang entropi | `token.test.ts` |
| Generator ID: panjang 26, urut secara leksikografis, unik dalam 1 ms | `ids.test.ts` |
| Skema Fase 1 ada, tabel fase berikutnya tidak ada | `db.integration.test.ts` |
| Lifecycle acara lengkap, `archived` final, `active → archived` ditolak | `event-status.test.ts`, `events.crud.test.ts` |
| CRUD acara + otorisasi (superadmin/admin/petugas, lintas acara) | `events.crud.test.ts` |
| Hapus acara hanya draf kosong; selain itu 422 | `events.crud.test.ts` |
| Peserta: create/list/search/pagination/detail/edit/soft-delete/restore | `participants.crud.test.ts` |
| Isolasi peserta antaracara (IDOR) → 404 | `participants.crud.test.ts` |
| Ekspor CSV dapat diimpor ulang; template header-only; PII hanya admin | `participants.crud.test.ts` |
| Impor: header/baris invalid, duplikasi file, `;`, JSON, idempoten, rate limit, archived | `participants.import.test.ts` |
| Parser CSV dan normalisasi telepon/email | `csv.test.ts` |
| Router web, query peserta, konversi zona waktu | `apps/web/src/lib/*.test.ts` |


### 4.2 Bentuk tes integrasi

```ts
import { env } from "cloudflare:workers";
import { exports } from "cloudflare:workers"; // exports.default.fetch() → Worker, tanpa aset statis
import { it, expect, beforeEach } from "vitest";

beforeEach(async () => { await seedEvent(env.DB, { id: "ev1" }); });

it("mengembalikan duplicate pada scan kedua dan tidak menambah baris", async () => {
  const first  = await scan("ev1", tokenPeserta, sesi);
  const second = await scan("ev1", tokenPeserta, sesi);

  expect(first.data.result).toBe("present");
  expect(second.data.result).toBe("duplicate");
  expect(second.data.attendance.checkedInAt).toBe(first.data.attendance.checkedInAt);

  const { results } = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM attendance WHERE event_id = ?")
    .bind("ev1").all();
  expect(results[0].n).toBe(1);
});
```

### 4.3 Tes cron

`scheduled()` diuji langsung dengan `createScheduledController()` dari `cloudflare:test`, sehingga tidak perlu menunggu jadwal nyata.

```ts
const ctrl = createScheduledController({ scheduledTime: new Date(1_730_000_000_000), cron: "*/5 * * * *" });
await worker.scheduled(ctrl, env, ctx);
```

Yang diuji: reklaim item `inflight` macet, housekeeping tidak menghapus data yang masih `pending`, dan cron tidak melempar error saat D1 mengembalikan error.

---

## 5. Tes keamanan

### 5.1 Matriks otorisasi (dieksekusi sebagai tes parametrik)

Sumber kebenaran tunggal: `domain/permissions.ts`. Tes mengiterasi matriks ini, sehingga penambahan route baru tanpa aturan akan gagal.

| Aksi | superadmin | event_admin | officer | anonim |
|---|---|---|---|---|
| Buat acara | ✅ | ❌ | ❌ | ❌ |
| Lihat acara | ✅ | ✅ (acara sendiri) | ✅ (acara sendiri) | ❌ |
| Ubah acara | ✅ | ✅ (acara sendiri) | ❌ | ❌ |
| Hapus acara (draf kosong) | ✅ | ❌ | ❌ | ❌ |
| Undang petugas | ✅ | ✅ | ❌ | ❌ |
| Lihat peserta | ✅ | ✅ | ✅ | ❌ |
| Tambah/ubah/nonaktifkan peserta | ✅ | ✅ | ❌ | ❌ |
| Import peserta | ✅ | ✅ | ❌ | ❌ |
| Ekspor/template peserta | ✅ | ✅ | ❌ | ❌ |
| Cetak label QR | ✅ | ✅ | ❌ | ❌ |
| Scan | ✅ | ✅ | ✅ | ❌ |
| Lihat rekap | ✅ | ✅ | ✅ (ringkas) | ❌ |
| Koreksi absensi | ✅ | ✅ | ❌ | ❌ |
| Baca audit | ✅ | ✅ | ❌ | ❌ |
| Konfigurasi sync | ✅ | ✅ | ❌ | ❌ |

### 5.2 Skenario serangan yang wajib diuji

| Serangan | Ekspektasi |
|---|---|
| Tebak token undangan acak | 401 seragam, tanpa membedakan "tidak ada" vs "kedaluwarsa" |
| Pakai ulang QR undangan yang sudah di-redeem | 401 |
| Pakai QR peserta dari acara lain | `wrong_event`, tidak ada penulisan |
| Pakai QR yang dimodifikasi 1 karakter | `not_found` |
| IDOR: ganti `:id` acara di URL | 404 |
| IDOR: ganti `:id` attendance saat koreksi | 404 |
| Cookie sesi dipalsukan / diubah | 401 (hash tidak cocok) |
| Sesi setelah anggota dicabut | 401 |
| POST lintas-origin tanpa header CSRF | 403 |
| Enumerasi akun lewat pesan error berbeda | Semua pesan autentikasi identik |
| SQL injection di `?query=` pencarian | Ditolak/aman; gunakan parameter terikat, `LIKE` escaping |
| CSV dengan formula (`=HYPERLINK(...)`) | Disimpan sebagai teks, **tidak** dieksekusi; verifikasi `valueInputOption=RAW` saat sync |
| Payload JSON raksasa | 413 sebelum parsing penuh |
| PII di log | Tes memeriksa bahwa output log tidak memuat nama/telepon/token |

### 5.3 Pemeriksaan statis

- `grep` CI: tidak ada `console.log` yang mencetak objek request; tidak ada `process.env`.
- `grep` CI: tidak ada string `SELECT * FROM` tanpa `WHERE` pada tabel ber-`event_id`.
- `grep` CI: tidak ada `UPDATE audit_log` / `DELETE FROM audit_log` di luar modul arsip.
- Secret tidak boleh muncul di bundle: cek `apps/web/dist` tidak memuat nama variabel secret.

---

## 6. Gerbang kualitas (CI)

`.github/workflows/ci.yml` menjalankan, dalam urutan ini:

```
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
```

CI gagal bila salah satu gagal. Tidak ada `--passWithNoTests`, tidak ada `continue-on-error`.

Ambang tambahan yang dicek manual sebelum merge:

| Metrik | Ambang |
|---|---|
| Statement D1 per request (endpoint panas) | ≤ 6 |
| Rows read per request dashboard | ≤ 1.000 |
| CPU time p95 (dari `wrangler tail`/Workers Logs) | ≤ 5 ms (margin 2× terhadap batas 10 ms) |
| Ukuran bundle Worker | ≤ 1 MB (batas platform 64 MiB; margin lebar untuk cold start) |
| Waktu tes penuh | ≤ 90 detik |

---

## 7. Yang TIDAK diuji (dan mengapa)

| Tidak diuji otomatis | Alasan |
|---|---|
| Tampilan kamera nyata di HP | Tidak bisa direproduksi di CI; diuji manual per rilis dengan checklist perangkat |
| `getUserMedia` di iOS Safari | Butuh perangkat fisik |
| Google Sheets sungguhan | Kuota + tidak deterministik; diuji dengan fake, verifikasi manual di staging |
| `window.print()` | Perilaku browser |
| Tampilan visual / screenshot | Belum ada kebutuhan; dibuka di Fase 6 bila perlu |

---

## 8. Uji manual minimal per rilis

Checklist singkat yang dijalankan pada staging sebelum deploy produksi:

1. Aktifkan akun petugas dengan kamera HP Android **dan** iPhone (memvalidasi fallback ZXing).
2. Scan peserta yang sama dua kali → tampil "sudah absen" dengan jam pertama.
3. Scan QR peserta acara lain → pesan "QR bukan untuk acara ini".
4. Matikan kamera izin → aplikasi menampilkan instruksi, bukan crash.
5. Print 10 label QR → pindai hasil cetak (memvalidasi ukuran & koreksi error QR).
6. Koreksi satu absensi sebagai admin → cek baris di sheet berubah, cek audit bertambah.
7. Putus koneksi → scan menampilkan pesan jaringan yang bisa ditindaklanjuti.
8. Sidebar desktop: ciutkan/perluas, tooltip saat ciut, fokus keyboard terlihat, dan lebar konten
   ikut bergeser tanpa melompat.
9. Mobile: bottom nav tidak menutupi konten/aksi utama, aman di perangkat dengan safe-area,
   dan Scan QR adalah aksi yang paling menonjol bagi petugas.
10. Event switcher: pindah acara dari sidebar (desktop) dan strip atas (mobile) → URL memuat id
    acara baru dan tidak ada data acara sebelumnya yang tersisa di layar. Pindah acara saat berada
    di tab Peserta tetap berada di tab Peserta.
11. Event tabs: indikator geser mengikuti tab aktif (bergerak, bukan melompat), kelima tab tetap
    terbaca pada lebar 320 px (scroll horizontal, bukan teks mengecil), dan bisa dioperasikan
    dengan Tab + Enter.
12. Reduced motion: aktifkan preferensi sistem → transisi halaman dan indikator tab berhenti.
13. Navigasi antar halaman: scroll kembali ke atas, fokus pindah ke area konten (Tab berikutnya
    masuk ke konten, bukan tertinggal di sidebar), dan `#main-content` tetap jadi target skip link.
