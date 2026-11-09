# Rencana Q3 — Entitlement

Status: **dibuka 8 November 2026** (API-only). Dokumen ini adalah rencana eksekusi; status implementasi dan penyimpangan dicatat di bagian akhir setelah dieksekusi.

## 0. Keputusan yang mengikat rencana ini

| Sumber | Isi yang mengikat Q3 |
|---|---|
| `docs/adr/0016-entitlement-resolution.md` (Diterima 8 November 2026) | Satu tabel `entitlement_rules`; resolver murni; default **deny**; lima partial unique index; trigger konteks lintas Tema/Aktivitas/Sesi. |
| `D-005` [A] | Prioritas lima tingkat dan pewarisan future-only. Perubahan aturan tidak mengubah transaksi lama. |
| `FR-037`–`FR-042` | Lima tingkat entitlement, prioritas tetap, Inherit/Allowed/Denied, konfigurasi eksplisit, dan override individual tidak boleh hilang. |
| `FR-199`, `BR-075` | Perubahan entitlement hanya berlaku untuk transaksi berikutnya. |
| `BR-018`–`BR-023` | Aturan pewarisan dan penolakan; `denied` tidak bisa ditimpa tingkat lebih rendah. |
| `FR-040`/`FR-041` (diputuskan 8 November 2026) | Aktivitas `draft` boleh ada; `draft → active` ditolak sampai setiap kategori aktif punya baris. Kategori baru fail-closed, Aktivitas lama di-backfill. Theme default hanya fallback lewat `inherit`. |
| `D-007` [A] | Migrasi additive; `0001`–`0008` tidak diedit. |
| `ADR-0011`, `FR-207`, `D-023` [A] | Audit append-only dalam `db.batch()` yang sama; snapshot hanya allowlist; tanpa nama/email/telepon. |
| `ADR-0015` | Tema `archived` menolak seluruh mutasi, termasuk aturan entitlement. |

Tidak ada dependensi baru. Semua logika murni masuk `packages/shared`; SQL hanya di `apps/api/src/db/`; route tetap tipis.

## 1. Prasyarat

- Q2 live: `0008` sudah diterapkan di remote (`schema_version = 8`, 8 November 2026).
- ADR-0016 Diterima dan AQ-005 ditandai dijawab.
- Q4, Q5, Q6 belum dibuka; Q3 tidak boleh menambah penegakan di jalur scan.

## 2. Tujuan

1. Admin dapat mengonfigurasi lima tingkat entitlement per Tema tanpa UI (API-only).
2. Resolver deterministik, murni, dan cukup murah untuk dipakai jalur scan Q5.
3. Aktivitas tidak bisa diaktifkan sebelum matriks kategori lengkap (`FR-040`/`FR-041`).
4. Perubahan aturan tidak menghapus override individual dan tidak menyentuh riwayat transaksi.

## 3. Bukan cakupan

- Penolakan di endpoint scan dan result code `NOT_ENTITLED` (Q5).
- Tampilan scanner, badge, atau pesan petugas (Q6).
- UI konfigurasi entitlement (Q9). Q3 hanya API.
- Salinan entitlement efektif per peserta; sengaja ditolak (ADR-0016 Opsi C).
- Nilai custom field `scope='activity'`. Lihat §14; penyimpanan nilainya menunggu alur penugasan/transaksi Q5 karena belum ada writer di Q3.
- Laporan/analitik entitlement (Q8).
- Kuota konsumsi dan duplikasi transaksi (Q5).

## 4. Skema — `migrations/0009_entitlement_rules.sql`

Additive; tidak menyentuh `0001`–`0008`. `schema_version` menjadi `9`.

### 4.1 Tabel

```sql
CREATE TABLE entitlement_rules (
  id             TEXT PRIMARY KEY,
  theme_id       TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  activity_id    TEXT REFERENCES activities(id) ON DELETE RESTRICT,
  session_id     TEXT REFERENCES activity_sessions(id) ON DELETE RESTRICT,
  participant_id TEXT REFERENCES participants(id) ON DELETE RESTRICT,
  category_id    TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  status         TEXT NOT NULL CHECK (status IN ('inherit','allowed','denied')),
  created_at     INTEGER NOT NULL,
  created_by     TEXT REFERENCES users(id),
  updated_at     INTEGER NOT NULL,
  updated_by     TEXT REFERENCES users(id),
  CHECK (created_at > 0),
  CHECK (updated_at >= created_at),
  CHECK (session_id IS NULL OR activity_id IS NOT NULL),
  CHECK (
    (activity_id IS NULL AND session_id IS NULL
     AND participant_id IS NULL AND category_id IS NULL)          -- Theme default
    OR
    (activity_id IS NOT NULL
     AND ((participant_id IS NOT NULL) <> (category_id IS NOT NULL)))  -- level 1–4
  )
);
```

Tingkat dibaca dari kombinasi kolom, bukan kolom tambahan:

| Tingkat | `activity_id` | `session_id` | `participant_id` | `category_id` |
|---|---|---|---|---|
| Individual–Session | NOT NULL | NOT NULL | NOT NULL | NULL |
| Category–Session | NOT NULL | NOT NULL | NULL | NOT NULL |
| Individual–Activity | NOT NULL | NULL | NOT NULL | NULL |
| Category–Activity | NOT NULL | NULL | NULL | NOT NULL |
| Theme default | NULL | NULL | NULL | NULL |

### 4.2 Index unik

SQLite menganggap `NULL` berbeda di unique index, jadi setiap tingkat memakai partial unique index:

```sql
CREATE UNIQUE INDEX uq_ent_theme_default
  ON entitlement_rules(theme_id)
  WHERE activity_id IS NULL AND session_id IS NULL
    AND participant_id IS NULL AND category_id IS NULL;

CREATE UNIQUE INDEX uq_ent_individual_activity
  ON entitlement_rules(theme_id, participant_id, activity_id)
  WHERE participant_id IS NOT NULL AND activity_id IS NOT NULL AND session_id IS NULL;

CREATE UNIQUE INDEX uq_ent_category_activity
  ON entitlement_rules(theme_id, category_id, activity_id)
  WHERE category_id IS NOT NULL AND activity_id IS NOT NULL AND session_id IS NULL;

CREATE UNIQUE INDEX uq_ent_individual_session
  ON entitlement_rules(theme_id, participant_id, activity_id, session_id)
  WHERE participant_id IS NOT NULL AND activity_id IS NOT NULL AND session_id IS NOT NULL;

CREATE UNIQUE INDEX uq_ent_category_session
  ON entitlement_rules(theme_id, category_id, activity_id, session_id)
  WHERE category_id IS NOT NULL AND activity_id IS NOT NULL AND session_id IS NOT NULL;
```

Query resolver memakai predikat yang sama; setiap cabang `UNION ALL` cocok dengan satu index.

### 4.3 Trigger konteks

`BEFORE INSERT` dan `BEFORE UPDATE OF theme_id, activity_id, session_id, participant_id, category_id`:

- `category_id` harus milik `theme_id` yang sama.
- `participant_id` harus milik `theme_id` yang sama.
- `activity_id` harus milik `theme_id` yang sama.
- `session_id` harus milik `activity_id` yang sama; Aktivitas itu harus milik `theme_id`.
- Baris Theme default tidak boleh punya `activity_id`/`session_id`/`participant_id`/`category_id` (sudah dijaga `CHECK`; trigger menambah pesan yang jelas).

Trigger adalah pertahanan terakhir. Route tetap memvalidasi sebelum menulis agar pesan ke admin jelas.

### 4.4 Backfill Aktivitas lama

Pengecualian migrasi yang disetujui (`FR-040`/`FR-041`):

```sql
INSERT INTO entitlement_rules (
  id, theme_id, activity_id, session_id, participant_id, category_id,
  status, created_at, created_by, updated_at, updated_by
)
SELECT
  lower(hex(randomblob(16))),
  a.theme_id, a.id, NULL, NULL, c.id,
  'allowed',
  CAST(strftime('%s','now') AS INTEGER) * 1000, NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000, NULL
FROM activities a
JOIN categories c ON c.theme_id = a.theme_id
WHERE a.status = 'active'
  AND (
    c.status = 'active'
    OR EXISTS (SELECT 1 FROM participants p WHERE p.category_id = c.id)
  )
  AND NOT EXISTS (
    SELECT 1 FROM entitlement_rules r
     WHERE r.theme_id = a.theme_id
       AND r.activity_id = a.id
       AND r.category_id = c.id
       AND r.session_id IS NULL
       AND r.participant_id IS NULL
  );
```

- Hanya Aktivitas `active`. Aktivitas `draft` sengaja **tidak** di-backfill agar gate `draft → active` tetap bermakna.
- Kategori arsip yang masih punya peserta ikut di-backfill agar `FR-020`/`FR-024` tidak dilanggar saat Q5 menegakkan resolver.
- Backfill tidak menulis audit (migrasi, bukan aksi admin). Dicatat sebagai pengecualian di `docs/DESAIN_DATABASE.md`.
- Jumlah baris backfill dihitung sebelum migrasi dan dicatat di `OPERASIONAL.md`.

## 5. Tipe dan resolver murni

Berkas baru: `packages/shared/src/entitlements.ts` (tipe + resolver + helper kelengkapan murni).

```ts
export type EntitlementStatus = "inherit" | "allowed" | "denied";
export type EntitlementLevel =
  | "individual_session"
  | "category_session"
  | "individual_activity"
  | "category_activity"
  | "theme_default";

export interface EntitlementRule {
  level: EntitlementLevel;
  status: EntitlementStatus;
}

export interface EntitlementContext {
  participantId: string;
  categoryId: string;
  activityId: string;
  sessionId: string | null;
}

export interface EntitlementResult {
  allowed: boolean;
  status: EntitlementStatus;
  decidedBy: EntitlementLevel | null;
}
```

`resolveEntitlement(context, rules)`:

1. Iterasi lima tingkat sesuai prioritas `FR-038`.
2. Lewati tingkat yang tidak relevan: aturan Sesi hanya bila `sessionId` ada.
3. `inherit` melanjutkan ke tingkat berikutnya.
4. `allowed`/`denied` pertama yang menentukan langsung menjadi hasil; `denied` di tingkat lebih tinggi tidak bisa ditimpa.
5. Tidak ada aturan yang menentukan → `{ allowed: false, status: "denied", decidedBy: null }`.
6. Tidak ada I/O di resolver.

Helper murni tambahan:

```ts
export function missingEntitlementCategories(
  activeCategoryIds: readonly string[],
  configuredCategoryIds: readonly string[],
): string[];

export function isEntitlementComplete(...): boolean;
```

## 6. Akses database

Berkas baru: `apps/api/src/db/entitlement-rules.ts`.

- `listRulesForContext(db, context)`: satu statement `UNION ALL`, paling banyak lima baris, cabang Sesi hanya bila `sessionId` ada.
- `listActivityCategoryRules(db, themeId, activityId)`.
- `listSessionCategoryRules(db, themeId, activityId, sessionId)`.
- `listParticipantOverrides(db, themeId, activityId, sessionId?)` dengan batas baris eksplisit.
- `findThemeDefault(db, themeId)`.
- `getEntitlementCompleteness(db, themeId, activityId)`: satu query `NOT EXISTS` untuk kategori aktif yang belum punya baris `category_activity`; kembalikan `{ complete, missingCategoryIds }`.
- Statement insert/update/delete untuk audit batch.

Upsert per sel memakai pola Q2: baca baris existing, lalu insert atau update dengan `updated_at`; unique index menjadi pengaman terakhir. Pelanggaran unik saat balapan → `409`/`422`, bukan `500`.

## 7. API

Route baru; semua `public: false`, dievaluasi di Worker.

### 7.1 Izin

Tambahkan ke `Action` di `apps/api/src/domain/permissions.ts`:

| Action | Membership minimum | Alasan |
|---|---|---|
| `entitlement:read` | `officer` | Petugas boleh melihat aturan/preview, tidak boleh mengubah |
| `entitlement:write` | `event_admin` | Hanya Admin Acara yang mengonfigurasi |

Superadmin tetap lolos lewat aturan global. Petugas tidak pernah boleh menulis, termasuk atas dirinya sendiri.

### 7.2 Endpoint

| Method | Path | Tugas |
|---|---|---|
| `GET` | `/api/events/:eventId/entitlements/default` | Baca Theme default |
| `PUT` | `/api/events/:eventId/entitlements/default` | Upsert Theme default (`allowed`/`denied`; `inherit` ditolak karena tidak ada tingkat di bawahnya) |
| `DELETE` | `/api/events/:eventId/entitlements/default` | Hapus Theme default (hasil resolver menjadi deny) |
| `GET` | `/api/events/:eventId/activities/:activityId/entitlements` | Matriks Aktivitas: Theme default, baris kategori, override Sesi/individual, `entitlementComplete`, `missingCategoryIds` |
| `PUT` | `/api/events/:eventId/activities/:activityId/entitlements/categories` | Batch upsert `category_activity` (maks. 15 baris) |
| `PUT` | `/api/events/:eventId/activities/:activityId/sessions/:sessionId/entitlements/categories` | Batch upsert `category_session` |
| `PUT` | `/api/events/:eventId/activities/:activityId/entitlements/participants/:participantId` | Upsert override individual Aktivitas |
| `DELETE` | `/api/events/:eventId/activities/:activityId/entitlements/participants/:participantId` | Hapus override individual Aktivitas |
| `PUT` | `/api/events/:eventId/activities/:activityId/sessions/:sessionId/entitlements/participants/:participantId` | Upsert override individual Sesi |
| `DELETE` | `/api/events/:eventId/activities/:activityId/sessions/:sessionId/entitlements/participants/:participantId` | Hapus override individual Sesi |
| `GET` | `/api/events/:eventId/activities/:activityId/entitlements/resolve?participantId=&sessionId=` | Preview hasil resolver (untuk verifikasi dan Q9); tanpa PII di log |

Semua path otomatis mendapat alias `/api/calendar` dan `/api/themes` lewat `withEventAliases` (pola Q1/Q2); tidak ada handler duplikat.

### 7.3 Kontrak batch

`PUT .../categories` menerima:

```json
{ "rules": [{ "categoryId": "cat_...", "status": "allowed" }] }
```

Validasi di boundary:

- `rules` 1–15 baris; `categoryId` unik dalam satu request. Batas ini berasal dari 50 statement/invocation D1 (upsert + audit per baris + query kelengkapan); matriks 20 kategori dikirim dalam dua request.
- `status` enum `inherit|allowed|denied`.
- Kategori harus milik Tema dan tidak boleh diarsipkan untuk **penulisan baru**; baris lama untuk kategori arsip tetap dibaca resolver.
- Sesi harus milik Aktivitas dan Tema yang sama.
- Peserta harus milik Tema yang sama.
- Tema `archived` → `409`/`422` read-only (ADR-0015).

Respons mengembalikan aturan tersimpan + `entitlementComplete`/`missingCategoryIds` setelah batch.

### 7.4 Gate `draft → active`

Di handler status Aktivitas, sebelum transisi ke `active`:

1. Panggil `getEntitlementCompleteness`.
2. Bila `missingCategoryIds.length > 0`, tolak `422 BUSINESS_RULE` dengan pesan Indonesia dan daftar kategori yang belum dikonfigurasi.
3. Transisi lain tidak terpengaruh.
4. `POST` Aktivitas tetap membuat `draft`; tidak ada konfigurasi otomatis (`FR-041`).

Kategori baru pada Aktivitas yang sudah `active` **tidak** mematikan Aktivitas. Resolver memberi deny untuk kategori itu sampai baris dibuat; kategori lama tetap berjalan.

### 7.5 Bentuk respons

Ikuti pola `{ ok, data | error }`. Ringkasan matriks minimal:

```ts
{
  activityId,
  entitlementComplete,
  missingCategoryIds,
  themeDefault: { status } | null,
  categories: [{ categoryId, name, status: EntitlementStatus | null }],
  sessions: [{ sessionId, categories: [...], participants: [...] }],
  participants: [{ participantId, status }]
}
```

`name` kategori boleh ada (bukan PII); nama/email peserta tidak dimasukkan ke matriks, hanya `participantId`.

## 8. Audit

- Action: `entitlement_rule.created`, `entitlement_rule.updated`, `entitlement_rule.deleted`.
- Entity type: `entitlement_rule`.
- Snapshot allowlist: `themeId`, `activityId`, `sessionId`, `participantId`, `categoryId`, `status`.
- Tidak ada nama, email, telepon, atau nilai custom field.
- Setiap batch upsert menulis audit per baris dalam `db.batch()` yang sama; bila satu statement gagal, seluruh batch rollback.
- `updated_at` guard mencegah audit ditulis bila mutasi kalah balapan (pola `insertAuditAfterVersionedUpdateStatement`).

## 9. Tes wajib

### 9.1 Resolver murni

- Tabel lima tingkat × tiga status.
- Prioritas: individual-session menang atas category-session, dan seterusnya.
- `denied` di tingkat tinggi tidak bisa ditimpa `allowed` di tingkat rendah.
- `inherit` melanjutkan ke tingkat berikutnya.
- Tanpa aturan → deny (`decidedBy = null`).
- Override Sesi hanya berlaku untuk Sesi itu; Sesi lain memakai aturan Aktivitas.
- `sessionId = null` tidak membaca aturan Sesi.
- Perubahan kategori peserta tidak menghapus/mengubah aturan individual.

### 9.2 Database

- Partial unique: duplikat sel per tingkat → konflik terdefinisi.
- Trigger menolak kategori/peserta/Aktivitas/Sesi dari Tema lain.
- Trigger menolak Sesi yang bukan milik Aktivitas.
- Theme default hanya satu per Tema.
- `ON DELETE RESTRICT` tidak berubah.

### 9.3 API dan otorisasi

- Petugas `GET` boleh; `PUT`/`DELETE` → 403.
- Admin Acara boleh menulis hanya di Tema yang ditugaskan; Tema lain → 404.
- Tema `archived` → read-only.
- Batch >15 baris, `categoryId` duplikat, status invalid → 422 tanpa penulisan.
- Gate `draft → active`: ditolak saat ada kategori aktif belum dikonfigurasi; lolos setelah lengkap.
- Kategori baru setelah aktif: `entitlementComplete = false`, resolver untuk kategori itu deny, kategori lama tetap allowed.
- Audit ditulis dalam batch yang sama; mutasi gagal tidak meninggalkan audit.
- Preview resolve mengembalikan `allowed`, `status`, `decidedBy` yang sama dengan resolver murni.

### 9.4 Mutasi (harus gagal bila aturan dihapus)

- Hapus satu langkah prioritas.
- Ubah default deny menjadi allow.
- Hapus filter `session_id`.
- Hapus pengecualian individual saat kategori berubah.
- Hapus gate kelengkapan `draft → active`.
- Hapus trigger konteks Tema/Sesi.

### 9.5 Pengukuran

- `EXPLAIN QUERY PLAN` untuk query resolver: semua cabang `SEARCH ... USING INDEX`.
- Catat jumlah statement dan baris dibaca untuk satu resolve (target: 1 statement, ≤5 baris).
- Catat jumlah baris backfill `0009`.
- Angka masuk `docs/OPERASIONAL.md` sebelum gate Q3 ditutup.

## 10. Berkas baru/berubah

Baru:

- `migrations/0009_entitlement_rules.sql`
- `packages/shared/src/entitlements.ts`
- `packages/shared/src/entitlements.test.ts`
- `packages/shared/src/schemas/entitlements.ts`
- `apps/api/src/db/entitlement-rules.ts`
- `apps/api/src/routes/entitlements.ts`
- `apps/api/src/test/entitlements.api.test.ts`
- `apps/api/src/test/entitlements.db.test.ts`

Berubah:

- `packages/shared/src/index.ts` (ekspor)
- `packages/shared/src/audit-allowlist.ts` (`entitlement_rule`)
- `apps/api/src/db/audit.ts` (entity type/statement)
- `apps/api/src/domain/permissions.ts` (dua action)
- `apps/api/src/app.ts` (route table)
- `apps/api/src/routes/activities.ts` (gate `draft → active`)
- `apps/api/src/test/permissions.test.ts` (matriks action baru)
- `apps/api/src/test/audit.guarded-write.test.ts` (entitlement)
- `docs/DESAIN_API.md`, `docs/DESAIN_DATABASE.md`, `docs/OPERASIONAL.md`, `docs/RENCANA_PENGUJIAN.md`

## 11. Urutan kerja

1. Migrasi `0009` + tes DB lokal (termasuk backfill pada data lama).
2. Tipe + resolver murni + tes tabel.
3. DB access + query plan + pengukuran.
4. Route baca/tulis + izin + audit.
5. Gate `draft → active` + preview resolve.
6. Tes API, otorisasi, audit, mutasi.
7. Dokumentasi + verifikasi penuh (`typecheck → lint → test → build`).
8. Review pemilik sebelum Q3 ditutup.

## 12. Perintah verifikasi

```bash
npm run db:reset:local
npm run db:migrate:local
npm run typecheck
npm run lint
npm run test
npm run build
```

Tes terfokus selama iterasi:

```bash
npm run test -- packages/shared/src/entitlements.test.ts
npm run test -- apps/api/src/test/entitlements.api.test.ts
npm run test -- apps/api/src/test/entitlements.db.test.ts
```

## 13. Gate akhir Q3

- `AC-011`, `AC-012`, `AC-014`, `AC-043` lulus.
- Resolver murni dengan tabel lima tingkat × tiga status; tanpa I/O.
- `FR-040`/`FR-041` ditegakkan di `draft → active`; kategori baru fail-closed.
- `FR-042`/`AC-014`: perubahan kategori tidak menghapus override individual.
- Query resolve terukur dan tercatat (1 statement, ≤5 baris).
- Backfill `0009` terukur; `schema_version = 9`.
- `typecheck`, `lint`, `test`, `build` lulus.
- Tidak ada UI Q3; UI masuk Q9.

## 14. Risiko dan catatan

1. **Backfill besar.** Jumlah baris = Aktivitas aktif × kategori yang memenuhi syarat. Ukur sebelum migrasi; bila >10.000 baris, pecah per Tema atau minta persetujuan pemilik. D1 free tier 100.000 baris tulis/hari.
2. **Gate kelengkapan vs kategori arsip.** Kelengkapan hanya menghitung kategori `active`. Kategori arsip yang punya peserta tetap punya baris dan tetap resolve, tetapi tidak menghalangi aktivasi.
3. **`inherit` di Theme default.** Ditolak karena tidak ada tingkat di bawahnya; kalau diterima, hasilnya sama dengan deny tetapi membingungkan admin.
4. **Nilai custom field Aktivitas (`FR-033`).** Q3 tidak menambah writer karena belum ada alur penugasan/transaksi. Nilai tetap tidak masuk `participants.attributes_json`; penyimpanan mengikuti penugasan/transaksi di Q5. Ini penyimpangan penjadwalan dari kalimat ADR-0014 ("di Q3"), **disetujui pemilik proyek 8 November 2026** (tunda ke Q5). Saat Q5 dibuka, tabel nilai field Aktivitas dan writer-nya wajib ikut direncanakan; `FR-033` tidak boleh ditutup sebelum itu.
5. **Endpoint matriks bisa besar.** Batasi override individual yang dikembalikan (mis. 200) dan sediakan filter; jangan menarik semua peserta.
6. **Audit batch besar.** D1 membatasi **50 query/statement per invocation**. Satu baris butuh upsert + audit, ditambah query kelengkapan; karena itu batas batch ditetapkan **15 baris** dan harus diukur ulang saat implementasi. Jangan menaikkan batas tanpa menghitung statement dan waktu CPU. Matriks 20 kategori dikirim dua kali.
7. **Resolver dan `category_id` peserta.** Q5 harus membaca kategori terkini peserta; Q3 tidak menyimpan snapshot kategori di aturan individual.

## 15. Rollout

`0009` additive: Worker lama mengabaikan tabel baru, jadi migrasi aman diterapkan sebelum atau sesudah deploy. Urutan yang disarankan:

1. Backup remote (pastikan export sukses).
2. Terapkan `0009` (backfill berjalan).
3. Deploy kode Q3 lewat Workers Builds.
4. Verifikasi `schema_version = 9`, jumlah baris aturan, dan endpoint matriks.

Tidak ada jendela inkompatibilitas seperti `0008` karena tidak ada kolom/trigger yang mengubah tabel lama.

## 16. Catatan penyimpangan

Diisi setelah implementasi. Jangan menulis ulang rencana; catat apa yang berbeda dan mengapa, seperti `.opencode/plans/q2-peserta-kategori-impor.md` §16.

**Status 9 November 2026:** Q3 **selesai (API-only) dan gate ditutup**. `0009` diterapkan di
remote 8 November 2026 (deploy `dc8b8546`, 04:26 UTC; `schema_version = 9`; backfill produksi
**0 baris** karena tabel `activities` kosong). Deploy sukses, health `200 database: ok`,
verifikasi penuh `typecheck` → `lint` → `test` (637 tes / 60 file) → `build` hijau.
`AC-043` tingkat transaksi tetap dibuktikan di Q5 karena Q3 tidak menulis transaksi.

### 16.1 Perbedaan dari rencana

1. **Kelengkapan tidak memakai `COUNT`.** Rencana menyebutkan query hitung (COUNT kategori
   aktif vs baris `category_activity`). Implementasi memakai query anti-`NOT EXISTS` yang
   mengembalikan daftar kategori yang **memanggilnya** belum punya baris
   (`getEntitlementCompleteness` → `missingCategoryIds`). Hasilnya identik untuk gate, lebih
   informatif untuk respons `missingCategoryIds`, dan tetap satu statement. Catatan: ADR-0016
   memakai istilah COUNT; implementasi menurunkannya ke anti-join.
2. **Upsert tanpa `ON CONFLICT`.** Sesuai §6, setiap sel dibaca dulu lalu memakai `INSERT` atau
   `UPDATE ... WHERE updated_at = ?`. Predikat partial unique index tidak perlu diulang di
   `ON CONFLICT`; pelanggaran unik saat balapan ditangkap sebagai `409 CONFLICT`. Pola ini
   dipilih agar audit bisa memakai nilai `before`/`after` yang sudah dibaca dan guard
   `updated_at` bekerja sama seperti Q2.
2. **Error validasi body entitlement menjadi `422 BUSINESS_RULE`, bukan `400`.** `parseJsonBody`
   melempar `400 VALIDATION_ERROR`; handler membungkusnya agar batas 15 baris, `categoryId`
   ganda, dan `inherit` pada Theme default terbaca sebagai kesalahan konfigurasi (§7.3).
3. **`requireMutableEvent` menerima parameter `action` opsional.** Default tetap
   `"event:update"`; mutasi entitlement memakai `"entitlement:write"` tanpa menduplikasi guard.
4. **Matriks memakai beberapa query, bukan satu `listActivityRules`.** Setelah implementasi awal,
   query tunggal menarik semua override individual tanpa batas. Matriks sekarang memakai
   `listActivityCategoryRules`, `listSessionCategoryRulesForActivity`,
   `listParticipantOverrides` (limit 200), dan `listSessionParticipantOverrides` (limit 200):
   8 statement per matriks, tetap di bawah 50. `listActivityRules` dihapus agar tidak ada jalur
   tanpa batas.
5. **Backfill diukur pada fixture representatif, bukan data produksi (saat implementasi).**
   Angka 40 baris berasal dari salinan SQLite `0001`–`0008` + seed (e1/a1=16, e1/a2=16,
   e2/b1=8); database lokal kosong menghasilkan 0 baris. **Setelah apply remote 8 November
   2026:** kandidat dan hasil backfill produksi **0 baris** (tabel `activities` kosong); lihat
   §16.3 dan `docs/OPERASIONAL.md` §6.1.
6. **Tes audit tidak boleh bergantung urutan `created_at`.** Beberapa baris audit ditulis pada
   milidetik yang sama dan `id` ULID memuat komponen acak; tes membandingkan himpunan aksi atau
   memilih baris berdasarkan `action`, bukan posisi. Ini memperbaiki flakiness, bukan
   melonggarkan aturan.

### 16.2 Hasil uji mutasi

Enam guard diuji dengan merusak kode sementara; keenamnya **tertangkap**:

| Mutasi | Tes yang gagal |
|---|---|
| Hapus `category_activity` dari tabel prioritas | `packages/shared/src/entitlements.test.ts` |
| Ubah default deny menjadi allow | `packages/shared/src/entitlements.test.ts` |
| Hapus pelewatan tingkat Sesi saat `sessionId = null` | `packages/shared/src/entitlements.test.ts` |
| Hapus tingkat `individual_activity` | `entitlements.api.test.ts` — override individual |
| Hapus gate kelengkapan `draft → active` | `entitlements.api.test.ts` — gate |
| Hapus trigger konteks `BEFORE INSERT` | `entitlements.db.test.ts` — kategori lintas Tema |

### 16.3 Yang belum diverifikasi

- CPU produksi route matriks/batch (wall-clock lokal bukan CPU tertagih). Dicatat sebagai item
  `docs/OPERASIONAL.md` §8 "CPU produksi route entitlement" dan diukur via `wrangler tail`
  setelah trafik nyata.
- Penolakan transaksi `NOT_ENTITLED` dan `FR-033` nilai custom field Aktivitas: Q5.

**Sudah diverifikasi (9 November 2026):** `0009` diterapkan remote (`schema_version = 9`),
kandidat + hasil backfill produksi **0 baris**, tabel/index/trigger ada, dan
`GET /api/health/ready` → `200 database: ok` pada deploy `dc8b8546`.
