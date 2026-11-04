# RENCANA PENGUJIAN

Tujuan pengujian di proyek ini **bukan** mengejar angka coverage, tetapi membuktikan bahwa aturan yang mudah dilanggar tetap ditegakkan. Setiap aturan di `AGENTS.md` §"Integritas data" dan §"Keamanan" harus punya tes yang **gagal bila aturannya dihapus** (`NFR-018`, `AC-035`).

> **Cara membaca (3 November 2026).** §1–§8 menjelaskan pengujian **baseline** (model `events` datar, commit acuan `157c330`). §9 adalah daftar tes wajib untuk **model target QRCek** dari [`REQUIREMENTS.md`](./REQUIREMENTS.md); tes di §9 belum ada dan ditulis bersama tahap roadmap terkait ([`IMPLEMENTATION_ROADMAP.md`](./IMPLEMENTATION_ROADMAP.md)). Tes baseline yang dipakai ulang tetap wajib lulus sebagai regression test (`D-007` [A], `FR-175`); tes yang perilakunya sengaja diganti (mis. koreksi via `UPDATE`) diganti tes setara di tahap yang sama, tidak dihapus diam-diam.

## Snapshot verifikasi terkini

- Commit acuan `157c330` (3 November 2026, `REQUIREMENTS.md` §0.1): `npm run test` → **458 tes di 48 file** lulus. Angka ini snapshot; hitung ulang dengan `npm run test`.
- Snapshot sebelumnya (2 November 2026): `typecheck` PASS, `lint` PASS, `test` 450 tes di 47 file.
- Integrasi Worker mencakup scan/duplikasi/lintas acara, koreksi dan audit, alur Sheets
  dengan fake client, serta permukaan operasional Fase 6 (`/api/health/ready`,
  `/api/admin/usage`, header keamanan). Klien web memiliki tes pemetaan prefix `/api/calendar`
  dan tes paritas `public/_headers`.
- Pengujian kamera fisik, UI browser end-to-end, dan sinkronisasi ke Google Sheet sungguhan
  belum dibuktikan. Lihat checklist manual §8.

---

## 1. Perkakas

| Lapis | Perkakas | Catatan |
|---|---|---|
| Unit | Vitest (environment `node`) | Fungsi murni di `apps/api/src/domain/`, helper di `packages/shared` |
| Integrasi Worker | `@cloudflare/vitest-plugin` + `cloudflareTest()` | Menjalankan kode di `workerd` dengan binding D1 asli |
| Integrasi SPA | Vitest (environment `node`) | Tes helper/logika murni; tidak ada DOM Testing Library |
| E2E | **Belum ada** | Tidak ditambahkan sebelum tahap roadmap yang membutuhkannya dibuka (kandidat Q6/Q11) |

Catatan: nama paket yang benar adalah **`@cloudflare/vitest-plugin`** (bukan `@cloudflare/vitest-pool-workers`, nama lama), dan memerlukan **Vitest ≥ 4.1**. `AGENTS.md` sudah memakai nama ini.

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
| `domain/qr-token.ts` | Token 256-bit base64url (43 char); payload opaque `absensi:v1:` ditolak untuk versi/panjang lain; hash bergantung pepper; AES-GCM round-trip; nonce unik; ciphertext/nonce cacat ditolak; versi kunci berbeda gagal keras; re-enkripsi rotasi mempertahankan token + hash; konfigurasi secret hilang/invalid gagal, tidak pernah fallback plaintext |
| `web/lib/format.ts` | Konversi datetime-local ↔ UTC memakai zona waktu acara; DST; nilai kosong |
| `web/lib/router.ts` | Semua path kanonis, semua tab acara, path lama (`/acara…`, `/akun`) tetap diparse lalu dipetakan ke URL kanonis, id ter-encode, trailing slash, path tak dikenal |
| `web/lib/navigation.ts` | Navigasi admin vs petugas, label sidebar/bottom, item aktif per route, route → tab acara, id acara hanya di dalam workspace |
| `web/lib/participants.ts` | Query list/ekspor: trim, encoding, cursor, `query=` kosong tidak dikirim |
| `web/lib/qr-labels.ts` | Toggle field menjaga minimal 1/maksimal 4; reorder tidak memutasi input; nilai kosong dibuang; paginasi A4 24/halaman; CSS cetak A4 vs stiker 50 × 30 mm |
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
| I-29 | **`register.scope-zero`** | Akun hasil daftar sendiri adalah `event_admin` tanpa keanggotaan dan tidak bisa membaca acara orang lain (404) | |
| I-30 | **`register.role-injection`** | Payload berisi `role` ditolak 400; tidak ada baris `users` yang tertulis | |
| I-31 | `audit.read-scope` | Admin acara dapat membaca audit acaranya; petugas ditolak; respons tidak memuat hash IP/token | Route nyata + D1 |
| I-32 | `attendance.export` | Admin dapat mengunduh CSV terfilter; petugas ditolak | Periksa status, MIME, header, isi CSV |
| I-31 | `register.rate-limit` | Pendaftaran ke-6 dalam 1 jam per IP-hash → 429, tanpa penulisan | |
| I-32 | `register.creates-owner` | Admin baru membuat acara → baris acara + keanggotaan `event_admin` dalam satu batch | |
| I-33 | **`turnstile.fail-closed`** | Token kosong / HTTP error / fetch throw → registrasi ditolak; tidak ada penulisan | |
| I-34 | `health.ready` | `SELECT 1` sukses → 200 `ready`; D1 melempar error → 503 `DB_UNAVAILABLE` (bukan 500) | Stub `env.DB` yang melempar |
| I-35 | **`usage.superadmin-only`** | `event_admin`/`officer` → 403; superadmin → 200 dengan hitungan; `pending`+`inflight` dihitung sebagai `queued` | Route nyata + D1 |
| I-36 | `security.headers` | Header keamanan ikut pada respons sukses, error, 404, dan CSV; `public/_headers` identik dengan `SECURITY_HEADERS` | Assert header + tes paritas file |

#### Status historis per akhir Tahap 3

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
| I-01…I-07, I-17…I-23 | **Sudah memiliki cakupan pada implementasi saat ini** | Tabel ini merekam keadaan akhir Tahap 3; lihat tes terkini di `apps/api/src/test/` dan snapshot di atas. |

#### Status historis per akhir Tahap 4

Kredensial QR dan label menambah tes berikut (semua **PASS**):

| Area | Tes | File |
|---|---|---|
| Domain | Format token/payload, hash, AES-GCM, nonce, versi kunci, rotasi, konfigurasi secret | `qr-token.test.ts` |
| API | Terbit untuk semua peserta aktif; hanya kolom terenkripsi yang tersimpan | `labels.api.test.ts` |
| API | 401 tanpa sesi, 403 untuk `officer`, 404 lintas acara, id acara lain diabaikan | `labels.api.test.ts` |
| API | Peserta nonaktif tidak pernah menerima kredensial | `labels.api.test.ts` |
| API | **Cetak ulang menghasilkan `qr` identik** dan tidak menulis ulang kredensial | `labels.api.test.ts` |
| API | CSRF header + `Origin` wajib pada `POST` | `labels.api.test.ts` |
| API | Paginasi kursor tanpa duplikat/kehilangan; batas 50; cursor rusak → 400 | `labels.api.test.ts` |
| API | Audit `qr.labels_exported` tanpa token/hash/ciphertext | `labels.api.test.ts` |
| API | Konfigurasi: default, simpan urutan, sembunyikan nilai kosong, tolak field asing/duplikat/>4, `officer` read-only, `archived` → 422 | `labels.api.test.ts` |
| DB | Kolom QR nullable; unique hash; `CHECK` panjang/versi; klaim sekali; import tidak merotasi; audit append-only | `qr.db.test.ts` |
| DB | Daftar migrasi memuat QR, attendance, sync, audit, dan self-signup | `db.integration.test.ts`, `qr.db.test.ts` |
| Web | Helper field/paginasi/CSS cetak | `apps/web/src/lib/qr-labels.test.ts` |

**NOT RUN (butuh browser/perangkat):** tampilan visual halaman label, perilaku `window.print()`,
page break fisik, ukuran QR di kertas, pembacaan QR hasil cetak oleh kamera HP, serta keyboard
dan reduced-motion pada halaman label. Tidak ada jsdom/testing-library/Playwright di proyek ini
(AGENTS.md: E2E belum dibuka), jadi semua itu masuk checklist manual §8, bukan tes otomatis.

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
| Route publik dibatasi tepat 5 (health, health/ready, activate, register, recover) | `authz.unauthenticated.test.ts` |
| Readiness: `SELECT 1` sukses → 200, D1 error → 503 `DB_UNAVAILABLE` | `ops.test.ts` |
| `/api/admin/usage` superadmin-only; hitungan outbox `queued`/`failed`/`dead` | `ops.test.ts` |
| Header keamanan pada respons sukses, error, dan 404 API; paritas `_headers` ↔ `SECURITY_HEADERS` | `ops.test.ts`, `apps/web/src/lib/security-headers.test.ts` |
| Pendaftaran mandiri: sesi + kode pemulihan, peran tidak bisa dipilih, isolasi acara, rate limit | `auth.register.test.ts` |
| Turnstile gagal-tertutup dan tidak memanggil jaringan saat token kosong | `turnstile.test.ts` |
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

### 5.1 Matriks otorisasi baseline (dieksekusi sebagai tes parametrik)

Sumber kebenaran tunggal: `domain/permissions.ts`. Tes mengiterasi matriks ini, sehingga penambahan route baru tanpa aturan akan gagal.

> Matriks ini menggambarkan **baseline**. Dua baris bertentangan dengan target: "Koreksi absensi" untuk superadmin (`D-006` [A] hanya Admin Acara; kewenangan Super Admin menunggu `D-024` [A]) dan "Buat acara" untuk `event_admin` (baseline ADR-0007 mengizinkan lewat peran global; tabel ini belum memuatnya). Matriks target ditulis ulang di Q1/Q5 setelah AQ-007 dijawab.

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
| Pemakaian lintas acara (`/api/admin/usage`) | ✅ | ❌ | ❌ | ❌ |

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
| `window.print()` dan page break fisik | Perilaku browser + printer; diverifikasi manual |
| Ukuran QR di kertas dan hasil pindainya | Butuh printer dan kamera fisik |
| Tampilan visual halaman label / screenshot | Belum ada jsdom/testing-library; dipertimbangkan saat tahap roadmap yang membutuhkannya dibuka |
| Tampilan visual / screenshot | Belum ada kebutuhan; dipertimbangkan di Q9/Q11 |
| Audio scanner dan kamera depan/belakang | Butuh perangkat fisik; checklist manual di Q6 |

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
    dengan Tab + Enter. Buka `/admin/events/<id>/reports` langsung di layar 320 px → tab aktif
    sudah terlihat tanpa menggeser, dan fade muncul di sisi yang masih punya tab lain.
    Aktifkan tab dengan Enter → fokus tetap di link tab itu (bukan pindah ke konten), sedangkan
    isi halaman kembali ke atas.
12. Reduced motion: aktifkan preferensi sistem → transisi halaman dan indikator tab berhenti.
13. Navigasi antar halaman: scroll kembali ke atas, fokus pindah ke area konten (Tab berikutnya
    masuk ke konten, bukan tertinggal di sidebar), dan `#main-content` tetap jadi target skip link.
    Perubahan tab acara adalah pengecualian: fokus tetap di link tab yang diaktifkan. Setiap tab
    acara juga hanya punya **satu** `h1` (tersembunyi secara visual, terbaca screen reader) — tidak
    ada bar judul kedua yang mengulang nama tab.
14. Label A4: pilih 30 peserta → pratinjau → cetak. Periksa 24 label di halaman pertama, 6 di
    halaman kedua, tidak ada label terpotong di batas halaman, dan margin 8 mm konsisten.
15. Label stiker 50 × 30 mm: cetak satu halaman per label; ukur dengan penggaris (lebar 50 mm,
    tinggi 30 mm) dan pastikan QR + quiet zone tidak terpotong.
16. Cetak ulang label yang sama dari halaman label → QR identik dengan hasil pertama (bandingkan
    dengan pemindai, bukan dengan mata).
17. Halaman label di HP: daftar peserta, pemilihan, dan tombol cetak tetap bisa dipakai; tidak
    ada kontrol yang tertutup bottom nav.
18. Secret QR sengaja dikosongkan di lokal → pratinjau menampilkan pesan konfigurasi server,
    bukan halaman kosong atau QR rusak.
19. Setelah push ke `main`, tunggu build Workers Builds hijau lalu verifikasi produksi:
    `/api/health` 200, `/api/health/ready` 200, `curl -I` memuat
    `content-security-policy` dan `permissions-policy: camera=(self)`, dan pemindai kamera
    tetap berjalan di HP (CSP tidak memblokir bundle).
20. Buka tab Network setelah rilis header: tidak ada error CSP di console, dan tidak ada
    request ke origin selain origin aplikasi.
21. Command palette: klik pemicu "Cari peserta…" **dan** tekan `Ctrl+K` (atau `⌘K` di Mac)
    membuka panel. Ketik "lap" → muncul "Cari “lap” di Peserta" lalu tab Laporan; panah
    atas/bawah memindah sorotan, Enter membuka, Escape menutup dan fokus kembali ke pemicu.
    Klik latar gelap juga menutup. Saat palette terbuka, `Ctrl+K` tidak mengambil alih input.
22. Ukuran palette di layar 320×568: panel tidak melewati viewport, daftar bisa digulir, dan
    dengan `prefers-reduced-motion` panel muncul tanpa animasi.
23. Sinkronisasi pencarian: cari "budi" dari palette → URL memuat `?q=budi` dan tab Peserta
    terfilter. Ubah kata kunci lewat form di halaman Peserta → URL ikut berubah (`replace`,
    bukan entri riwayat baru). Pindah ke tab Laporan lalu kembali ke Peserta → kata kunci dan
    hasil tetap sama.
24. Blok konteks acara: muat ulang halaman acara dengan jaringan lambat → badge status dan
    baris jadwal tidak menggeser toolbar (skeleton mengisi ruangnya). Ubah status acara di tab
    Ringkasan → badge di atas ikut berubah tanpa reload.

---

## 9. Tes wajib model target QRCek

Daftar ini diturunkan dari `REQUIREMENTS.md` (BR/AC) dan menjadi bagian gate tahap roadmap. Nama tes di sini adalah **perilaku**; nama file ditentukan saat implementasi. Tes yang ditandai **★** adalah tes integritas: wajib ada, wajib gagal bila aturannya dihapus, dan tidak boleh di-`skip`.

Semua keputusan produk D-001…D-024 sudah disetujui `[A]`; AQ arsitektur ditanggapi lewat ADR baru sebelum tahap terkait dibuka.

### 9.1 Konteks, hierarki, dan lifecycle (Q1, penegakan di Q5)

| ID | Tes | Rujukan | Status keputusan |
|---|---|---|---|
| T-001 ★ | Sesi tidak dapat dibuat atau dirujuk di bawah Aktivitas lain / Tema lain | `BR-003`, `AC-003` | `D-003` [A] |
| T-002 ★ | Transaksi pada Aktivitas yang punya Sesi tanpa memilih Sesi ditolak tanpa menulis | `FR-185`, `AC-004` | `D-003` [A] |
| T-003 ★ | Transaksi dengan Sesi yang bukan milik Aktivitas konteks ditolak tanpa menulis | `FR-188`, `AC-003` | `D-003` [A] |
| T-004 | Tidak ada inferensi Sesi dari jam: waktu request tidak memengaruhi Sesi yang dipakai | `FR-187`, `AC-044` | `D-003` [A] |
| T-005 | Transisi status Aktivitas dan Sesi: tabel sah/terlarang lengkap (fungsi murni) | `FR-090`–`FR-092`, `BR-047` | — |
| T-006 | Transaksi pada Aktivitas Draft/Selesai/Diarsipkan dan Sesi Terjadwal/Selesai/Dinonaktifkan/diarsipkan ditolak | `FR-183`, `FR-186`, `BR-071` | `D-010` [A] |
| T-007 ★ | Menonaktifkan/mengarsipkan Aktivitas atau Sesi tidak menghapus maupun me-reversal transaksi historis | `BR-007`, `BR-078`, `AC-005` | — |
| T-008 | Duplikasi Sesi menyalin konfigurasi saja, identitas baru, status Terjadwal, tanpa transaksi | `BR-048` | — |

### 9.2 Peserta, custom field, impor (Q2)

| ID | Tes | Rujukan | Status keputusan |
|---|---|---|---|
| T-020 | Participant ID dibuat sistem, tidak bisa diubah lewat API, unik dalam Tema | `BR-010`, `AC-006` | `D-003` [A] |
| T-021 ★ | Peserta nonaktif ditolak pada check-in dan penukaran; riwayat tetap ada setelah aktivasi ulang | `BR-011`, `BR-012`, `AC-007` | — |
| T-022 ★ | Rename/nonaktif/arsip custom field tidak menghapus nilai tersimpan | `BR-013`–`BR-015`, `AC-008` | — |
| T-023 | Perubahan tipe custom field yang tidak kompatibel ditolak | `BR-016` | — |
| T-024 ★ | Impor tanpa konfirmasi admin tidak menulis/memperbarui peserta | `BR-061`, `AC-010` | — |
| T-025 | External Reference cocok banyak kandidat → tidak ada pemilihan/merge otomatis | `BR-063`, `AC-009` | `D-008` [A] |
| T-026 | Nama/email/phone sama → warning, bukan merge | `AC-042` | `D-008` [A] |
| T-027 | Field CSV kosong tidak menghapus nilai yang ada kecuali admin memilih menghapus | `BR-077`, `AC-054` | `D-008` [A] |
| T-028 | > 2 MB atau > 1.000 baris data (header tidak dihitung) ditolak dengan pesan actionable | `BR-076` | `D-020` [A] |

### 9.3 Entitlement (Q3, penegakan di Q5)

| ID | Tes | Rujukan | Status keputusan |
|---|---|---|---|
| T-040 ★ | Resolver: lima tingkat prioritas × Inherit/Allowed/Denied (tes tabel, murni) | `BR-018`, `BR-023`, `AC-011` | `D-005` [A] |
| T-041 | Override Sesi hanya berlaku untuk Sesi itu | `BR-023` | `D-005` [A] |
| T-042 | Perubahan aturan kategori tidak menghapus override individual | `BR-020`, `AC-014` | `D-005` [A] |
| T-043 ★ | Peserta tanpa entitlement ditolak dan tidak menghasilkan transaksi berhasil | `BR-022`, `AC-013` | — |
| T-044 ★ | Perubahan entitlement tidak mengubah atau me-reversal transaksi sukses yang sudah ada | `BR-075`, `AC-043` | `D-005` [A] |
| T-045 | Aktivitas baru tidak memakai Theme default sebagai konfigurasi final per kategori | `BR-019`, `AC-012` | `D-005` [A]; mekanisme menunggu AQ-005 |

### 9.4 QR Identity (Q4)

| ID | Tes | Rujukan | Status keputusan |
|---|---|---|---|
| T-060 ★ | QR Tema A ditolak di konteks Tema B, tanpa menulis transaksi | `D-004`, `AC-015` | `D-004` [A] |
| T-061 ★ | Setelah rotasi, token lama langsung ditolak; riwayat transaksi tidak berubah; audit rotasi tercatat tanpa token | `BR-027`–`BR-029`, `AC-016` | `D-004` [A] |
| T-062 | QR peserta nonaktif ditolak | `FR-061`, `AC-017` | — |
| T-063 ★ | Permintaan data token tanpa izin ditolak (403/404); respons tidak memuat hash/ciphertext | `FR-200` | — |
| T-064 | Ekspor QR tercatat di audit dengan jumlah, bukan token | `FR-062`, `FR-135` | — |

### 9.5 Transaksi Attendance dan koreksi (Q5)

| ID | Tes | Rujukan | Status keputusan |
|---|---|---|---|
| T-080 ★ | Scan kedua pada ruang lingkup yang sama → hasil duplikat, jumlah transaksi efektif tetap 1 | `BR-032`, `AC-020` | `D-006` [A] |
| T-081 ★ | Dua scan paralel pada ruang lingkup sama → tepat satu sukses; diulang ≥ 50 kali tanpa flakiness | `BR-033`, `FR-165` | — |
| T-082 | Scan Sesi berbeda pada Aktivitas sama diterima bila berhak | `FR-069`, `AC-020` | — |
| T-083 ★ | Duplikasi ditegakkan oleh constraint DB: insert langsung lewat `env.DB` yang melanggar ruang lingkup efektif gagal | `FR-075`, `FR-165` | `D-006` [A] |
| T-084 ★ | Petugas memanggil Reversal/Adjustment → 403, termasuk atas transaksinya sendiri; tidak ada perubahan data | `BR-036`, `AC-023` | `D-006` [A] |
| T-085 ★ | Reversal tanpa alasan ditolak; dengan alasan: transaksi asli tetap ada, efek dibatalkan, audit dalam batch yang sama | `BR-037`, `BR-038`, `AC-022` | `D-006` [A] |
| T-086 ★ | Setelah Reversal, check-in baru yang valid pada ruang lingkup sama diterima | `BR-040`, `AC-045` | `D-006` [A] |
| T-087 ★ | Adjustment mencatat before/after (field allowlist saja) dan tidak menimpa nilai historis | `FR-202`, `AC-041` | `D-006` [A] |
| T-088 | Kewenangan koreksi Super Admin sesuai keputusan `D-024` | `FR-077` | `D-024` [A] |
| T-089 | Manual Entry tercatat dengan source Manual Entry dan aktor; validasi duplikasi sama dengan QR Scan | `BR-034`, `AC-021`, `AC-049` | `D-022` [A] |
| T-090 ★ | Izin legacy `attendance:correct` tidak memberi akses Manual Check-in target | `AC-055` | `OQ-034` [A] |
| T-091 | Result code stabil per kondisi, terpisah dari pesan; hasil pending tidak pernah dilaporkan sukses | `BR-072`, `AC-040` | `D-011` [A] |
| T-092 | Jumlah statement D1 per scan dihitung dan ≤ ambang yang ditetapkan saat Q5 | `NFR-011` | — |

### 9.6 Penugasan Petugas dan scanner (Q6)

| ID | Tes | Rujukan | Status keputusan |
|---|---|---|---|
| T-100 ★ | Petugas tanpa penugasan pada Aktivitas/Sesi ditolak backend walau URL memilih konteks itu | `BR-050`, `FR-190`, `AC-028` | `D-012` [A] |
| T-101 ★ | Pencabutan tugas tidak menghapus transaksi historis Petugas itu | `BR-052` | — |
| T-102 | Kesalahan jaringan dipetakan berbeda dari QR tidak valid (logika murni di `apps/web/src/lib/`) | `BR-056`, `AC-027` | — |
| T-103 | State scanner: terkunci selama feedback, kembali standby, tidak ada antrean offline (logika murni) | `FR-189`, `BR-054`, `AC-048` | `D-012` [A] |
| T-104 | Status scanner tidak hanya warna: setiap state punya teks/ikon (logika murni) | `NFR-022`, `AC-053` | `D-013` [A] |

### 9.7 Konsumsi (Q7)

| ID | Tes | Rujukan | Status keputusan |
|---|---|---|---|
| T-120 ★ | Penukaran melebihi kuota efektif ditolak di database, termasuk dua request paralel | `BR-044`, `AC-024` | `D-006` [A]; kuota `D-014` [A] |
| T-121 | Kuota default Aktivitas, override kategori, override individual; kuota 0 menolak | `BR-043` | `D-014` [A] |
| T-122 | Reversal Consumption mengembalikan kuota | `BR-073`, `AC-046` | `D-014` [A] |
| T-123 ★ | Perubahan entitlement tidak menghapus riwayat penukaran | `BR-045`, `AC-025` | `D-005` [A] |

### 9.8 Audit, laporan, ekspor (Q1 mekanisme, Q8 cakupan)

| ID | Tes | Rujukan | Status keputusan |
|---|---|---|---|
| T-140 ★ | `UPDATE`/`DELETE` pada tabel audit gagal oleh trigger | `BR-058` | ADR-0008 |
| T-141 ★ | Audit tidak memuat token QR, secret, atau nilai field sensitif; perubahan field sensitif tercatat sebagai "berubah" | `BR-079`, `AC-047` | `FR-207` |
| T-142 | Setiap endpoint mutasi menghasilkan ≥ 1 baris audit (iterasi tabel route) | `FR-135`, `FR-170` | `D-023` [A] untuk daftar final |
| T-143 | Petugas ditolak membaca audit; Admin Acara hanya Tema miliknya | `FR-139`, `FR-140` | — |
| T-144 | Ekspor laporan konsisten dengan filter dan tercatat di audit | `BR-059`, `BR-060`, `AC-033` | — |

### 9.9 Keamanan lintas tahap

Tes baseline berikut tetap wajib dan diperluas ke route baru: `authz.unauthenticated` (semua route non-publik → 401), `csrf.header-required`, `csrf.origin-mismatch`, `invite.replay`, `invite.expired`, `authz.cross-event-member` (menjadi lintas Tema), rate limit D1, `error.no-stack-trace`, dan `security.headers`.
