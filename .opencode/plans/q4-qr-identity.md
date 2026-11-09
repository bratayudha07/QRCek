# Rencana Q4 — QR Identity per Tema

Status: **dibuka 9 November 2026** (API-only). Dokumen ini rencana eksekusi; status implementasi, penyimpangan, dan hasil gate dicatat di bagian akhir setelah dieksekusi.

## 0. Keputusan yang mengikat rencana ini

| Sumber | Isi yang mengikat Q4 |
|---|---|
| `docs/adr/0017-qr-identity-per-theme.md` (Diterima 9 November 2026) | Tabel `qr_identities`; satu baris aktif per `(theme_id, participant_id)`; rotasi in-place; riwayat rotasi di audit; backfill kredensial lama; kolom QR lama dihapus lewat migrasi contract terpisah. |
| `D-004` [A], `FR-004`, `FR-054`, `BR-002` | Satu QR Identity per Tema + Peserta; peserta lintas Tema punya QR terpisah. |
| `FR-055`–`FR-060`, `BR-024`–`BR-028` | Token opaque, acak, tanpa PII; validasi tiap scan; token lama langsung mati setelah rotasi; riwayat transaksi tidak berubah. |
| `FR-061`–`FR-062`, `FR-200`, `BR-029` | QR peserta nonaktif ditolak; rotasi/terbit/ekspor tercatat di audit tanpa token. |
| `FR-063`–`FR-065`, `D-016` [A], `AC-018` | Ekspor PNG individual dan ZIP massal; backend mengotorisasi, browser merender. |
| `D-019` [A], ADR-0003, ADR-0006 | Prefix `absensi:v1:`; `QR_PEPPER` → HMAC lookup, `QR_ENCRYPTION_KEY` → ciphertext cetak ulang; tidak ada plaintext di DB. |
| `D-023` [A], ADR-0008, ADR-0011, `FR-207` | Audit append-only dalam `db.batch()` yang sama; snapshot hanya allowlist. |
| `D-007` [A], ADR-0010 | Migrasi additive; `0001`–`0009` tidak diedit. |
| `NG-01`–`NG-06` | Tidak ada desain kartu/PDF atau mode offline di Q4. |

Keputusan pemilik 9 November 2026 yang mengikat: penerbitan **lazy**, rotasi oleh **Admin Acara Tema itu + Super Admin** dengan **alasan wajib**, kredensial lama **di-backfill**, kolom lama dihapus **setelah** Q4 stabil, QR nonaktif ditolak **saat scan**, dan ekspor ZIP diputuskan di Q4 setelah pengukuran.

Tidak ada dependensi baru untuk verifikasi/rotasi. Keputusan ZIP (library vs store-only manual) dibuat di §9 setelah ukuran diukur, dengan justifikasi satu baris bila memilih library.

## 1. Prasyarat

- Q3 selesai: `0009` live di remote, `app_meta.schema_version = 9` (8 November 2026).
- ADR-0017 Diterima dan AQ-009 ditandai dijawab (9 November 2026).
- Q5/Q6 belum dibuka: Q4 menyiapkan resolver lookup dan endpoint, tetapi **tidak** menulis transaksi atau menegakkan entitlement di jalur scan.

## 2. Tujuan

1. Kredensial QR menjadi entitas nyata per Tema + Peserta, bukan kolom profil.
2. Rotasi token per peserta punya jalur nyata: token lama langsung tidak berlaku, riwayat transaksi tidak berubah, audit tercatat.
3. Backend menyediakan payload cetak/unduh (individual dan batch) dengan otorisasi dan audit jumlah, tanpa membebani Worker.
4. Lookup scan siap dipakai Q5/Q6: satu indeks, scope Tema wajib, peserta nonaktif ditolak.

## 3. Bukan cakupan

- UI ekspor PNG/ZIP final dan pemilihan field label (Q9). Q4 hanya backend + payload + batas batch.
- Penulisan transaksi Attendance/Consumption dan penolakan `NOT_ENTITLED` (Q5).
- Scanner/kiosk, kamera, dan `BarcodeDetector`/ZXing (Q6).
- Migrasi contract penghapusan kolom `participants.qr_*` (tahap terpisah setelah Q4 stabil).
- Cetak label A4/stiker via `window.print()`: **dipertahankan apa adanya** pada Q4; penghapusan/penyederhanaan diputuskan pemilik setelah UI Q9. Tidak ada endpoint baru untuk itu.

## 4. Skema — `migrations/0010_qr_identities.sql`

Additive, `schema_version` menjadi `10`.

### 4.1 Tabel

```sql
CREATE TABLE qr_identities (
  id             TEXT PRIMARY KEY,
  theme_id       TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  token_hash     TEXT NOT NULL CHECK (length(token_hash) = 43),
  ciphertext     TEXT NOT NULL CHECK (length(ciphertext) = 79),
  nonce          TEXT NOT NULL CHECK (length(nonce) = 16),
  key_version    INTEGER NOT NULL CHECK (key_version >= 1),
  issued_at      INTEGER NOT NULL CHECK (issued_at > 0),
  rotated_at     INTEGER,
  rotation_count INTEGER NOT NULL DEFAULT 0 CHECK (rotation_count >= 0),
  CHECK (rotated_at IS NULL OR rotated_at >= issued_at)
);
```

`ON DELETE RESTRICT` disengaja: kredensial tidak boleh hilang diam-diam saat peserta/Tema dihapus; arsip menonaktifkan, bukan menghapus.

### 4.2 Index unik

```sql
CREATE UNIQUE INDEX uq_qr_identity_participant ON qr_identities(theme_id, participant_id);
CREATE UNIQUE INDEX uq_qr_identity_hash ON qr_identities(token_hash);
```

Dua index ini menegakkan aturan di database, bukan di kode: satu baris aktif per Tema + Peserta (`D-004`) dan satu hash = satu identitas (lookup scan deterministik). Tidak ada index parsial karena kedua kolom `NOT NULL`.

### 4.3 Trigger konteks

Pola `0009` (insert + update): `participant_id` wajib milik `theme_id` yang sama (`participants.event_id = qr_identities.theme_id`). Trigger menolak baris lintas Tema; route tetap memvalidasi agar pesan ke admin jelas.

### 4.4 Backfill

```sql
INSERT INTO qr_identities (id, theme_id, participant_id, token_hash, ciphertext, nonce, key_version, issued_at, rotation_count)
SELECT <ulid-ish id>, p.event_id, p.id, p.qr_token_hash, p.qr_token_ciphertext, p.qr_token_nonce, p.qr_key_version, p.qr_issued_at, 0
FROM participants p
WHERE p.qr_token_hash IS NOT NULL
  AND p.qr_token_ciphertext IS NOT NULL
  AND p.qr_token_nonce IS NOT NULL
  AND p.qr_key_version IS NOT NULL
  AND p.qr_issued_at IS NOT NULL;
```

- Hanya kredensial lengkap yang di-backfill; kartu tercetak tetap sah.
- ID memakai `randomblob(16)` (bukan deterministik); idempotensi berasal dari guard `NOT EXISTS` pada pasangan `(theme_id, participant_id)`, sehingga blok aman diulang pada salinan.
- Sebelum apply remote: hitung `COUNT(*)` kandidat; bila >10.000 baris, pecah per Tema atau minta persetujuan pemilik (`COSTS_AND_LIMITS.md`).

## 5. Domain dan akses database

### 5.1 Reuse `domain/qr-token.ts`

Tidak ada perubahan algoritma. Tambahan kecil yang mungkin perlu:

- `buildQrCredential(config, token?)` untuk rotasi dengan token baru (memakai `issueQrCredential` + `readQrCredentialToken` yang sudah ada).
- Tidak ada plaintext yang disimpan atau dilog.

### 5.2 `db/qr-identities.ts`

| Fungsi | Kegunaan |
|---|---|
| `findIdentityByHash(db, tokenHash)` | Lookup scan; join `participants` untuk `status`, `category_id`, `event_id`. |
| `findIdentityForParticipant(db, themeId, participantId)` | Baca identitas + token terdekripsi (untuk cetak/rotasi). |
| `promoteLegacyCredential(db, themeId, participantId)` | Bila baris `qr_identities` belum ada tetapi kolom `participants.qr_*` terisi (jendela deploy atau baris lama), salin satu kali ke tabel baru. Idempoten lewat unique index. |
| `insertIdentity(db, row)` | Penerbitan lazy. |
| `rotateIdentity(db, ...)` | `UPDATE` hash/ciphertext/nonce/key_version, `rotated_at`, `rotation_count + 1`; dipakai bersama `recordAudit` dalam `db.batch()`. |
| `listIdentitiesForLabels(db, themeId, participantIds)` | Batch payload cetak; maksimum `QR_LABEL_BATCH_MAX`. |

Semua query di-scope `theme_id = ?`. Tidak ada lookup lintas Tema.

### 5.3 Resolver scan (siap Q5/Q6)

`findIdentityByHash` + aturan murni:

- Hash tidak ditemukan → `NOT_FOUND`.
- `identity.theme_id !== context.themeId` → `NOT_FOUND` (bukan 403; `AC-015`).
- `participant.status = 'inactive'` → ditolak `FR-061`/`AC-017`.
- Entitlement tetap tanggung jawab Q3/Q5; Q4 tidak menegakkannya.

Aturan status peserta ditaruh di fungsi murni `packages/shared/src/qr.ts` agar bisa diuji tanpa I/O.

## 6. API

### 6.1 Izin

- Tambah action `qr:rotate` di `apps/api/src/domain/permissions.ts`, minimum `event_admin` (Super Admin lolos aturan global). `qr:print` tetap untuk cetak/ekspor.
- Matriks `ACTIONS × ROLES` otomatis menuntut aturan untuk action baru; Petugas tidak boleh merotasi.

### 6.2 Endpoint

| Metode | Path | Izin | Isi |
|---|---|---|---|
| `PUT` | `/api/events/:eventId/participants/:participantId/qr/rotate` | `qr:rotate` | Body `{ reason: string }` (3–500 karakter, wajib). Respons `{ ok, data: { participantId, keyVersion, rotationCount, payload } }`; payload `absensi:v1:<token>` untuk cetak ulang. |
| `POST` | `/api/events/:eventId/participants/qr-labels` | `qr:print` (tetap) | Baseline dipertahankan; sekarang membaca/menulis `qr_identities`. |
| `GET` | `/api/events/:eventId/participants/:participantId/qr` | `qr:print` | Metadata saja (`issuedAt`, `rotatedAt`, `rotationCount`, `keyVersion`), tanpa token. Opsional; dipakai UI Q9. |

`PUT` dipakai sesuai ADR-0017 meskipun setiap panggilan menghasilkan token baru; route tetap wajib `X-Absensi-Csrf: 1` + `Origin`. Body divalidasi di boundary Worker dengan skema `packages/shared`.

Perilaku rotasi:

- Peserta/Tema tidak ada atau lintas Tema → 404.
- Peserta nonaktif **boleh** dirotasi (mencabut kartu yang beredar); scan tetap menolak lewat `FR-061`.
- Tema `archived` menolak mutasi (ADR-0015).
- Audit `qr.identity_rotated` ditulis dalam `db.batch()` yang sama; gagal audit = gagal rotasi.
- Respons boleh memuat payload baru (agar admin bisa langsung mencetak), tetapi audit dan log tidak.

### 6.3 Ekspor batch

- `POST .../participants/qr-labels` tetap jalur utama; respons memuat `payload` per peserta.
- Batas batch final **38** (`QR_LABEL_BATCH_MAX`), diturunkan dari 50 setelah `qr_identities` menambah satu insert per peserta. Diukur dengan `qr-labels.statements.test.ts`: 47 statement saat terbit, 8 reprint, 48 pada jalur lost-race (batas 50).
- Audit `qr.labels_exported` menyimpan `count`, `issued`, `reused`; tanpa token/nama.
- Backend **tidak** merender PNG/ZIP; browser yang merender (Q9). Worker hanya mengembalikan payload.

## 7. Audit

| Action | Kapan | Snapshot allowlist |
|---|---|---|
| `qr.identity_issued` | Penerbitan lazy pertama | `themeId`, `participantId`, `keyVersion` |
| `qr.identity_rotated` | Setiap rotasi | `themeId`, `participantId`, `keyVersion`, `rotationCount`, `reason` (alasan adalah input admin, bukan PII) |
| `qr.labels_exported` | Ekspor batch | `themeId`, `count`, `issued`, `reused` |

Tidak ada token, hash, ciphertext, nonce, nama, email, atau nomor telepon (`FR-207`). Snapshot masuk `packages/shared/src/audit-allowlist.ts` dan diuji.

## 8. Tes wajib

### 8.1 Migrasi/backfill (DB)

- `0001`–`0010` pada DB kosong → `schema_version = 10`, tabel + dua index + dua trigger ada.
- Backfill dari `participants.qr_*` lengkap → satu baris; kredensial tidak lengkap → tidak ada baris.
- Unique `(theme_id, participant_id)` menolak duplikat; unique `token_hash` menolak hash ganda.
- Trigger menolak peserta milik Tema lain.

### 8.2 Murni (`packages/shared`)

- Skema `reason` rotasi: wajib, 3–500, menolak kosong/whitespace.
- `isQrUsable(status)` (atau nama final): aktif boleh, nonaktif ditolak.
- Payload prefix `absensi:v1:` + validasi token; tidak ada PII.

### 8.3 API/otorisasi

- Rotasi tanpa sesi → 401; Petugas → 403; Admin Tema lain → 404/403; Admin Tema itu → 200.
- Rotasi tanpa alasan → 400; alasan terlalu pendek/panjang → 400.
- Rotasi menaikkan `rotation_count`, mengubah `rotated_at`, dan token lama **tidak** lagi ditemukan oleh lookup hash.
- Rotasi tidak mengubah baris `attendance`/transaksi lama (assert jumlah dan isi tidak berubah).
- Audit `qr.identity_rotated` ada, dalam batch yang sama; mutasi gagal tidak menulis audit.
- Ekspor tanpa izin → 403/404; audit hanya jumlah.
- Tema `archived` → 422.

### 8.4 Lookup scan

- Token Tema A di konteks Tema B → tidak ditemukan (`AC-015`).
- Peserta nonaktif → ditolak (`AC-017`).
- Token setelah rotasi → tidak ditemukan (`AC-016`).
- Satu lookup, satu index (`EXPLAIN QUERY PLAN` = `SEARCH`).

### 8.5 Penerbitan lazy dan jendela deploy

- Panggilan cetak pertama membuat baris + audit `qr.identity_issued`; panggilan kedua memakai token yang sama (tidak ada rotasi diam-diam).
- Baris lama dengan kolom `participants.qr_*` tanpa baris `qr_identities` dipromosikan **tanpa** mengganti token (kartu lama tetap sah).
- Dua permintaan paralel untuk peserta yang sama tidak membuat dua identitas (unique index + `ON CONFLICT`/re-read).

### 8.6 Ukuran

- `EXPLAIN QUERY PLAN` lookup hash = `SEARCH ... USING INDEX`.
- Jumlah statement `qr-labels` 50 baris tetap ≤50/invokasi.
- Backfill produksi dihitung sebelum apply dan dicatat.

## 9. Keputusan ZIP (dibuat sebelum implementasi frontend Q9, dicatat di sini)

Opsi: (a) library ZIP kecil dengan justifikasi satu baris; (b) ZIP store-only manual (tanpa kompresi, format lokal sederhana). Ukur ukuran bundle dan CPU render 50 PNG. Karena Q4 tidak merender di Worker, keputusan ini **tidak** memblokir backend; hasil pengukuran dicatat di `.opencode/plans/q9-*.md` atau ADR baru bila mengubah keputusan.

## 10. Berkas baru/berubah

| Berkas | Perubahan |
|---|---|
| `migrations/0010_qr_identities.sql` | Baru: tabel, dua index, dua trigger, backfill, `schema_version = 10`. |
| `apps/api/src/db/qr-identities.ts` | Baru: lookup, promote, insert, rotate, list batch. |
| `apps/api/src/routes/qr-identities.ts` | Baru: rotasi + metadata (dan/atau perluasan `labels.ts`). |
| `apps/api/src/routes/labels.ts` | Baca/tulis lewat `qr_identities`; promote baris lama; audit tetap. |
| `apps/api/src/db/participants.ts` | Hapus/pertahankan pembacaan kolom `qr_*` sesuai jalur promote; jangan hapus kolom. |
| `apps/api/src/domain/permissions.ts` | Tambah `qr:rotate`. |
| `apps/api/src/app.ts` | Daftarkan route baru. |
| `packages/shared/src/qr.ts` | Baru: skema rotasi + aturan status peserta; ekspor di `index.ts`. |
| `packages/shared/src/audit-allowlist.ts` | Tambah field `qr.*`. |
| `docs/DESAIN_API.md`, `docs/DESAIN_DATABASE.md`, `docs/RENCANA_PENGUJIAN.md`, `docs/OPERASIONAL.md`, `docs/IMPLEMENTATION_ROADMAP.md` | Perbarui setelah implementasi. |

## 11. Urutan kerja

1. Migrasi `0010` + tes DB/backfill.
2. `packages/shared/src/qr.ts` + tes murni.
3. `db/qr-identities.ts` (termasuk promote) + tes DB.
4. `permissions.ts` (`qr:rotate`) + route rotasi/metadata.
5. Ubah `labels.ts` ke `qr_identities` + tes API.
6. Tes lookups scan (scope Tema, nonaktif, setelah rotasi).
7. Ukuran: query plan, statement, backfill count.
8. Verifikasi penuh + dokumentasi + gate.

## 12. Perintah verifikasi

```
npm run typecheck
npm run lint
npm run test
npm run build
npm run test -- apps/api/src/test/qr-identity.db.test.ts
npm run test -- apps/api/src/test/qr-identity.api.test.ts
npm run test -- -t "rotasi"
```

Urutan wajib: **typecheck → lint → test → build**. Iterasi pakai tes terfokus; suite penuh di akhir.

## 13. Gate akhir Q4

- `AC-015` (token lintas Tema ditolak), `AC-016` (rotasi membatalkan token lama, riwayat tidak berubah), `AC-017` (QR peserta nonaktif ditolak) — dibuktikan di level resolver/DB/API.
- `AC-018` (unduh PNG/ZIP): **sebagian**. Q4 membuktikan otorisasi, payload, batas batch, dan audit jumlah; rendering PNG/ZIP dan tombol unduh dibuktikan di **Q9**.
- End-to-end scan dengan transaksi target: dibuktikan di **Q5/Q6**; Q4 hanya menyediakan resolver.
- `AC-015`/`AC-017` untuk jalur HTTP scan target belum ada sampai Q5; catat sebagai deferral eksplisit, bukan klaim selesai.
- Gate ditutup hanya setelah verifikasi penuh hijau, migrasi `0010` live, dan review pemilik.

## 14. Rollout

**Urutan wajib: migrasi dulu, deploy kemudian.** Workers Builds otomatis men-deploy push ke
`main`, jadi migrasi harus selesai sebelum push (atau auto-deploy dimatikan sementara). Kode
lama tidak membaca `qr_identities`, jadi migrasi additive aman lebih dulu; urutan sebaliknya
membuat scan/label/rotasi `500` selama jendela deploy.

0. **Eksplisit:** matikan auto-deploy Workers Builds sebelum push (Cloudflare Dashboard →
   Worker `qrcek` → Settings → Builds), lalu nyalakan lagi setelah migrasi + verifikasi.
   Jangan bergantung pada build yang kebetulan masih berjalan.

1. Backup D1 remote sebelum migrasi (`wrangler d1 export` ke `/tmp/opencode/`).
2. Hitung kandidat backfill; catat angkanya.
3. `npm run db:migrate:remote` setelah konfirmasi eksplisit pemilik.
4. Push `main` → Workers Builds deploy.
5. Verifikasi: `schema_version = 10`, tabel/index/trigger ada, jumlah baris backfill = kandidat, `GET /api/health/ready` 200.
6. Smoke dengan sesi produksi: cetak/rotasi peserta uji di Tema uji; token lama ditolak; audit tercatat tanpa token.
7. Jangan menghapus kolom `participants.qr_*` pada rilis ini.

**Realisasi 9 November 2026:** backup 149 KB → kandidat 60 → push `ad02903` → apply `0010`
saat build masih berjalan (02:34 UTC) → build success → `schema_version = 10`, 60 baris,
`mismatched = 0`, health 200. Smoke sesi produksi belum dijalankan pemilik.

## 15. Risiko

| Risiko | Mitigasi |
|---|---|
| Jendela deploy: kode lama menulis kolom lama, kode baru tidak melihatnya | Migrasi dulu baru deploy; promote-on-read sebelum penerbitan baru; unique index mencegah duplikat. |
| Rotasi tidak sengaja (tombol/klik ganda) | Alasan wajib + audit + respons menampilkan `rotationCount`; pertimbangkan konfirmasi UI di Q9. |
| Backfill besar melewati kuota tulis | Hitung kandidat; pecah per Tema bila >10.000 baris. |
| Token bocor lewat log/audit | Allowlist audit; tidak ada token di log; payload hanya di respons berizin. |
| Dua permintaan cetak paralel membuat dua identitas | Unique `(theme_id, participant_id)`; `ON CONFLICT DO NOTHING` lalu baca ulang. |
| ZIP library menambah bundle | Ukur di Q9; fallback store-only manual. |

## 16. Catatan penyimpangan

Diisi setelah implementasi.

1. **Batas batch 50 → 38.** Setelah `qr_identities` diperkenalkan, satu halaman label mengirim
   38 insert + auth/baca/audit. Diukur dengan `qr-labels.statements.test.ts`: **47 statement**
   saat terbit, **8** saat reprint, dan **48** pada jalur lost-race (satu query baca ulang).
   Dengan 38 label masih ada dua statement headroom di bawah batas D1 50/invokasi.
2. **Audit penerbitan lazy digabung per request.** Rencana awal menyebut audit penerbitan;
   implementasi menulis **satu** `qr.identity_issued` berisi `count`, bukan satu baris per
   peserta. Alasan: 38 baris audit tambahan akan melewati anggaran statement. Promosi
   kredensial lama tidak menulis audit per baris; promosi tercatat sebagai `promoted` di
   `qr.labels_exported`.
3. **Guard audit rotasi memakai `token_hash`, bukan `rotation_count`.** Dua rotasi paralel
   sama-sama membaca `rotation_count = 0` dan sama-sama menghitung `next = 1`, sehingga guard
   `rotation_count = 1` juga lolos untuk yang kalah. Guard `WHERE token_hash = ?` hanya lolos
   untuk statement yang benar-benar mendarat; hash dipakai sebagai bind value, tidak masuk baris
   audit.
4. **Rotasi tanpa identitas → `404`, tanpa penerbitan.** Keputusan pemilik: rotasi tidak boleh
   membuat identitas baru secara diam-diam. Kredensial lama pada `participants.qr_*`
   dipromosikan dulu, lalu langsung dirotasi.
5. **Cross-Tema tetap `wrong_event`.** Lookup tidak memakai `not_found` untuk token Tema lain;
   kode hasil baseline dipertahankan dan dibuktikan lewat `decideQrScan`, yang memeriksa scope
   Tema sebelum status peserta. Ini menjaga kompatibilitas UI scan Q6 dan tidak membocorkan
   status peserta Tema lain.
6. **Route rotasi memakai `PUT .../qr/rotate`** (bukan `POST`). Idempotensi retry ditegakkan
   lewat field opsional `expectedRotationCount`: pemanggil mengirim `rotationCount` yang
   terakhir dibaca, dan nilai basi menghasilkan `409` sebelum token baru dibuat. Tanpa field
   itu, permintaan kedua tetap merotasi (perilaku lama). Metadata ada di `GET .../qr`.
7. **Mirror kredensial rotasi ke `participants.qr_*`** dalam batch yang sama, dengan guard
   `token_hash`. Tanpa mirror ini, rollback Worker ke versi pra-`0010` menghidupkan kembali
   token yang baru dicabut. Penerbitan baru tidak di-mirror karena akan melewati anggaran 50
   statement label; konsekuensinya, Worker lama melihat peserta itu "belum punya QR".
8. **Audit `attendance.wrong_event` tidak menyimpan ID lintas Tema.** Snapshot hanya
   `{ outcome: "wrong_theme" }`, `entity_type = scan_attempt`, `entity_id = null`. Admin Tema
   yang melakukan scan dapat membaca audit itu, jadi ID peserta/Tema asal tidak boleh ikut.
9. **Carve-out cetak pada Tema `archived` dipertahankan.** Penerbitan kredensial bukan
   perubahan data bisnis dan acara `archived` tidak menerima absensi, jadi kredensial baru
   tidak dapat menghasilkan transaksi. Rotasi pada Tema `archived` tetap ditolak. Dicatat di
   `docs/DESAIN_API.md` §5.
10. **`qr_identities` tidak punya `updated_at`.** Rotasi memakai `rotated_at` + `rotation_count`;
    tidak ada kolom audit tambahan. Riwayat lengkap ada di `audit_log`.
11. **ZIP tetap diputuskan di Q9.** Q4 tidak menambah dependensi ZIP dan tidak merender PNG di
    Worker; backend hanya mengembalikan payload scan per peserta.
12. **Verifikasi 9 November 2026:** `typecheck` PASS, `lint` PASS, `test` **672 tes di 65
    file** PASS, `build` PASS. Backfill `0010` diuji dengan menjalankan blok `INSERT ... SELECT` dari
    `__MIGRATIONS__` pada baris lama lengkap dan setengah jadi; scan lintas Tema diuji lewat HTTP
    (`wrong_event`, tanpa baris `attendance`). Migrasi `0010` sudah diterapkan remote
    (`schema_version = 10`, 60 baris, `mismatched = 0`) dan Workers Builds `ad02903` success;
    gate Q4 ditutup dengan catatan smoke sesi produksi belum dijalankan pemilik.
