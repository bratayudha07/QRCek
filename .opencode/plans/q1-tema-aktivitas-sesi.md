# Rencana Q1 — Fondasi Tema → Aktivitas → Sesi (Draf eksekusi, revisi 4 November 2026)

> **Tahap:** Q1 di `docs/IMPLEMENTATION_ROADMAP.md` (status saat ini "Belum dibuka").
> **Aturan:** Jangan eksekusi sebelum gate Q0 terpenuhi, ADR-0009/0010/0011/0012/0013 berstatus **Diterima**, dan roadmap Q1 diubah menjadi "Dibuka" oleh pemilik proyek.
> **PRD:** `docs/REQUIREMENTS.md`. Kebutuhan: `FR-001`–`FR-012`, `FR-090`–`FR-098`, `FR-182`, `FR-194`, `FR-206`; `BR-001`, `BR-003`–`BR-009`, `BR-047`–`BR-049`, `BR-070`, `BR-071`, `BR-078`; acceptance: `AC-001`, `AC-004`, `AC-005`, `AC-050`.
> **Revisi ini menggantikan** draf sebelumnya. Perubahan utama: nama tabel `activity_sessions`, ADR lifecycle baru, alias `/api/themes`, registrasi publik dimatikan + Turnstile dihapus, scope UI = API-only, mapping tes diperbaiki.

## 0. Keputusan yang mengikat rencana ini

| # | Keputusan | Alasan singkat |
|---|---|---|
| 1 | Tabel Sesi bernama **`activity_sessions`**, file `db/activity-sessions.ts` | `sessions` sudah dipakai auth (`0002_auth.sql`) dan `db/sessions.ts` |
| 2 | Model transisi lifecycle ditetapkan lewat **ADR-0012** | REQUIREMENTS hanya menyebut state machine terpisah; edge-nya belum ada sumbernya |
| 3 | **`/api/themes` ditambahkan** sebagai alias eksplisit; `/api/events` tetap kanonik | Web baseline masih memakai `/api/events`; rename penuh ditunda |
| 4 | Q1 **API-only** (tanpa UI Aktivitas/Sesi) | Gate Q1 bersifat struktural; `FR-093` untuk pengguna dicatat sebagai delta ke Q6/Q8/Q9 |
| 5 | Registrasi publik **dimatikan** dan **Turnstile dihapus** | `D-018` [A]; ADR-0007 mewajibkan ADR baru untuk menggantikannya (**ADR-0013**) |
| 6 | `event:create` untuk `event_admin` **tetap** | Perilaku disengaja: Admin Acara undangan boleh membuat Tema baru dan menjadi pemiliknya |

Nomor ADR: **0012** (lifecycle) dan **0013** (registrasi). Catatan "nomor berikutnya 0009" di `docs/DECISIONS.md` adalah stale dan harus diperbaiki.

## 1. Prasyarat (gate Q0) — wajib selesai sebelum implementasi

1. Product owner menyetujui pembukaan Q1.
2. ADR berstatus **Diterima**:
   - ADR-0009 (AQ-001): `events` = Tema Acara.
   - ADR-0010 (AQ-010): migrasi additive `0007_*` dst.
   - ADR-0011 (AQ-014): allowlist audit di `packages/shared`.
   - **ADR-0012 (baru):** tabel transisi lifecycle Aktivitas/Sesi.
   - **ADR-0013 (baru):** registrasi publik nonaktif; menggantikan ADR-0007.
3. Dokumen diselaraskan: `DECISIONS.md` (status ADR, AQ ditandai "Dijawab oleh", nomor berikutnya 0014), `ARCHITECTURE.md` §3/§6, `IMPLEMENTATION_ROADMAP.md` Q1 "Dibuka".
4. `REQUIREMENTS.md` §0.3/§13.3 diperbarui **oleh product owner**, bukan agent.
5. Branch kerja: `git checkout -b q1-foundation`.
6. Verifikasi baseline sebelum menyentuh kode: `npm run typecheck && npm run lint && npm run test` (catat jumlah tes aktual; rujukan lama 458 tes).

## 2. Tujuan

- Sistem merepresentasikan Tema (`events`) dengan banyak Aktivitas dan Sesi, beserta lifecycle terpisah.
- Hierarki Tema → Aktivitas → Sesi enforceable: Sesi hanya di bawah Aktivitas-nya, tidak lintas Tema.
- Lifecycle divalidasi server-side lewat fungsi murni; tidak ada inferensi Sesi dari jam.
- Audit mutasi Tema/Aktivitas/Sesi memakai allowlist field final.
- Registrasi Admin Acara hanya via undangan (`D-018`).
- Regression: tes auth, undangan, dan isolasi acara baseline tetap lulus atau diganti tes setara.

## 3. Bukan cakupan

- Transaksi, entitlement, scanner, peserta/kategori, QR (Q2–Q7).
- UI Aktivitas/Sesi (API-only). `FR-093` dari sisi pengguna dicatat sebagai delta.
- Aktivitas default (shim) tidak dibuat otomatis di Q1; dibawa ke Q5 saat konteks transaksi mulai diwajibkan.
- Rename penuh `events` → `themes` (kanonik tetap `/api/events`).
- Perubahan izin `event:create` (dibiarkan seperti sekarang).

## 4. Skema — `migrations/0007_q1_activities_sessions.sql` (additive)

Aturan: jangan mengedit `0001`–`0006`; tidak ada backfill (`D-007`). Nilai status disimpan **lowercase English**; terjemahan Indonesia hanya di UI/pesan.

```sql
CREATE TABLE activities (
  id               TEXT PRIMARY KEY,
  theme_id         TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  name             TEXT NOT NULL,
  description      TEXT,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('attendance','consumption')),
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','active','completed','archived')),
  location         TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  created_by       TEXT REFERENCES users(id),
  updated_at       INTEGER NOT NULL,
  updated_by       TEXT REFERENCES users(id),
  archived_at      INTEGER,
  CHECK (length(name) BETWEEN 1 AND 120),
  CHECK (description IS NULL OR length(description) <= 500),
  CHECK (location IS NULL OR length(location) <= 200),
  CHECK (created_at > 0),
  CHECK (updated_at >= created_at),
  CHECK ((status = 'archived') = (archived_at IS NOT NULL))
);
CREATE INDEX idx_activities_theme_status ON activities(theme_id, status, sort_order);
CREATE INDEX idx_activities_theme_type   ON activities(theme_id, transaction_type);

CREATE TABLE activity_sessions (
  id          TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  location    TEXT,
  starts_at   INTEGER,
  ends_at     INTEGER,
  status      TEXT NOT NULL DEFAULT 'scheduled'
              CHECK (status IN ('scheduled','in_progress','completed','disabled')),
  archived_at INTEGER,
  created_at  INTEGER NOT NULL,
  created_by  TEXT REFERENCES users(id),
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT REFERENCES users(id),
  CHECK (length(name) BETWEEN 1 AND 120),
  CHECK (location IS NULL OR length(location) <= 200),
  CHECK (starts_at IS NULL OR starts_at > 0),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at),
  CHECK (created_at > 0),
  CHECK (updated_at >= created_at),
  CHECK (archived_at IS NULL OR archived_at > 0),
  CONSTRAINT archived_session_is_finished
    CHECK (archived_at IS NULL OR status IN ('completed','disabled'))
);
CREATE INDEX idx_activity_sessions_activity_status
  ON activity_sessions(activity_id, status, starts_at);
CREATE INDEX idx_activity_sessions_activity_time
  ON activity_sessions(activity_id, starts_at);
```

Catatan desain:

- **Tidak ada `theme_id` denormalisasi** di `activity_sessions`; Tema diturunkan lewat `activity_id` → `activities.theme_id`.
- **`ON DELETE RESTRICT`**, bukan CASCADE: produk hanya mengenal arsip/nonaktif, bukan hapus. Tidak ada endpoint delete Activity/Session.
- `deleteEmptyDraft` di `db/events.ts` harus ditambah syarat `NOT EXISTS (SELECT 1 FROM activities ...)`, supaya event draft yang sudah punya Aktivitas tidak terhapus dan tidak memicu error FK → 500.
- `archived` adalah status operasional **Aktivitas**; untuk **Sesi** arsip adalah `archived_at` terpisah dari status (`FR-206`, `BR-078`).
- Tidak ada `UNIQUE` nama Sesi; duplikasi boleh memakai nama sama.

## 5. Lifecycle — isi ADR-0012

Tabel transisi final ditulis di `packages/shared/src/lifecycle.ts` (pola `EVENT_TRANSITIONS`), validasi konteks di `apps/api/src/domain/lifecycle.ts`.

**Usulan default yang perlu disetujui di ADR-0012:**

| Entitas | Transisi sah | Final |
|---|---|---|
| Aktivitas | `draft → active`, `active → completed`, `completed → archived`, `draft → archived` | `archived` |
| Sesi | `scheduled → in_progress`, `in_progress → completed`, `scheduled → disabled`, `in_progress → disabled`, `completed → archived`, `disabled → archived` | `archived_at` terisi |

Aturan tambahan:

- Tidak ada reopen (`completed → active`, `disabled → scheduled`); koreksi dilakukan dengan membuat Aktivitas/Sesi baru atau duplikasi.
- Aktivitas `active → archived` langsung tidak diizinkan; harus `completed` dulu.
- Arsip Sesi hanya dari `completed`/`disabled`, hanya Admin Acara (`OQ-033` [A]).
- Arsip tidak menghapus, membalik, atau menyembunyikan transaksi historis.
- Status tidak pernah disimpulkan dari `starts_at`/`ends_at`; perubahan status selalu lewat endpoint eksplisit (`FR-187`).
- Duplikasi Sesi: id baru, salin nama/lokasi/jadwal, `status='scheduled'`, `archived_at=NULL`, tanpa transaksi (`FR-094`, `FR-095`, `BR-048`).

## 6. API

Kanonik: `/api/events/:eventId/...`. Alias: `/api/themes/:eventId/...` (dan `/api/calendar/...` yang sudah ada). Alias memakai handler, skema, dan otorisasi yang sama; tidak ada handler duplikat.

```
GET    /api/events/:eventId/activities
POST   /api/events/:eventId/activities
GET    /api/events/:eventId/activities/:activityId
PATCH  /api/events/:eventId/activities/:activityId
POST   /api/events/:eventId/activities/:activityId/status

GET    /api/events/:eventId/activities/:activityId/sessions
POST   /api/events/:eventId/activities/:activityId/sessions
GET    /api/events/:eventId/activities/:activityId/sessions/:sessionId
PATCH  /api/events/:eventId/activities/:activityId/sessions/:sessionId
POST   /api/events/:eventId/activities/:activityId/sessions/:sessionId/status
POST   /api/events/:eventId/activities/:activityId/sessions/:sessionId/archive
POST   /api/events/:eventId/activities/:activityId/sessions/:sessionId/duplicate
```

- Semua route lewat `requireEventAccess` (read → `event:read`, mutasi → `event:update`). Tidak ada action izin baru.
- Setiap handler memvalidasi bahwa `activityId` milik `eventId`, dan `sessionId` milik `activityId`; pelanggaran → 404 tanpa menulis.
- Aktivitas Draft/Selesai/Diarsipkan tetap bisa dibaca; penolakan transaksi baru ditegakkan Q5.
- Respons `{ ok, data | error }` bertipe lewat `packages/shared`.
- Alias didaftarkan eksplisit di `app.ts` (bukan string-replace ad-hoc); tambahkan tes bahwa `/api/events/...` dan `/api/themes/...` memberi hasil identik dan menolak lintas Tema dengan 404.

## 7. Audit (ADR-0011)

- `packages/shared/src/audit-allowlist.ts`:
  - `AUDIT_FIELDS.theme/activity/session` berisi field yang boleh dicatat.
  - `REDACTED = "[REDACTED]"`; field di luar allowlist tidak masuk snapshot, field sensitif dicatat "berubah" tanpa nilai.
- Mutasi Tema/Aktivitas/Sesi menulis `audit_log` **dalam `db.batch()` yang sama** dengan mutasi.
- Entity type: `theme`, `activity`, `session` (panjang 3–32 sesuai CHECK `audit_log`).
- Update memakai pola guard `EXISTS (... WHERE id = ? AND updated_at = ?)` agar audit hanya tertulis bila update benar-benar terjadi.
- Audit tidak boleh memuat token, secret, atau PII.
- Baseline: route events saat ini belum menulis audit; Q1 mulai menulis audit untuk mutasi Tema (event), Aktivitas, dan Sesi.

## 8. Registrasi publik & Turnstile (ADR-0013)

**API**

- Hapus `POST /api/auth/register` dari `authRoutes`; request menjadi 404.
- Hapus handler `register` dan import terkait di `routes/auth.ts`.
- Hapus `RegisterRequestSchema` dan `turnstileToken` dari `packages/shared/src/schemas/auth.ts`.
- Hapus `TURNSTILE_FAILED` dari `packages/shared/src/types.ts`.
- Hapus `apps/api/src/integrations/turnstile.ts` dan `apps/api/src/test/turnstile.test.ts`.
- `created_via='self_signup'` tetap ada di DB untuk data historis; `0006_self_signup.sql` tidak diedit, tidak ada migrasi baru.
- `event:create` untuk `event_admin` tidak berubah.

**Web (pembersihan, bukan fitur baru)**

- Hapus `apps/web/src/pages/register.tsx`, case `register` di `App.tsx`, `paths.register`/parser di `lib/router.ts` (+ `router.test.ts`), tautan daftar di `pages/login.tsx`, `registerAccount` di `lib/auth.ts`, `components/turnstile-widget.tsx`.
- Hapus `VITE_TURNSTILE_SITE_KEY` dari `apps/web/.env.example` dan build env docs.

**Secret & konfigurasi**

- Hapus `TURNSTILE_SECRET_KEY` dari `.dev.vars.example`, `README.md`, `AGENTS.md`, `docs/OPERASIONAL.md`, `.opencode/commands/deploy.md`, `.opencode/agents/security-reviewer.md`.
- Hapus secret dari Cloudflare saat deploy berikutnya (`wrangler secret delete TURNSTILE_SECRET_KEY`), dicatat di `OPERASIONAL.md`.

**Dokumen**

- ADR-0013 baru: `docs/adr/0013-disable-public-self-signup.md`, status Diterima, mencatat ADR-0007 **digantikan**.
- `DECISIONS.md`: baris ADR-0007 → "Digantikan oleh ADR-0013"; tambah baris ADR-0013.
- `ARCHITECTURE.md` §3: status ADR-0007/0013.
- `DESAIN_API.md`: hapus endpoint register + catatan 404.
- `RENCANA_PENGUJIAN.md`: hapus I-29…I-33, perbarui jumlah route publik (5 → 4), tambah tes `AC-050`.
- `REQUIREMENTS.md` tidak disentuh agent; §7.2.4 tetap baseline historis.

**Tes**

- Ganti `auth.register.test.ts` dengan tes: `POST /api/auth/register` → 404, tidak ada baris `users` baru.
- `authz.unauthenticated.test.ts`: route publik tepat 4 (health, health/ready, activate, recover).
- Fixture yang tadinya memakai register (mis. `events.crud.test.ts` "event_admin creates event") diganti memakai alur undangan.
- Tambah tes `AC-050`: admin hanya dibuat via undangan; pencabutan akses mencabut sesi.

## 9. Reuse yang dievaluasi

| Komponen baseline | Strategi Q1 |
|---|---|
| `routes/events.ts` | Tetap; tambah audit; tambah alias themes di `app.ts` |
| `db/events.ts` | Tambah fungsi akses Aktivitas/Sesi; perketat `deleteEmptyDraft` |
| `packages/shared/src/events.ts` | Tetap; tipe baru di file terpisah |
| `packages/shared/src/lifecycle.ts` (baru) | Tabel transisi Aktivitas/Sesi, pola `EVENT_TRANSITIONS` |
| `domain/permissions.ts` | Tidak ada action baru; reuse `event:read`/`event:update` |
| `db/audit.ts` | Pakai allowlist ADR-0011; tambah statement guard untuk update |
| `lib/navigation.ts`, `lib/router.ts` | Tidak berubah (API-only) |
| `test/authz.events.test.ts`, `events.crud.test.ts` | Diperbarui; skenario register diganti undangan |

## 10. Berkas baru/berubah

**Baru**

- `migrations/0007_q1_activities_sessions.sql`
- `apps/api/src/db/activities.ts`, `apps/api/src/db/activity-sessions.ts`
- `apps/api/src/routes/activities.ts`, `apps/api/src/routes/activity-sessions.ts`
- `apps/api/src/domain/lifecycle.ts`
- `packages/shared/src/lifecycle.ts`
- `packages/shared/src/schemas/activities.ts`, `packages/shared/src/schemas/activity-sessions.ts`
- `packages/shared/src/activities.ts`, `packages/shared/src/activity-sessions.ts`
- `packages/shared/src/audit-allowlist.ts`
- `docs/adr/0012-activity-session-lifecycle.md`, `docs/adr/0013-disable-public-self-signup.md`
- Tes: `lifecycle.test.ts`, `activities.test.ts`, `activity-sessions.test.ts`, `themes-alias.test.ts`, `audit-allowlist.test.ts`, `register.closed.test.ts`

**Berubah**

- `apps/api/src/app.ts`, `apps/api/src/routes/events.ts`, `apps/api/src/db/events.ts`, `apps/api/src/db/audit.ts`
- `apps/web/src/App.tsx`, `lib/router.ts`, `lib/router.test.ts`, `lib/auth.ts`, `pages/login.tsx`
- Konfigurasi/dokumen yang tercantum di §8

**Dihapus**

- `apps/api/src/integrations/turnstile.ts`, `apps/api/src/test/turnstile.test.ts`, `apps/api/src/test/auth.register.test.ts` (diganti)
- `apps/web/src/pages/register.tsx`, `apps/web/src/components/turnstile-widget.tsx`

## 11. Tes wajib dan pemetaan yang benar

Gate Q1 memakai `docs/RENCANA_PENGUJIAN.md` §9:

| Tes | Isi | Status Q1 |
|---|---|---|
| `T-001` ★ | Sesi tidak dapat dibuat/dirujuk di bawah Aktivitas atau Tema lain | Wajib |
| `T-005` | Tabel transisi Aktivitas/Sesi sah/terlarang, fungsi murni | Wajib |
| `T-007` ★ | Arsip/nonaktif tidak menghapus atau me-reversal riwayat | Wajib (parsial; penegakan penuh Q5) |
| `T-008` | Duplikasi Sesi menyalin konfigurasi, id baru, status `scheduled` | Wajib |
| `T-140` ★ | `UPDATE`/`DELETE` audit ditolak trigger | Regression |
| `T-141` ★ | Audit tidak memuat token/secret/nilai sensitif | Wajib (mekanisme) |
| `T-142` | Setiap endpoint mutasi menghasilkan ≥ 1 baris audit | Wajib (route Q1) |
| `T-002`, `T-003`, `T-004`, `T-006` | Penegakan transaksi/lifecycle | **Q5**, bukan Q1 |

Tambahan tes Q1:

- Alias `/api/themes` identik dengan `/api/events` dan menolak lintas Tema (404).
- Event draft dengan Aktivitas tidak bisa dihapus.
- `POST /api/auth/register` → 404 dan tidak menulis user.
- `AC-050`: registrasi admin hanya via undangan; cabut akses bekerja.

## 12. Iterasi kerja

1. **Dokumen & gate:** tulis ADR-0012/0013, perbarui DECISIONS/ARCHITECTURE/roadmap, minta persetujuan pemilik.
2. **Migrasi:** `0007` + catat di `DESAIN_DATABASE.md`; `npm run db:migrate:local`.
3. **Shared:** `lifecycle.ts`, skema/tipe Aktivitas & Sesi, `audit-allowlist.ts` + unit test; `npm run typecheck`.
4. **Domain:** `domain/lifecycle.ts` + tabel transisi lengkap; tes terfokus.
5. **DB:** `db/activities.ts`, `db/activity-sessions.ts`, perketat `deleteEmptyDraft`; tes integrasi D1.
6. **Routes:** activities, activity-sessions, alias themes; audit dalam batch yang sama; tes route + authz.
7. **Registrasi/Turnstile:** hapus route, UI, integrasi, secret, tes; tambah tes 404 + AC-050. Commit terpisah dari migrasi.
8. **Dokumen & verifikasi akhir:** DESAIN_API, RENCANA_PENGUJIAN, OPERASIONAL, README, AGENTS; suite penuh + build.

## 13. Perintah verifikasi

```sh
npm run db:migrate:local
npm run typecheck
npm run lint
npm run test -- lifecycle activities activity-sessions themes-alias audit-allowlist events authz.unauthenticated register.closed
npm run test
npm run build
```

Filter Vitest mencocokkan nama file, bukan direktori; jangan memakai `apps/api/src/...` sebagai filter.

## 14. Gate akhir Q1

- `AC-001`, `AC-004` (struktural), `AC-005`, `AC-050`.
- `T-001`, `T-005`, `T-007` (parsial), `T-008`, `T-141`, `T-142` lulus; `T-140` regression lulus.
- Tes integritas gagal bila aturannya dihapus (mis. hapus cek Aktivitas milik Tema → T-001 gagal).
- Audit Tema/Aktivitas/Sesi tertulis dan bebas PII/token; `entity_type` valid.
- Migrasi `0007` tercatat; `0001`–`0006` tidak disentuh.
- Registrasi publik 404; route publik 4; Turnstile tidak lagi dipakai/diminta saat deploy.
- `typecheck` → `lint` → `test` → `build` hijau; jumlah tes aktual dicatat.
- Dokumen diperbarui dalam perubahan yang sama (`AC-038`).
- Tidak ada dependensi baru.
- Delta API-only (`FR-093` dari sisi pengguna) dicatat di roadmap/OPERASIONAL dan dibawa ke Q6/Q8/Q9.

## 15. Risiko dan catatan

- **Nama `sessions`:** jangan pernah membuat tabel/file bernama `sessions`; sudah dipakai auth. Semua kode baru memakai `activity_sessions`/`activity-sessions`.
- **Alias route:** penambahan `/api/themes` harus lewat helper alias, bukan menduplikasi handler. Tes authz harus memastikan tidak ada route publik baru.
- **Hapus event:** FK `RESTRICT` + `deleteEmptyDraft` yang diperketat; tanpa itu, event draft ber-Aktivitas memunculkan 500.
- **T-007 parsial:** Q1 belum punya transaksi; penegakan penuh tetap di Q5. Jangan klaim `AC-005` lebih dari yang diuji.
- **Aktivitas default:** tidak dibuat di Q1. Saat Q5 mewajibkan konteks Aktivitas, acara lama harus punya Aktivitas eksplisit; tidak ada data produksi (`D-007`), tetapi scanner Q6 wajib meminta pemilihan Aktivitas.
- **API-only:** jangan menambah komponen UI Aktivitas/Sesi di Q1; itu Q9/Q6.
- **Mesin dev 4 GB:** iterasi dengan tes terfokus, suite penuh di akhir.
- **ADR-0009:** perlu catatan saat Diterima bahwa shim "1 Aktivitas default" ditunda ke Q5 dan tidak dibuat otomatis di Q1.

## 16. Catatan penyimpangan setelah eksekusi (5 November 2026)

Bagian ini **tidak** menulis ulang rencana. Isinya catatan apa yang berbeda saat dikerjakan dan mengapa, supaya rencana tahap berikutnya tidak mengulang asumsi yang sama.

| # | Rencana | Kenyataan | Sebab / keputusan |
|---|---|---|---|
| 1 | §1.5 branch `q1-foundation` | Dikerjakan langsung di `main` | Alur deploy repo ini adalah Workers Builds dari `main`; branch panjang hanya menunda verifikasi. Bisa diubah bila pemilik proyek ingin review bercabang. |
| 2 | §12.7 penghapusan registrasi sebagai commit terpisah | 1 commit kode + 1 commit dokumen | Perubahan registrasi menyentuh `packages/shared/src/index.ts` yang juga mengekspor modul Q1, sehingga pemisahan akan menghasilkan commit yang tidak lolos `typecheck`. |
| 3 | §11 nama tes `activities.test.ts` / `activity-sessions.test.ts` | `activities.api.test.ts` / `activity-sessions.api.test.ts` | Nama tanpa sufiks sudah dipakai di `packages/shared`. |
| 4 | §8.4 fixture `events.crud.test.ts` diganti alur undangan | Tidak diubah | Tes itu memang tidak pernah memakai registrasi; asumsi rencana salah. |
| 5 | §4 DDL (tidak menyebut `app_meta`) | Migrasi `0007` menulis `schema_version = 7` | `db.integration.test.ts` menguji penanda versi; DDL di rencana kurang satu statement. |
| 6 | Tidak disebut | `requireMutableEvent`: Tema `archived` menolak mutasi anak dengan `422` | Tambahan perilaku saat implementasi. **Belum disetujui lewat rencana**; perlu dikonfirmasi saat review gate atau dihapus. |
| 7 | Tidak disebut | `apps/api/src/test/setup.ts` truncate `activity_sessions` → `activities` → `events` | Diperlukan karena FK `RESTRICT`; tanpa urutan itu tes saling merusak. |
| 8 | Tidak dibahas | Daftar Aktivitas/Sesi tanpa paginasi | Diputuskan dan didokumentasikan di `DESAIN_API.md` §6 "Paginasi dan batas"; penambahan nanti bersifat additive. |

### Hasil uji mutasi (gate §14 "gagal bila aturan dihapus")

Uji dilakukan dengan merusak guard sementara, menjalankan tes terfokus, lalu mengembalikan file (`git checkout -- <path>`).

| Guard | Mutasi | Hasil sebelum perbaikan tes |
|---|---|---|
| Scope Tema (`findActivity`) | `theme_id = ?` → `(theme_id = ? OR 1)` | **Tertangkap** — `activities.api.test.ts` "rejects an activity id from another Tema with 404" gagal (200 ≠ 404) |
| Arsip Sesi hanya dari `completed`/`disabled` | `canArchiveSession` selalu `true` | **Tertangkap** — `activity-sessions.api.test.ts` "archives only a finished or disabled session" gagal (409 ≠ 422) |
| Audit hanya bila mutasi mendarat | guard `updated_at` dihapus dari audit insert | **TIDAK tertangkap** — 25 tes Aktivitas/Sesi tetap lulus |

Temuan ketiga adalah celah nyata: tidak ada tes yang membuktikan audit tidak ditulis saat mutasi kalah balapan. Ditambahkan `apps/api/src/test/audit.guarded-write.test.ts` (5 tes) yang memanggil statement builder langsung dengan `expectedUpdatedAt` basi, lalu mutasi diulang: sekarang **gagal** seperti seharusnya (2 tes merah).

### Sisa pekerjaan Q1

- Review gate oleh pemilik proyek (termasuk konfirmasi perilaku `requireMutableEvent`).
- Migrasi `0007` belum diterapkan di remote.
- `REQUIREMENTS.md` §0.3/§13.3 tetap milik product owner.
