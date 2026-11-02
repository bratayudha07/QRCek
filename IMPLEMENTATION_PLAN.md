# IMPLEMENTATION_PLAN

Rencana implementasi bertahap untuk Multi-Event Parent Attendance Management System.

**Status diperbarui 2 November 2026:** fondasi dan fitur backend Fase 0–5 sudah banyak
terimplementasi. Auth/acara/peserta/QR, API scan, kehadiran/koreksi, ringkasan/audit write,
dan sinkronisasi Sheets berbasis outbox tersedia. UI scan dan beberapa halaman rekap/audit/
sync masih parsial. Fase 6 **sebagian**: readiness (`/api/health/ready`), pemakaian
(`/api/admin/usage`), security headers, dan kebijakan retensi audit (ADR-008) sudah ada;
perangkat fisik, uji Google Sheet nyata, dan pengukuran CPU produksi belum lengkap. Worker
produksi tersedia; perubahan browser API ke `/api/calendar` masih menunggu deploy. Status
rinci per area di bawah.

Dokumen pendukung: [`AGENTS.md`](./AGENTS.md), [`docs/ARSITEKTUR.md`](./docs/ARSITEKTUR.md), [`docs/DESAIN_DATABASE.md`](./docs/DESAIN_DATABASE.md), [`docs/DESAIN_API.md`](./docs/DESAIN_API.md), [`docs/RENCANA_PENGUJIAN.md`](./docs/RENCANA_PENGUJIAN.md), [`COSTS_AND_LIMITS.md`](./COSTS_AND_LIMITS.md).

---

## Prinsip pelaksanaan

> **Snapshot implementasi terkini (1 November 2026).** Tabel fase dan kriteria di bawah
> awalnya ditulis sebagai rencana; sebagian status checkbox di fase 3–5 sekarang sudah
> terpenuhi oleh kode dan tes meskipun halaman/UI terkait belum lengkap. Backend scan,
> attendance/koreksi, dashboard, audit write, dan Sheets/outbox telah dibuat. `staff-scan.tsx`
> masih belum mengirim hasil pindai ke endpoint; `event-workspace`, aktivitas, staff, dan
> pengaturan sinkronisasi memuat placeholder. Karena itu fase 3–5 dinilai **parsial**, bukan
> selesai end-to-end. Verifikasi visual/perangkat/Google nyata tetap belum dilakukan.

1. **Satu fase = satu PR yang bisa direview habis.** Tidak ada fase yang digabung.
2. **Gerbang fase bersifat keras.** Fase berikutnya tidak dimulai sebelum semua kriteria penerimaan fase sebelumnya terpenuhi dan dibuktikan dengan perintah yang bisa dijalankan ulang.
3. **Tidak ada fitur yang diimplementasikan "sekalian".** Kalau muncul ide di tengah fase, catat sebagai usulan; jangan dikerjakan.
4. **Setiap fase harus meninggalkan repo dalam keadaan hijau**: `typecheck` → `lint` → `test` lulus, dan `build` sukses.
5. **Ukur, jangan tebak.** Setiap klaim performa (CPU, jumlah query, ukuran baris) harus punya angka hasil pengukuran, bukan estimasi di dokumen.

---

## Ringkasan fase

| Fase | Fokus | Fitur yang hidup setelah fase | Perkiraan |
|---|---|---|---|
| 0 | Fondasi & pengukuran | `GET /api/health` | 1–2 hari |
| 1 | Identitas & acara | Login token, buat acara, tugaskan admin | 3–4 hari |
| 2 | Peserta & QR | Import CSV, cetak QR | 3–4 hari |
| 3 | Scan & kehadiran | Absensi berjalan end-to-end | 4–5 hari |
| 4 | Rekap & audit | Dashboard, koreksi ber-otorisasi | 3–4 hari |
| 5 | Google Sheets | Sync idempoten + outbox | 3–4 hari |
| 6 | Hardening & deploy | Produksi | 2–3 hari |

Total: ~20–26 hari kerja efektif. Perkiraan ini mengasumsikan satu orang; tidak mengikat.

---

## FASE 0 — Fondasi, pengukuran, dan gerbang performa

**Tujuan**: membuktikan bahwa platform free tier sanggup menjalankan sistem ini **sebelum** membangun fitur di atasnya. Ini fase yang mencegah seluruh proyek dibangun di atas asumsi yang salah.

> **Status: selesai sebagian.** Build, migrasi lokal, dev loop, typecheck, lint, dan suite tes
> telah diverifikasi pada iterasi sebelumnya. Belum terverifikasi: CPU p95 di Cloudflare dan
> hasil CI GitHub. Auth/session sudah berjalan pada Worker produksi.
> Hasil lengkap: `docs/OPERASIONAL.md`.

### Catatan deviasi dari rencana

| Rencana | Yang dikerjakan | Alasan |
|---|---|---|
| `migrations/0001_init.sql` berisi **skema penuh** | Satu file `0001_init.sql` berisi **satu tabel** `app_meta` | **Keputusan pemilik proyek (31 Okt)**: Fase 0 tidak boleh memuat tabel bisnis (`events`, `participants`, `attendance`, `audit_log`, `outbox`, …). Skema penuh juga bertabrakan dengan aturan "jangan implementasi fitur sebelum fase-nya dibuka". Tabel dibuat per fase; `DESAIN_DATABASE.md` §3 tetap desain target. Lihat `docs/OPERASIONAL.md` §4.3 |
| `apps/api/src/test/bench.test.ts` | `apps/api/src/test/spike.measure.test.ts` + `npm run bench` | Nama file mengikuti pola `spike.*.test.ts` agar jelas mana tes gerbang dan mana spike |
| `wrangler.jsonc` untuk tes | Tambahan `wrangler.test.jsonc` | Tanpa `assets`, `npm run test` tidak menuntut hasil build SPA lebih dulu |
| Spike diuji pada tabel nyata | Tabel sekali-pakai (`spike_outbox`, `spike_attendance`, …) dengan bentuk & indeks identik | Konsekuensi dari skema minimal. SQL yang diuji tidak berubah, jadi temuan tetap berlaku saat tabel aslinya dibuat |

### Pekerjaan

1. Inisialisasi npm workspaces: `apps/web`, `apps/api`, `packages/shared`.
2. `tsconfig.base.json` dengan `strict: true`, `noUncheckedIndexedAccess: true`.
3. `apps/api`: Worker minimal (`GET /api/health`), `wrangler.jsonc` dengan binding D1 + Static Assets (`run_worker_first: ["/api/*"]`, `not_found_handling: "single-page-application"`).
4. `apps/web`: Vite + React + TS + Tailwind + shadcn/ui (`components.json`), proxy `/api` → `:8787`.
5. `migrations/0001_init.sql` — **minimal**: hanya `app_meta` (key/value + `updated_at`).
   Tabel bisnis dibuat pada fase yang membutuhkannya (keputusan 31 Okt; lihat deviasi di atas).
6. Script kanonik di root `package.json` sesuai `AGENTS.md`.
7. Vitest: unit (node) + integrasi (`@cloudflare/vitest-plugin`), satu tes contoh D1.
8. CI GitHub Actions: `typecheck → lint → test → build`.
9. `.dev.vars.example`, `.gitignore`.
10. **Spike pengukuran** (lihat di bawah).

### Spike pengukuran — keluaran wajib

Buat modul `apps/api/src/test/bench.test.ts` atau skrip `npm run bench` yang mengukur:

| Yang diukur | Cara | Ambang lulus | Hasil Fase 0 |
|---|---|---|---|
| CPU 1 HMAC-SHA256 + 4 statement D1 | `wrangler dev` + `wrangler tail` (kolom CPU time), 100 request berturut | **p95 ≤ 5 ms** | ⚠️ **Belum terverifikasi.** Hanya proksi wall-clock lokal: scan proxy p50 7 ms / p95 11 ms; HMAC 0,054 ms/op. CPU platform butuh Worker ter-deploy |
| Atomisitas `db.batch()` | Batch dengan statement ke-2 melanggar constraint → pastikan statement ke-1 tidak tersimpan | Terbukti atomik | ✅ Atomik (`spike.batch.test.ts`) |
| `RETURNING` pada `INSERT ... ON CONFLICT` | Query langsung | Didukung / tidak (menentukan desain rate limit) | ✅ Didukung, termasuk di dalam `batch()` (`spike.returning.test.ts`) |
| Partial unique index | Migrasi + insert duplikat | Didukung | ✅ Didukung. **Temuan**: `ON CONFLICT` wajib mengulang predikat indeks (`spike.index.test.ts`) |
| `EXPLAIN QUERY PLAN` | Semua query utama | `SEARCH`, bukan `SCAN` | ✅ 10/10 `SEARCH ... USING INDEX` (`spike.explain.test.ts`) |
| Perilaku `Set-Cookie` dengan Static Assets | Request ke `/api/*` | Cookie tidak terpotong | ✅ **Berfungsi pada produksi** — alur auth/session digunakan; audit atribut cookie tetap dicatat di `docs/OPERASIONAL.md` |
| Batas ukuran import | Kirim CSV 500 / 1.000 / 2.000 baris | Menemukan titik di mana CPU > 5 ms | ⚠️ **Sebagian.** Wall-clock run 2: 82 / 149 / 301 ms. Titik CPU belum diketahui → batas sementara **1.000 baris/request** |

**Hasil spike menjadi keputusan konkret**: berapa baris maksimum per import, apakah rate limit memakai `RETURNING`, apakah `batch()` boleh diandalkan untuk atomisitas.

Keputusan yang sudah diambil: rate limit memakai `RETURNING`; absensi + outbox + audit dalam satu `batch()`; import dibatasi 1.000 baris sampai CPU terukur; upsert outbox wajib menyertakan predikat partial index.

### Kriteria penerimaan (terukur)

- [x] `npm run typecheck` → 0 error.
- [x] `npm run lint` → 0 error, 0 warning.
- [x] `npm run test` → lulus, ≥ 1 tes unit + ≥ 1 tes integrasi D1 yang benar-benar menyentuh `env.DB`. *(10 file, 44 tes)*
- [x] `npm run build` → menghasilkan `apps/web/dist/index.html` dan bundle Worker.
- [x] `npm run dev:web` + `npm run dev:api` → `/api/health` merespons `{"ok":true}` dari `http://localhost:5173/api/health`.
- [x] `npm run db:migrate:local` pada database kosong → `0001_init.sql` diterapkan (1 tabel `app_meta`, 1 baris `schema_version`); migrasi kedua kali → `No migrations to apply`.
- [x] Semua 7 item spike punya angka/kesimpulan tertulis di `docs/ARSITEKTUR.md` §11 atau `docs/OPERASIONAL.md`. *(3 di antaranya tercatat sebagai **belum terverifikasi**, bukan lulus)*
- [ ] CI hijau pada PR fase ini. Workflow tersedia; hasil eksekusi GitHub belum dicatat.

### Risiko fase ini

| Risiko | Bila terjadi |
|---|---|
| CPU > 5 ms untuk operasi dasar | Turunkan cakupan endpoint, atau ajukan diskusi paket berbayar ke pemilik proyek (**jangan** diputuskan sendiri) |
| `batch()` tidak atomik | Redesain penulisan: satu statement dengan `INSERT ... SELECT`, atau kompensasi manual |
| `RETURNING` tidak didukung | Rate limit memakai `UPDATE` + `SELECT` dalam batch |

---

## FASE 1 — Identitas, sesi, dan manajemen acara

**Tujuan**: seseorang bisa masuk tanpa password dan mengelola acara.

> **Status: SELESAI SEBAGIAN (Tahap 2) — cakupan dipersempit oleh instruksi pemilik.**
> Autentikasi, sesi, peran, otorisasi per acara, dan undangan sudah hidup dan teruji:
> `typecheck`, `lint`, `test` 136/136 (19 file), `build`, migrasi lokal, serta alur nyata
> lewat `wrangler dev` (aktivasi → `set-cookie` → `me` → logout → recover → replay ditolak).
>
> **CRUD acara dan UI daftar acara** yang ditunda dari Tahap 2 sudah dikerjakan di Tahap 3
> (lihat blok Fase 2). Kode dan tesnya sekarang ada; catatan "belum dikerjakan" di bawah
> dipertahankan sebagai riwayat Tahap 2.
>
> **Catatan ADR-002**: `AGENTS.md` sudah diselaraskan — aturan PBKDF2 dicabut dan diganti
> aturan auth passwordless sesuai `docs/ARSITEKTUR.md` ADR-002. Implementasi memakai
> autentikasi passwordless; tidak ada PBKDF2/bcrypt di kode.

### Pekerjaan

1. `migrations/0002_auth.sql`.
2. `domain/token.ts`: generate + hash + verify (HMAC-SHA256, `crypto.subtle`).
3. `domain/permissions.ts`: matriks peran (sumber kebenaran tunggal).
4. Middleware: `auth` (sesi → user → membership), `csrf`, `error` (pemetaan error → kode respons), `request-id`.
5. Endpoint auth: `activate`, `recover`, `me`, `logout`, `sessions`, `revoke`, `recovery-code`.
6. Seed superadmin awal: skrip `npm run seed:superadmin` yang mencetak URL aktivasi (bukan menyimpan password).
7. Endpoint events: `list`, `create`, `get`, `patch`, `status`, `summary` (hitungan kosong dulu).
8. Endpoint invites: `create`, `list`, `delete`, `members`, `revoke`.
9. UI: halaman aktivasi (`/aktivasi#t=`), halaman login-by-code, layout dashboard, halaman daftar acara + form buat acara.

### Kriteria penerimaan (terukur)

| Kriteria | Status | Bukti |
|---|---|---|
| Tes `invite.replay`, `invite.expired`, `invite.revoke-kills-sessions`, `recover.rotates-devices` lulus | **PASS** | `auth.activate.test.ts`, `auth.recover.test.ts`, `authz.events.test.ts` |
| `authz.unauthenticated` iterasi **semua** route terdaftar → 401 | **PASS** | `authz.unauthenticated.test.ts` mengiterasi `ROUTES`; daftar route publik diuji eksplisit |
| `authz.cross-event-member`: admin acara A mengakses acara B → 404 | **PASS** | `authz.events.test.ts` (members, invites, revoke) |
| Matriks otorisasi §5.1 dieksekusi sebagai tes parametrik | **PASS** | `permissions.test.ts`, tabel ekspektasi ditulis manual |
| Token undangan tidak pernah muncul di log (`wrangler tail`, 20 request) | **NOT RUN** | Butuh deployment; secara kode token tidak pernah di-log, dan `wrangler dev` hanya mencatat request line + status |
| `activate` mengembalikan `recoveryCode` sekali; `me` tidak memuatnya | **PASS** | `auth.activate.test.ts`; tipe `MePayload` tidak punya field itu |
| Semua transisi status acara tercakup tes `domain/event-status.ts` | **PASS** | Dikerjakan di Tahap 3: `event-status.test.ts` (14 kasus), aturan dipindah ke `packages/shared` |
| Setiap endpoint ≤ 6 statement D1 | **SEBAGIAN** | Lihat tabel di bawah |

#### Jumlah statement D1 per endpoint

Dihitung manual dari kode (bukan diklaim dari `meta`). `touchSession` hanya menulis bila
`last_seen_at` lebih tua dari 5 menit, jadi angka bawah adalah kondisi "baru saja aktif".

| Endpoint | Statement | Catatan |
|---|---|---|
| `GET /api/auth/me` | 2–3 | lookup sesi + daftar membership (+ touch) |
| `GET /api/auth/sessions` | 2–3 | + touch |
| `POST /api/auth/logout` | 2 | touch + revoke |
| `POST /api/auth/sessions/:id/revoke` | 2–3 | |
| `POST /api/auth/recovery-code` | 3 | batch 2 statement kode |
| `GET /api/events/:id/members` | 4 | cek acara + membership + daftar |
| `GET /api/events/:id/invites` | 4 | |
| `POST /api/events/:id/invites` | 5 | + hitung undangan aktif |
| `DELETE /api/events/:id/invites/:id` | 4 | |
| `POST /api/events/:id/members/:id/revoke` | 6–7 | + cabut sesi & kredensial |
| `POST /api/auth/activate` | 10–12 | satu `db.batch()`: user + membership + kredensial + sesi + kode + atribusi undangan |
| `POST /api/auth/recover` | 9–11 | satu `db.batch()`: cabut semua sesi/kredensial + terbitkan yang baru |

Ambang 6 statement dilewati oleh dua endpoint tulis terberat. Itu konsekuensi model
kredensial per perangkat (ADR-002), bukan query yang bisa digabung: tabelnya berbeda.
Keduanya tetap **satu round trip** karena memakai `env.DB.batch()`. Angka ini yang perlu
diawasi di `docs/OPERASIONAL.md`, bukan jumlah statement per tabel.

### Yang sengaja belum dikerjakan saat Tahap 3

- CRUD acara dan seluruh UI acara (dilarang pada Tahap 2). Endpoint `summary` tidak ada.
- `domain/event-status.ts` dan tes transisinya.
- Peserta, QR, scan, rekap nyata, sync.

### Catatan deviasi dari rencana

| Rencana | Yang dikerjakan | Alasan |
|---|---|---|
| `invites.event_id` NOT NULL | `event_id` **nullable** + `CHECK` yang mengikat peran | Undangan bootstrap superadmin tidak punya acara, karena acara belum ada saat akun pertama dibuat |
| `invites.created_by` NOT NULL | `created_by` **nullable** hanya untuk undangan bootstrap | Belum ada admin yang bisa dicatat sebagai pembuat |
| `POST /invites` mengembalikan `activateUrl` absolut | Mengembalikan `activatePath` (`/aktivasi#t=…`) | Worker tidak tahu hostname publik di balik proxy; SPA menyusun URL absolut. Token tetap di fragmen |
| Kode pemulihan 128-bit | **100-bit** (5×4 Crockford = 20 simbol) | Klaim 128-bit di `ARSITEKTUR.md` tidak akurat untuk format yang dipilih. 100 bit tetap di atas ambang aman untuk kode sekali pakai ber-rate-limit; dicatat jujur, bukan dibulatkan |
| Middleware `request-id` | Belum ada | Tidak dibutuhkan oleh satu pun kriteria penerimaan Tahap 2; menambahkannya tanpa pemakai adalah kode mati |


---

## FASE 2 — Peserta, import CSV, dan QR

**Tujuan**: peserta masuk sistem dan punya QR yang bisa dicetak.

> **Status: SELESAI (Tahap 3 non-QR + Tahap 4 QR/label).**
> Yang hidup: CRUD acara lengkap dengan lifecycle, manajemen peserta terisolasi per acara,
> impor CSV dua langkah (pratinjau → konfirmasi), pencarian, paginasi kursor, detail/edit,
> soft-delete dengan konfirmasi, ekspor CSV, template CSV, **kredensial QR terenkripsi**,
> **konfigurasi field label per acara**, dan **halaman cetak label A4 + stiker 50 × 30 mm**.
>
> Verifikasi lokal Tahap 4: `typecheck`, `lint`, `test`, `build` (angka final ada di ringkasan
> penyerahan; jalankan ulang perintahnya untuk membuktikan). Gerbang produksi (CPU p95, CI hijau,
> cetak fisik, kamera) tetap **NOT RUN**.
>
> **Yang belum dan mengapa**: pemindaian QR dan pencatatan kehadiran adalah Tahap 5 / Fase 3,
> dengan gerbangnya sendiri. Semua kolom QR sudah ada; tidak ada migrasi tambahan yang
> dibutuhkan untuk scan.

### Pekerjaan (yang benar-benar dikerjakan di Tahap 3)

1. `migrations/0003_participants.sql`: tabel `participants`, unique partial index
   `(event_id, external_ref)`, indeks pencarian dan paginasi.
2. `domain/csv.ts` + `domain/participant-import.ts`: parser RFC 4180 (BOM, `;`, kutip,
   newline dalam kutip), normalisasi telepon/email, validasi header dan baris, deteksi
   duplikasi dalam file. **Murni, tanpa I/O.**
3. Endpoint acara: `list`, `create`, `get`, `patch`, `status`, `summary`, `delete`
   (superadmin, hanya draf kosong).
4. Endpoint peserta (semua event-scoped): `list`, `create`, `get`, `patch`, `delete`
   (soft-delete), `export`, `template`, `import` (dry-run + konfirmasi).
5. UI: daftar acara, detail acara, tambah/edit peserta, detail peserta, wizard impor,
   ekspor/template, halaman akun, bottom floating pill navigation dock.
6. Rate limit konfirmasi impor: 10/jam per acara, dari tabel D1.

### Kriteria penerimaan (terukur)

- [x] Parser CSV: **31 kasus** unit test, termasuk kutip berisi koma, newline di dalam kutip,
      BOM, delimiter `;`, baris kosong, header duplikat/tidak dikenal. — `csv.test.ts`
- [x] `import.idempotent`: impor file yang sama dua kali → jumlah peserta tidak berubah,
      baris kedua dilaporkan sebagai `updated`. — `participants.import.test.ts`
- [x] `import.partial-invalid`: baris rusak dilaporkan dengan nomor baris fisik, baris valid
      tetap tersimpan. — `participants.import.test.ts`
- [x] Batas keras: > 2 MB → 413; > 1.000 baris → 413 dengan pesan yang menyebut batasnya.
- [x] Setiap kredensial punya `qr_token_hash` unik; hash yang sama untuk peserta lain ditolak
      database. — `qr.db.test.ts`, `qr-token.test.ts`
- [x] Cetak label QR (A4 + stiker) tersedia; keterbacaan hasil cetak oleh kamera **belum diuji**
      (butuh printer + HP). — `labels.api.test.ts`, `apps/web/src/lib/qr-labels.test.ts`
- [x] `qr-labels` menulis audit `qr.labels_exported` tanpa token/PII. — `labels.api.test.ts`
- [x] `officer` memanggil `import`, `export`, `template`, atau mutasi peserta → 403.
      — `participants.crud.test.ts`, `participants.import.test.ts`
- [x] Isolasi antaracara: peserta acara B tidak bisa dibaca/diubah lewat id acara A → 404.
- [x] Acara berstatus `archived` menolak seluruh mutasi peserta dan acara → 422.

### Catatan desain

Tidak ada kolom QR di CSV (lihat `DESAIN_API.md` §5). Ini menghilangkan seluruh kelas bug
"dua peserta dengan QR sama" dan memastikan token tidak pernah melewati saluran yang tidak
aman.

### Catatan deviasi Fase 2 / Tahap 3

| Rencana | Yang dikerjakan | Alasan |
|---|---|---|
| Endpoint peserta global `/api/participants/:id` | Semua endpoint di bawah `/api/events/:eventId/participants…` | Scope acara menjadi bagian dari URL, sehingga tidak ada permukaan lintas acara yang bisa bocor lewat id |
| `delete` = hapus fisik | Soft-delete `status='inactive'`, wajib body `{confirm:true}`, bisa diaktifkan kembali lewat PATCH | Menjaga riwayat dan mencegah kehilangan data karena salah klik |
| Import langsung menulis | Default `dry_run=true`; tulis hanya dengan `?dry_run=false` setelah pratinjau | Satu request yang salah tidak boleh mengubah data |
| Batas 5.000 baris | **1.000 baris**, 2 MB | Angka sisa spike Fase 0; CPU platform belum terukur |
| `qr-labels` + kolom QR | Tidak dibuat di Tahap 3; **dibuat di Tahap 4** (`migrations/0004_qr.sql`) | Tahap 3 sengaja berhenti sebelum QR; Tahap 4 membuka gerbangnya |
| Status acara bebas | `draft → active → closed → active|archived`; `archived` final; `active → archived` ditolak | Mencegah acara diarsipkan tanpa ditutup dan dibuka lagi setelah final |
| Hapus acara oleh admin acara | Hanya superadmin, hanya draf tanpa peserta | Hard delete adalah tindakan lintas acara; selain itu arahkan ke arsip |

---

## TAHAP 3.5 — Penyelarasan UI/UX dan sistem navigasi

**Status historis: penyelarasan UI dikerjakan.** Lapisan UI ini tidak menambah endpoint,
migrasi, atau dependensi baru.

Tujuan: dua tingkat navigasi yang terpisah — global (sidebar desktop / bottom nav mobile) dan
workspace acara (segmented control) — tanpa mencampurnya.

### Yang dikerjakan

1. Route tree kanonis: `/admin/{dashboard,events,activity,settings}`,
   `/admin/events/:eventId/{overview,participants,staff,attendance,reports}`,
   `/admin/events/:eventId/participants/{import,:participantId}`,
   `/staff/{home,scan,history,profile}`. Path lama `/acara…` dan `/akun` tetap diparse lalu
   ditulis ulang ke URL kanonis (`replaceState`), bukan diduplikasi.
2. `lib/navigation.ts` (murni + unit test): item sidebar/bottom per peran, aturan item aktif,
   dan pemetaan route → tab acara.
3. `AppLayout` + `Sidebar` + `BottomNav`: sidebar 248 px ↔ 76 px, tooltip saat ciut, bottom nav
   empat item dengan safe-area, aksi Scan QR ditonjolkan untuk petugas.
4. `EventSwitcher` di sidebar (desktop) dan strip atas (mobile) untuk berpindah acara tanpa
   kembali ke daftar; halaman di-*remount* per route sehingga data acara lama tidak tertinggal.
5. `EventTabs`: segmented control dengan indikator geser (spring), ikon + label, dan scroll
   horizontal di layar sempit. Baris tab dirender `AppLayout` (bukan tiap halaman) supaya
   komponennya tidak ikut ter-*remount* saat pindah tab — kalau tidak, indikator lahir langsung
   di posisi akhir dan animasinya tidak pernah terlihat. Indikator memakai `translateX` per
   indeks, jadi tidak perlu mengukur DOM.
6. Halaman baru: dashboard, aktivitas audit, Petugas/Absensi/Laporan, Beranda/Scan/Riwayat
   petugas, serta pemisahan detail acara menjadi Ringkasan dan Peserta.
7. Motion CSS: transisi halaman 220 ms, sidebar 200 ms, hover/press 150 ms, spring tab; semua
   menghormati `prefers-reduced-motion`.

### Deviasi & batasan yang disengaja

| Rencana / kebutuhan | Yang dikerjakan | Alasan |
|---|---|---|
| Route staff hanya `/staff/{home,scan,history}` | Tambah `/staff/profile` | Item bottom nav "Profil" wajib punya tujuan; `/admin/settings` tidak pantas untuk peran petugas |
| Sidebar hanya untuk admin | Sidebar juga dipakai petugas di desktop | Tanpa itu petugas di layar lebar tidak punya navigasi sama sekali |
| Event switcher hanya di sidebar | Juga tampil sebagai strip di atas konten pada mobile | Sidebar tidak dirender di mobile, sedangkan berpindah acara tanpa kembali ke daftar tetap diperlukan |
| Tab Petugas/Absensi/Laporan punya fitur | Fitur dikerjakan setelah fase backend terkait tersedia | Mematuhi gate roadmap |
| Data acara lama dibersihkan manual | Halaman di-*remount* per route + effect bergantung `eventId` | Dua lapis pencegahan data basi |
| Pengujian visual/keyboard/reduced-motion otomatis | **NOT RUN** (manual) | Web test berjalan di Node, tanpa jsdom/Playwright |

### Polish hasil review (sebelum commit)

1. `EventSwitcher` menerima `id` dari pemanggil: sebelumnya dua salinan memakai `id` yang sama
   dan `<label for>` mengarah ke salinan yang tersembunyi di mobile.
2. Sidebar ciut tidak lagi menghilangkan switcher: rail menampilkan tombol "Ganti acara" yang
   memperluas sidebar (sebelumnya di ≥1024 px tidak ada cara berpindah acara sama sekali).
3. Berpindah acara mempertahankan tab aktif, bukan selalu kembali ke Ringkasan.
4. Permukaan `header`, baris tab, dan bottom nav dibuat opak — `bg-background/85` + `backdrop-blur`
   membiarkan teks yang lewat terlihat samar di bawah judul.
5. `--muted-foreground` 0.556 → 0.50 (4.34:1 → 5.5:1 di atas `--muted`) agar badge status dan
   header tabel lulus AA.
6. Navigasi mereset scroll dan memindahkan fokus ke `main`; tooltip sidebar muncul pada
   `focus-visible`, bukan hanya `title` saat hover.

Verifikasi: `typecheck`, `lint`, `test` **296/296** (27 file), `build` — PASS.

---

## TAHAP 4 — Kredensial QR dan cetak label

**Tujuan**: peserta punya QR yang aman dan bisa dicetak, tanpa membuka pemindaian (Tahap 5).

### Yang dikerjakan

1. `migrations/0004_qr.sql`: lima kolom QR nullable pada `participants` + `CHECK` per kolom,
   `uq_participant_qr_hash` (partial unique), tabel `event_label_config`, tabel `audit_log`
   lengkap dengan trigger append-only.
2. `domain/qr-token.ts`: token 256-bit base64url, payload opaque `absensi:v1:<token>`,
   `HMAC-SHA256(QR_PEPPER, token)`, AES-256-GCM dengan `QR_ENCRYPTION_KEY`, versi kunci,
   rotasi tanpa mengubah token/hash, dan kegagalan keras tanpa fallback plaintext.
3. `POST /api/events/:eventId/participants/qr-labels`: terbitkan atau baca ulang kredensial,
   dua mode pemilihan (eksplisit / kursor), maksimal 50 per request, audit
   `qr.labels_exported`.
4. `GET`/`PUT /api/events/:eventId/label-config`: konfigurasi field per acara.
5. Frontend: halaman `/admin/events/:id/participants/labels`, pemilihan peserta, urutan field,
   pratinjau, `window.print()`, CSS A4 3 × 8 dan stiker 50 × 30 mm.
6. Dependensi baru: `qrcode-generator@2.0.4` (MIT, tanpa dependensi runtime) — hanya encoder;
   SVG dibangun sendiri agar ukuran/quiet zone eksplisit.

### Kriteria penerimaan (terukur)

- [x] Token ≥ 128 bit (dipakai 256 bit), opaque, tanpa PII/id peserta.
- [x] D1 hanya menyimpan hash + ciphertext + nonce + versi; tidak ada plaintext.
- [x] Hash unik di level database; kredensial tidak pernah ditimpa saat cetak ulang.
- [x] Cetak ulang menghasilkan payload QR identik.
- [x] Lintas acara dan peserta nonaktif ditolak/diabaikan.
- [x] `audit_log` append-only (trigger) dan mencatat cetak tanpa token/PII.
- [x] Konfigurasi field hanya memakai kolom peserta yang ada, maksimal 4, QR selalu ikut.
- [x] Batas batch 50 setelah pengukuran CPU (100 ≈ 12 ms p50 crypto-only di lokal).
- [ ] Cetak fisik A4/stiker, ukuran mm, dan pemindaian hasil cetak — **NOT RUN** (butuh printer
      dan kamera HP).
- [ ] Tampilan visual/keyboard/reduced-motion halaman label — **NOT RUN** (web test Node-only).
- [ ] CPU produksi `wrangler tail` — **NOT RUN** (butuh akun Cloudflare).

### Batasan yang disengaja

| Rencana | Yang dikerjakan | Alasan |
|---|---|---|
| Kolom QR `NOT NULL` sejak awal | Nullable, dibuat lazy saat cetak pertama | Peserta import/lama tetap valid; tidak ada token mati |
| Satu endpoint GET untuk label | `POST` karena panggilan pertama menerbitkan kredensial | GET tidak boleh punya efek samping |
| Template label bebas | Katalog field tetap + urutan, maksimal 4 | Bukan page builder; menjaga validasi dan privasi |
| PDF di server | `window.print()` saja | Tidak ada dependensi PDF dan tidak membebani Worker |
| Rotasi token saat cetak ulang | Tidak pernah; hanya ciphertext yang bisa dirotasi | QR tercetak harus tetap sah |

Snapshot verifikasi lokal saat pekerjaan label (sebelum tes scan dan sync ditambahkan):
`typecheck` PASS, `lint` PASS, `test` **356/356** (33 file) PASS, `build` PASS. Spike label: 50 label halaman pertama
~59 ms, cetak ulang p50 ~24 ms; crypto 100 kredensial p50 9–12 ms (dasar menurunkan batas
menjadi 50). Cetak fisik, kamera, dan CPU produksi tetap **NOT RUN**.

---

## FASE 3 — Pemindaian dan pencatatan kehadiran

**Tujuan**: fitur inti bekerja di HP sungguhan. Ini fase dengan risiko teknis tertinggi.

> **Status saat ini: alur web scan dan riwayat tersedia.** `StaffScanPage` mengirim QR ke
> Worker dan menampilkan hasil server; halaman riwayat petugas membaca API attendance.
> Uji perangkat fisik, umpan balik bunyi, antrean scan offline, dan pengukuran CPU produksi
> masih menjadi pekerjaan terbuka.

### Pekerjaan

1. Endpoint `POST /api/events/:id/scan` sesuai `DESAIN_API.md` §6.
2. Endpoint `POST /api/events/:id/attendance/manual` (fallback).
3. UI scanner: akses kamera (`getUserMedia`) dipicu gesture, `BarcodeDetector` bila tersedia, fallback `@zxing/browser`.
4. Umpan balik hasil: `present` (hijau + nama), `duplicate` (kuning + jam pertama), `not_found`/`wrong_event` (merah), dengan bunyi berbeda per hasil.
5. Antrean retry klien: bila request gagal karena jaringan, ulangi dengan `Idempotency-Key`; hasil `duplicate` ditampilkan sebagai "sudah tercatat", bukan error.
6. PWA-lite: `manifest.json` + `display: standalone` agar terasa seperti aplikasi (tanpa service worker offline).
7. **Sudah selesai di Tahap 4**, jangan diulang: `migrations/0004_qr.sql` menambah kelima kolom
   QR (`qr_token_hash`, `qr_token_ciphertext`, `qr_token_nonce`, `qr_key_version`,
   `qr_issued_at`) dan `uq_participant_qr_hash`. Fase 3 hanya membaca/menulis lewat kolom itu.
   Jangan mengedit `0003_participants.sql` atau `0004_qr.sql`.

### Kriteria penerimaan (terukur)

- [ ] `scan.present`, `scan.duplicate`, `scan.concurrent`, `scan.cross-event`, `scan.closed-event`, `scan.inactive-participant` lulus.
- [ ] **`scan.concurrent` dijalankan 50 kali** dengan dua request paralel → selalu tepat 1 baris `attendance` (tidak ada flakiness).
- [ ] CPU p95 `POST /scan` ≤ 5 ms diukur dari `wrangler tail` pada 200 request.
- [ ] Statement D1 per scan ≤ 4 (dibuktikan dengan menghitung query di kode + `meta`).
- [ ] Rate limit: scan ke-121 dalam satu menit → 429 dengan `Retry-After`.
- [ ] Di **iPhone fisik**: kamera terbuka (fallback ZXing aktif), 20 scan berturut-turut berhasil tanpa reload halaman.
- [ ] Di **Android fisik**: `BarcodeDetector` terpakai (dibuktikan lewat log non-PII), 20 scan berhasil.
- [ ] Scan dengan QR acara lain menampilkan pesan yang menyebut nama acara yang benar.
- [ ] Dengan jaringan dimatikan: UI menampilkan pesan yang bisa ditindaklanjuti, tidak blank/crash.
- [ ] Tidak ada PII (nama peserta) di log Worker — hanya `participantId`.

### Kriteria gagal (rollback)

Bila `scan.concurrent` tidak bisa dibuat deterministik setelah 2 hari kerja, hentikan fase dan evaluasi ulang asumsi atomisitas `db.batch()`. **Jangan** menambal dengan pengecekan "sudah ada atau belum" di kode aplikasi — itu mengembalikan bug yang justru ingin dicegah.

---

## FASE 4 — Rekap, audit, dan koreksi

> **Status saat ini: alur produk utama tersedia secara lokal.** Dashboard, tab Petugas,
> Absensi, Laporan, scan/riwayat petugas, Aktivitas audit, koreksi, undangan/revokasi,
> ekspor CSV, dan pengelolaan sinkronisasi sudah terhubung. Prosedur arsip/retensi audit,
> verifikasi perangkat fisik, dan verifikasi akun Google Sheets nyata masih terbuka.

### Pekerjaan

1. ✅ `GET /api/events/:id/attendance` (paginasi + filter status + pencarian).
2. ✅ Dashboard API global dan per acara. ⬜ Agregat per kategori belum tersedia.
3. ✅ `POST /api/events/:eventId/attendance/:attendanceId/correction` dengan optimistic check.
4. ✅ `GET /api/events/:id/audit` dengan filter dan cursor, tanpa hash IP/token di respons.
5. ✅ UI dashboard dengan data API, tabel kehadiran, dialog koreksi, halaman aktivitas, dan laporan.
6. ✅ Ekspor kehadiran CSV hingga 5.000 baris dengan filter status/pencarian.
7. ⬜ Modul/prosedur arsip audit (`domain/audit-retention.ts`) belum diaktifkan.

### Kriteria penerimaan (terukur)

- [ ] `authz.officer-cannot-correct`: officer → 403 **dan** ada baris audit `authz.denied`.
- [ ] `audit.correction-recorded`: `before`/`after` berisi status lama dan baru yang benar, plus `reason`.
- [ ] `audit.immutable`: `UPDATE`/`DELETE` lewat `env.DB` → error dari trigger.
- [ ] `409` saat dua koreksi bersamaan pada baris yang sama (tes paralel).
- [ ] Query rekap: `EXPLAIN QUERY PLAN` menunjukkan `SEARCH`; baris dibaca ≤ 1.000 untuk acara 20.000 peserta (dibuktikan dengan `meta.rows_read` pada tes).
- [ ] Dashboard 20.000 peserta: p95 respons API ≤ 300 ms (diukur lokal dengan data seed).
- [ ] Tidak ada endpoint `PATCH`/`DELETE` untuk audit di tabel router (dites: `404`).
- [ ] Semua aksi mutasi tercatat di audit — tes iterasi: setiap endpoint mutasi menghasilkan ≥ 1 baris audit.

---

## FASE 5 — Sinkronisasi Google Sheets (outbox)

> **Status saat ini: backend parsial.** Worker memiliki `domain/sheets.ts`, route sync, tabel
> outbox, dan tes memakai fake client. Uji koneksi ke Google Sheet nyata belum dilakukan dan
> UI konfigurasi/status sync belum tersedia. Kriteria di bawah belum seluruhnya dibuktikan.

### Pekerjaan

1. ✅ Migrasi `0005_attendance_sync.sql` membuat skema attendance dan sinkronisasi.
2. ✅ `domain/sheets.ts` menyediakan gateway Sheets; implementasi Worker dan fake tes tersedia.
3. ✅ JWT service account, penukaran token, dan cache token diimplementasikan.
4. ✅ Mutasi scan/koreksi memasukkan outbox secara atomik.
5. ✅ Cron `scheduled()` menjalankan sync, reklain item macet, dan housekeeping.
6. ✅ Route sync mencakup konfigurasi, tes koneksi, full resync, eksekusi, daftar kegagalan, dan retry.
7. ✅ UI konfigurasi/status sync tersedia (`event-reports.tsx`), termasuk jalankan, full resync, dan retry item.

### Kriteria penerimaan (terukur)

- [ ] `outbox.coalesce`: 5 koreksi berturut-turut → `COUNT(*) = 1` di outbox.
- [ ] `outbox.retry-backoff`: delay mengikuti `min(2^n × 30s, 30m)` ± jitter (fake clock).
- [ ] `outbox.dead-after-max`: 8 kegagalan → `dead`.
- [ ] `outbox.permanent-error`: fake client mengembalikan 404 → langsung `dead`, **bukan** 8 percobaan.
- [ ] `sync.full-resync`: 1.000 peserta → payload `batchUpdate` terkirim dalam chunk ≤ 500 baris, `sheet_rows` konsisten (tidak ada `row_index` duplikat).
- [ ] Cron dengan fake client: 5 item → 1 panggilan `batchUpdate`, 0 panggilan per item (membuktikan batching).
- [ ] Cron tidak melempar error saat D1 mengembalikan error (tes: DB stub yang gagal).
- [ ] Tidak ada panggilan jaringan nyata di seluruh suite tes (`grep` tidak menemukan `googleapis.com` di luar `integrations/sheets/`).
- [ ] Uji manual di staging: sheet sungguhan menerima 100 baris; koreksi satu absensi mengubah **satu sel** dan tidak menambah baris.
- [ ] Pemakaian Sheets ≤ 60 tulis/menit: dengan 5 item/5 menit, terpakai < 1%.

---

## FASE 6 — Hardening, observability, dan deploy

> **Status saat ini: sebagian selesai.** Worker sudah di-deploy ke `qrcek.hamdirobbi5.workers.dev`
> dan auth digunakan. Rate limit seluruh bucket `DESAIN_API.md` §10 dan housekeeping cron sudah
> berjalan; header keamanan, `/api/health/ready`, `/api/admin/usage`, dan prosedur arsip audit
> sudah ada. Pengukuran CPU, backup prosedural, smoke test lengkap, dan ekstraksi ADR masih terbuka.

### Pekerjaan

1. ✅ Rate limit seluruh endpoint sesuai tabel `DESAIN_API.md` §10 (termasuk `sync:run` 1/menit dan `limit` manual maksimum `SYNC_RUN_MAX`).
2. ✅ Header keamanan: `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Content-Security-Policy` (tanpa `unsafe-eval`/`unsafe-inline` untuk script). Dipasang di Worker (`apps/api/src/http/security-headers.ts`) dan di `apps/web/public/_headers`; paritas dijaga tes.
3. ✅ `/api/health/ready` + `/api/admin/usage`.
4. ✅ Prosedur arsip audit (`docs/OPERASIONAL.md` §9.3, ADR-008) — ambang peringatan masih manual lewat `counts.auditEntries`.
5. `docs/OPERASIONAL.md`: break-glass superadmin, rotasi secret, pemulihan dari snapshot, prosedur event day.
6. Ekstrak ADR 001–005 ke `docs/adr/`.
7. Deploy produksi: `wrangler deploy`, `wrangler d1 migrations apply --remote`, smoke test.
8. Opsional (hanya bila disetujui): E2E Playwright untuk 3 alur kritis.

### Kriteria penerimaan (terukur)

- [ ] Semua header keamanan terverifikasi dengan `curl -I` pada produksi.
- [ ] CSP tidak memblokir kamera, font, atau script aplikasi (diverifikasi di DevTools tanpa error console).
- [ ] `/api/health/ready` mengembalikan 200 saat D1 sehat; 503 saat D1 disimulasikan gagal.
- [ ] Smoke test produksi: buat acara → undang petugas → import 100 peserta → scan 100 QR → rekap menunjukkan 100 → sheet menerima 100 baris.
- [ ] `docs/OPERASIONAL.md` memuat prosedur break-glass yang **sudah diuji sekali** di staging.
- [ ] `AGENTS.md` diperbarui: `@cloudflare/vitest-plugin`, keputusan ADR-002 (passwordless), status fase.
- [ ] Backup: satu snapshot `wrangler d1 export` tersimpan di luar Cloudflare sebelum migrasi remote pertama.

---

## Urutan ketergantungan (mengapa tidak bisa diacak)

```
Fase 0 (ukur platform)
   └─> Fase 1 (user & acara)         ← butuh sesi untuk semua endpoint lain
        └─> Fase 2 (peserta & QR)    ← butuh acara untuk menempelkan peserta
             └─> Fase 3 (scan)       ← butuh QR + peserta + otorisasi
                  └─> Fase 4 (rekap) ← butuh data absensi nyata
                       └─> Fase 5 (sync) ← butuh absensi + audit untuk diproyeksikan
                            └─> Fase 6 (deploy)
```

Fase 5 **tidak** bisa dipindah ke awal karena outbox ditulis bersama mutasi absensi; memindahkannya berarti membangun ulang Fase 3 dan 4.

---

## Definisi "selesai" untuk setiap fase

Sebuah fase dinyatakan selesai hanya bila **semua** benar:

1. Semua kriteria penerimaan tercentang dengan bukti yang bisa dijalankan ulang (perintah + output).
2. `typecheck → lint → test → build` hijau di CI.
3. `docs/` diperbarui untuk perilaku yang berubah.
4. Tidak ada `TODO`/`FIXME` baru tanpa isu tertulis.
5. Tidak ada dependensi baru tanpa justifikasi satu baris.
6. Pemilik proyek menyetujui ringkasan fase.

---

## Hal yang menunggu keputusan sebelum Fase 0 dimulai

| # | Keputusan | Default yang diusulkan | Dampak bila diubah setelah Fase 0 |
|---|---|---|---|
| 1 | ADR-001 topologi: satu Worker same-origin | **Setuju** | Menambah CORS, cookie, dan pipeline deploy kedua |
| 2 | ADR-002 passwordless (mengganti aturan PBKDF2 di `AGENTS.md`) | **Disetujui & diterapkan** di Tahap 2; `AGENTS.md` sudah diperbarui | Auth harus ditulis ulang seluruhnya |
| 3 | ADR-003 QR opaque + HMAC di server | **Setuju** | Skema `participants` berubah |
| 4 | ADR-004 Sheets upsert, bukan append | **Setuju** | Tabel `sheet_rows` dan outbox berubah |
| 5 | Batas baris per import (nilai dari spike Fase 0) | 1.000 baris, diturunkan bila CPU > 5 ms | Kontrak API berubah |
| 6 | Nama domain / apakah memakai `*.workers.dev` | `*.workers.dev` untuk staging | Perubahan konfigurasi, bukan kode |
| 7 | Apakah `superadmin` boleh mengoreksi absensi | **Ya**, wajib beralasan | Matriks otorisasi berubah |

Tidak ada keputusan di atas yang bisa diambil sendiri oleh agent.

---

## Estimasi konsumsi free tier pada pemakaian realistis

Asumsi: 1 sekolah, 2 acara/bulan, 500 peserta/acara, 1.500 pemindaian/acara.

| Metrik (batas harian) | Pemakaian pada hari acara | % kuota |
|---|---|---|
| Workers request (100.000) | ~2.500 | 2,5% |
| D1 baris tulis (100.000) | ~14.000 | 14% |
| D1 baris baca (5.000.000) | ~50.000 | 1% |
| Sheets tulis per menit (60) | ~1 | 1,7% |
| Storage (500 MB) | ~10 MB | 2% |

Kesimpulan: **pemakaian normal menggunakan < 15% kuota harian yang paling ketat** (baris tulis D1). Lonjakan hanya terjadi pada import besar atau banyak acara di hari yang sama (`COSTS_AND_LIMITS.md` §3.3).
