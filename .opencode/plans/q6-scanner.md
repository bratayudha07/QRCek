# Rencana Q6 — Penugasan Petugas dan Scanner/Kiosk

Status: **DIBUKA 14 November 2026 (UI + API).** Dokumen ini rencana eksekusi, bukan bukti implementasi. Q6 dibuka di [`docs/IMPLEMENTATION_ROADMAP.md`](../../docs/IMPLEMENTATION_ROADMAP.md) setelah gate Q5 ditutup. Arah desain memakai skill `ui-ux-pro-max` (hasil pencarian diverifikasi manual, lihat §4).

Ketergantungan yang sudah selesai:

- Q1 — hierarki Tema → Aktivitas → Sesi.
- Q4 — QR Identity per Tema + rotasi.
- Q5 — transaksi berkonteks, `staff_assignments`, kontrak hasil scan (ADR-0018–0022).

Tidak ada keputusan produk baru yang dibutuhkan untuk cakupan inti Q6. **AQ-012** (pesan scanner dapat dikonfigurasi) tetap terbuka dan karena itu bagian konfigurasi pesan per Tema **ditunda**.

---

## 0. Keputusan yang mengikat rencana ini

| Sumber | Isi yang mengikat Q6 |
|---|---|
| `D-003` [A], `FR-099`, `FR-190`, `BR-050` | Penugasan per Aktivitas/Sesi; Aktivitas dengan Sesi mewajibkan Sesi eksplisit. |
| `D-012` [A], `FR-100`, `FR-127`, `FR-128`, `AC-028` | Scanner dibatasi penugasan; URL hanya preselection; backend tetap otorisasi. |
| `D-012` [A], `FR-189`, `AC-048` | Hasil tampil ±2 detik, pemrosesan terkunci, kembali standby otomatis, tanpa konfirmasi manual. |
| `D-013` [A], `FR-113`, `FR-119`, `FR-124`, `FR-192`, `NFR-022`, `AC-053` | Lima keadaan utama; audio/visual; mute lokal; status tidak hanya warna; tetap usable tanpa audio. |
| `D-012` [A], `FR-122`, `FR-123`, `BR-054`, `BR-057`, `AC-027` | Online saja; tanpa antrean offline; setiap transaksi dikonfirmasi backend; tidak ada sukses palsu. |
| `D-011` [A], ADR-0022, `FR-088`, `BR-072` | `ScanResult` stabil; `SYSTEM_ERROR` adalah error transport/5xx, bukan hasil bisnis. |
| ADR-0021 (Diterima), `D-022` [A], `D-024` [A], `FR-073`–`FR-077`, `FR-106` | Kewenangan kelola penugasan: Super Admin + Admin Acara; Petugas tidak. Manual Check-in per penugasan; Super Admin tidak scan/manual/koreksi. |
| `FR-103`, `FR-104`, `FR-105`, `BR-052`, `BR-053` | Transaksi mencatat Petugas; pencabutan tidak menghapus riwayat; perangkat bersama tetap akun masing-masing. |
| `D-023` [A], ADR-0008, ADR-0011, `FR-207` | Audit append-only dalam `db.batch()` yang sama; snapshot allowlist; tanpa PII/kredensial. |
| `D-007` [A], ADR-0010 | Tanpa migrasi baru; `0011` sudah memuat `staff_assignments`. |
| `NG-01`–`NG-06` | Tidak ada mode offline, PDF, kartu, Canva, atau desain kartu. |
| AQ-012 (terbuka) | Konfigurasi pesan per Tema **tidak** diimplementasikan di Q6. |

---

## 1. Prasyarat — terpenuhi

| Prasyarat | Bukti |
|---|---|
| Tabel `staff_assignments` + partial unique index + trigger konteks | `migrations/0011_q5_transactions.sql` baris 123–170. |
| Penegakan penugasan di scan dan Manual Entry | `apps/api/src/routes/scan.ts` baris 255–267; `apps/api/src/routes/attendance.ts` baris 374–388. |
| Kontrak hasil scan stabil | `packages/shared/src/attendance.ts`; `apps/api/src/routes/scan.ts`. |
| QR opaque + rotasi | ADR-0003, ADR-0006, ADR-0017; tidak berubah di Q6. |
| Scanner kamera + fallback ZXing | `apps/web/src/components/qr-scanner.tsx`; `@zxing/browser` sudah menjadi dependensi. |
| Audit allowlist | `packages/shared/src/audit-allowlist.ts`; perlu entitas `staff_assignment`. |
| Gate Q5 | Ditutup 14 November 2026 (`docs/IMPLEMENTATION_ROADMAP.md`, Draft v1.15). |

**Tidak ada migrasi baru yang direncanakan.** Q6 hanya menambah query, route, UI, dan tes di atas skema `0011`.

---

## 2. Tujuan

1. Admin Acara dapat menugaskan Petugas ke Aktivitas/Sesi, mencabut penugasan, dan mengaktifkan Manual Check-in per penugasan.
2. Petugas hanya melihat dan memakai konteks yang ditugaskan; backend tetap menolak konteks lain walau URL dimanipulasi.
3. Scanner operasional: kamera dominan, konteks jelas, feedback lima keadaan, audio + mute lokal, indikator jaringan, pemilihan kamera, cooldown, kembali standby otomatis.
4. Tidak ada keberhasilan palsu: error jaringan, error server, sesi berakhir, dan penugasan dicabut dibedakan dari QR tidak valid dan dari sukses.

---

## 3. Bukan cakupan

- **Manual Entry UI** — tetap gap Q5; backend Manual Entry sudah ada dan hanya diuji lewat API. Tidak masuk gate Q6.
- **Konfigurasi pesan/feedback per Tema** (`FR-120`, `FR-121`, bagian konfigurasi `FR-192`) — menunggu AQ-012.
- **Kuota konsumsi** (`D-014` [A]) — Q7. Scanner Q6 hanya untuk transaksi Attendance; state Consumption disiapkan di tipe, bukan diaktifkan.
- **Mode offline / antrean lokal** — dilarang `NG-05`, `FR-122`, `BR-054`.
- **Dashboard/rekap baru** — Q8.
- **E2E browser otomatis (Playwright/Cypress)** — belum ada dan tidak ditambahkan di Q6.
- **Perubahan skema** — tidak ada; jika ternyata dibutuhkan, wajib migrasi baru + catatan `DESAIN_DATABASE.md`, bukan edit `0011`.

---

## 4. Arah desain (ui-ux-pro-max)

Pencarian dijalankan dengan `python3` (3.15.2) terhadap data skill. Hasil yang dipakai dan yang ditolak:

| Aspek | Keputusan | Alasan |
|---|---|---|
| Gaya | **Minimalism & Swiss Style** | Alat operasional lapangan: kontras tinggi, grid rapi, teks tegas, tanpa dekorasi. |
| Pattern landing/“Immersive”/“Hero + CTA” | **Ditolak** | Scanner bukan halaman marketing; CTA/hero tidak relevan dan menambah noise. |
| Palet skill (gelap/navy) | **Ditolak** | Proyek sudah punya token monokrom; palet baru akan melanggar konsistensi dan kontras yang sudah diuji. |
| Tipografi Google Fonts | **Ditolak** | `AC-053`/`NFR-021` melarang runtime CDN; font proyek dipertahankan. |
| Ikon | **Lucide** | Aturan repo. Pemetaan dari skill: `check-circle` → `CheckCircle2`, `warning-circle` → `AlertCircle`, `x-circle` → `XCircle`, `camera` → `Camera`, `camera-rotate` → `SwitchCamera` (jika tersedia; fallback `RefreshCw`). |
| Motion | Minimal, fungsional | Tidak ada animasi dekoratif; transisi hanya opacity/warna 150 ms; hormati `prefers-reduced-motion`. |
| Density | Standar (4/8 px rhythm) | Target sentuh ≥44 px; kamera tetap dominan. |

Aturan visual yang mengikat implementasi:

- Hanya token yang sudah ada: `background`, `foreground`, `muted`, `muted-foreground`, `border`, `primary`, `primary-foreground`, `destructive`, `success`/`warning` yang sudah dipakai `alert.tsx`.
- Label mikro: `text-xs uppercase tracking-wide text-muted-foreground`.
- Tidak ada bayangan tebal; satu `border` tipis dan `rounded-xl` maksimum.
- Status wajib punya **teks + ikon**, bukan warna saja (`AC-053`).
- Layout scanner: konteks (atas) → kamera (tengah, dominan) → kontrol (bawah). Di landscape, kamera `aspect-video`; portrait `aspect-[3/4]`.

---

## 5. Model domain dan otorisasi

### 5.1 Aksi izin baru

`apps/api/src/domain/permissions.ts`:

```ts
| "assignment:manage"
```

`MIN_MEMBERSHIP["assignment:manage"] = "event_admin"`.

- Super Admin lolos lewat aturan global (kelola penugasan lintas Tema).
- Admin Acara hanya untuk Tema tempat ia `event_admin`.
- Petugas **tidak pernah** (403), termasuk atas penugasannya sendiri.
- Tidak ada izin baru untuk membaca konteks sendiri; endpoint `/api/staff/assignments` hanya mengembalikan baris milik pengguna yang login.

### 5.2 Aturan penugasan

1. Target `userId` harus punya membership **aktif** dengan peran `officer` pada Tema. Admin Acara tidak perlu penugasan untuk scan; menugaskannya ditolak `422`.
2. `activityId` wajib, harus milik Tema, dan bukan `archived`. Aktivitas `draft`/`completed` boleh ditugaskan tetapi scanner menandainya belum siap.
3. `sessionId` opsional. Bila diisi, Sesi harus milik Aktivitas itu dan tidak `archived`. Bila Aktivitas punya Sesi, penugasan level Aktivitas tetap sah dan mencakup seluruh Sesi.
4. Duplikasi penugasan aktif dicegah partial unique index `uq_assignment_activity`/`uq_assignment_session`; pelanggaran → `409 CONFLICT`, bukan 500.
5. Mencabut = `status='revoked'`, `revoked_at`, `updated_at`, `updated_by`. Tidak ada `DELETE`.
6. Mengubah Aktivitas/Sesi pada penugasan yang sudah ada = cabut + buat baru. `PATCH` hanya untuk `canManualCheckIn`. Ini menjaga riwayat siapa ditugaskan pada konteks apa.
7. Pencabutan tidak menyentuh `transactions` (`BR-052`, `FR-104`).
8. `canManualCheckIn` hanya relevan untuk Petugas; nilai default `false`; hanya Admin Acara/Tema yang boleh mengubah.

### 5.3 Efektivitas penugasan

- Penugasan Sesi lebih spesifik daripada penugasan Aktivitas.
- `findEffectiveAssignment` yang ada sudah menerapkan aturan ini; Q6 tidak mengubahnya.
- `canManualCheckIn` yang dipakai route Manual Entry adalah milik penugasan efektif, bukan gabungan.

---

## 6. Permukaan API

Semua route event otomatis mendapat alias `/api/calendar` dan `/api/themes` lewat `withEventAliases`.

### 6.1 `GET /api/events/:eventId/assignments`

Peran: `assignment:manage` (Admin Acara, Super Admin).

Query: `?status=active|revoked|all` (default `active`).

```jsonc
{
  "ok": true,
  "data": {
    "assignments": [
      {
        "id": "01J...",
        "themeId": "01J...",
        "userId": "01J...",
        "userDisplayName": "Budi",
        "activityId": "01J...",
        "activityName": "Absensi",
        "sessionId": null,
        "sessionName": null,
        "canManualCheckIn": false,
        "status": "active",
        "createdAt": 1730000000000,
        "updatedAt": 1730000000000,
        "revokedAt": null
      }
    ]
  }
}
```

Satu query join `staff_assignments` → `users` → `activities` → `activity_sessions`. Tidak ada paginasi (jumlah penugasan per Tema kecil); batas aman 500 baris didokumentasikan.

### 6.2 `POST /api/events/:eventId/assignments`

Peran: `assignment:manage`; Tema harus mutable.

```jsonc
// request
{
  "userId": "01J...",
  "activityId": "01J...",
  "sessionId": "01J...",          // opsional
  "canManualCheckIn": false       // opsional, default false
}

// 201
{ "ok": true, "data": { "assignment": { /* bentuk sama seperti 6.1 */ } } }
```

Validasi dan error:

| Kondisi | HTTP | `code` |
|---|---|---|
| Body gagal schema | 400 | `VALIDATION_ERROR` |
| Bukan Admin Acara/Super Admin | 403 | `FORBIDDEN` |
| Tema/aktivitas/sesi tidak ada atau beda Tema | 404 | `NOT_FOUND` |
| Target bukan Petugas aktif Tema | 422 | `BUSINESS_RULE` |
| Aktivitas/Sesi diarsipkan | 422 | `BUSINESS_RULE` |
| Duplikasi penugasan aktif | 409 | `CONFLICT` |

### 6.3 `PATCH /api/events/:eventId/assignments/:assignmentId`

Peran: `assignment:manage`; Tema mutable. Hanya `canManualCheckIn`.

```jsonc
// request
{ "canManualCheckIn": true }

// 200
{ "ok": true, "data": { "assignment": { /* ... */ } } }
```

`allowed`/`denied` entitlement tetap terpisah; flag ini hanya membuka Manual Entry, bukan mengubah entitlement (`FR-101`, `BR-051`).

### 6.4 `POST /api/events/:eventId/assignments/:assignmentId/revoke`

Peran: `assignment:manage`; Tema mutable. Tanpa body.

```jsonc
// 200
{ "ok": true, "data": { "assignment": { "status": "revoked", ... } } }
```

- Penugasan yang sudah `revoked` → `404 NOT_FOUND` (idempoten dari sisi efek, bukan sukses palsu).
- Riwayat transaksi tidak berubah.

### 6.5 `GET /api/staff/assignments`

Peran: semua pengguna terautentikasi; hanya mengembalikan penugasan aktif milik sendiri. Dipakai scanner untuk memilih konteks.

Bentuk flat, satu baris = satu konteks yang dapat dipilih:

```jsonc
{
  "ok": true,
  "data": {
    "contexts": [
      {
        "assignmentId": "01J...",
        "themeId": "01J...",
        "themeName": "Percobaan",
        "activityId": "01J...",
        "activityName": "Absensi",
        "sessionId": null,
        "sessionName": null,
        "activityStatus": "active",
        "sessionStatus": null,
        "canManualCheckIn": false
      }
    ]
  }
}
```

Aturan ekspansi (fungsi murni, diuji):

1. Ambil penugasan aktif pengguna.
2. Penugasan Aktivitas tanpa Sesi → satu konteks `sessionId = null`.
3. Penugasan Aktivitas yang punya Sesi → satu konteks per Sesi tidak diarsipkan.
4. Penugasan Sesi → konteks Sesi itu, dan **menimpa** hasil ekspansi Aktivitas untuk Sesi yang sama (termasuk `canManualCheckIn`).
5. Aktivitas/Sesi `archived` tidak diekspansi; jika hasilnya kosong, UI menampilkan "Penugasan belum siap".
6. Status lifecycle tetap dikirim (`activityStatus`, `sessionStatus`) agar UI dapat menonaktifkan konteks dengan alasan teks, sementara backend tetap penentu akhir.

### 6.6 Audit

| Aksi | `action` | `entity_type` | Snapshot |
|---|---|---|---|
| Buat | `assignment.created` | `staff_assignment` | `after` |
| Ubah flag | `assignment.updated` | `staff_assignment` | `before` + `after` |
| Cabut | `assignment.revoked` | `staff_assignment` | `before` + `after` |

Field allowlist baru: `themeId`, `activityId`, `sessionId`, `userId`, `canManualCheckIn`, `status`, `revokedAt`. **Tidak** ada nama tampilan, email, atau token. Audit ditulis dalam `db.batch()` yang sama dengan mutasi.

---

## 7. Lapisan data

`apps/api/src/db/staff-assignments.ts` ditambah (tanpa mengubah fungsi Q5 kecuali `createdBy`):

| Fungsi | Query | Catatan |
|---|---|---|
| `listThemeAssignments(db, themeId, status)` | 1 join | Urut `created_at`, `id`. |
| `findAssignmentById(db, themeId, assignmentId)` | 1 | Scope Tema. |
| `listUserContexts(db, userId)` | 1 join | Hanya `active`; join Tema/Aktivitas/Sesi. |
| `insertStaffAssignmentStatement(...)` | 1 | Tambah `createdBy`; Q5 belum memakainya. |
| `updateAssignmentManualFlagStatement(...)` | 1 | `can_manual_check_in`, `updated_at/by`. |
| `revokeStaffAssignmentStatement(...)` | 1 | `status`, `revoked_at`, `updated_at/by`. |

Fungsi murni ekspansi konteks di `apps/api/src/domain/staff-context.ts`, dengan tes tanpa I/O.

Indeks yang sudah tersedia: `uq_assignment_activity`, `uq_assignment_session`, `idx_assignment_user_theme`, `idx_assignment_activity_status`. Tidak ada indeks baru.

Perkiraan statement per request: list 1, konteks sendiri 1, create 8–12, patch 6–8, revoke 6–8 (termasuk auth, validasi, mutasi, audit, baca ulang). Semua jauh di bawah 50.

---

## 8. Scanner: state machine dan perilaku

### 8.1 Fase

```ts
export const FEEDBACK_DURATION_MS = 2000;

export type ScannerPhase = "standby" | "processing" | "feedback" | "offline";

export interface ScannerState {
  phase: ScannerPhase;
  feedback: ScanFeedback | null;
  lockedUntil: number | null;
}
```

| Event | Dari | Ke | Efek |
|---|---|---|---|
| `detected` | `standby` | `processing` | Kirim satu request; abaikan deteksi lain. |
| `resolved` | `processing` | `feedback` | Isi feedback; `lockedUntil = at + 2000`. |
| `feedback_elapsed` | `feedback` (`at >= lockedUntil`) | `standby` | Hapus feedback. |
| `network_offline` | `standby`/`processing`/`feedback` | `offline` | Hentikan pengiriman; feedback error jaringan bila ada request. |
| `network_online` | `offline` | `standby` | Siap lagi. |
| `context_changed` | `standby` saja | `standby` | Hapus feedback; konteks baru wajib divalidasi ulang. |
| `reset` | semua | `standby` | Hapus feedback. |

Aturan tambahan:

- `detected` saat `processing`, `feedback`, atau `offline` **diabaikan**.
- Timer feedback memakai `setTimeout` yang dibersihkan saat unmount; tidak ada tes yang bergantung jam nyata (inject `at`).
- Tidak ada antrean: request yang gagal tidak disimpan untuk dikirim ulang otomatis (`FR-122`, `BR-054`).
- Debounce QR yang sama tetap di `QrScanner` (per payload + 900 ms) dan `inFlight` ref di halaman; keduanya lapisan UX, bukan pengganti unique index (`FR-125`, `BR-055`).

### 8.2 Klasifikasi respons/error

`apiRequest` melempar error untuk kegagalan jaringan; envelope `ok:false` untuk error HTTP.

| Sumber | Feedback | Tone | Teks utama |
|---|---|---|---|
| `SUCCESS` | `success` | hijau + `CheckCircle2` | "Kehadiran tercatat" + nama peserta |
| `DUPLICATE` | `warning` | amber + `AlertCircle` | "Sudah pernah absen" + waktu pertama |
| `NOT_ENTITLED` | `warning` | amber + `AlertCircle` | pesan `reason` (mis. lifecycle/entitlement) |
| `INVALID_QR` | `error` | merah + `XCircle` | "QR tidak dikenali" |
| `fetch` reject / `TypeError` | `network` | merah + `WifiOff` | "Tidak ada koneksi. Scan **belum** tercatat." |
| `ok:false` `INTERNAL`/`DB_UNAVAILABLE` | `system` | merah + `XCircle` | "Server bermasalah. Scan **belum** tercatat." |
| `ok:false` `UNAUTHENTICATED` | `session` | merah + `LogIn` | "Sesi berakhir. Masuk kembali." |
| `ok:false` `FORBIDDEN` | `assignment` | merah + `ShieldAlert` | "Penugasan berubah. Muat ulang konteks." |
| `ok:false` `NOT_FOUND`/`BUSINESS_RULE` konteks | `context` | merah + `AlertCircle` | pesan server |
| `ok:false` `RATE_LIMITED` | `system` | amber + `Timer` | "Terlalu banyak scan. Tunggu …" |
| payload `ok:true` dengan `result` tak dikenal | `system` | merah | **Tidak pernah** sukses (`AC-048`). |

Fungsi murni `classifyScanResponse(response)` dan `classifyScanFailure(error)` di `apps/web/src/lib/scanner.ts`.

### 8.3 Audio

`apps/web/src/lib/scan-audio.ts`:

- Web Audio API (`OscillatorNode`), tanpa aset dan tanpa dependensi.
- Satu `AudioContext` lazy; dibuat/di-resume pada gesture pengguna (mulai kamera atau toggle mute) agar iOS Safari mengizinkan.
- Nada: sukses 880 Hz/120 ms, peringatan 440 Hz/180 ms, error 220 Hz/300 ms.
- Tidak menumpuk: jika nada sebelumnya masih berbunyi, nada baru dijadwalkan setelah `currentTime + 0.25`; tidak ada antrean tak terbatas (`FR-124`).
- Mute lokal per perangkat: `localStorage` key `absensi:scan:muted`; semua akses dibungkus `try/catch` (mode privat/kuota).
- Audio tidak pernah menjadi satu-satunya indikator; UI tetap menampilkan teks + ikon (`FR-192`, `NFR-022`).

### 8.4 UI scanner

Struktur halaman (`StaffScanPage`):

1. **Header konteks**: nama Tema, Aktivitas, Sesi; label mikro; tombol "Ganti konteks" hanya aktif saat `standby`.
2. **Indikator jaringan**: teks "Online"/"Offline" + ikon; `navigator.onLine` hanya petunjuk awal, kegagalan request adalah kebenaran.
3. **Kamera dominan**: `QrScanner` dengan `paused={phase !== "standby"}`.
4. **Panel feedback**: menggantikan toast kecil; ikon besar, judul, nama peserta, deskripsi; `role="status"` untuk sukses/peringatan, `role="alert"` untuk error; tidak interaktif; hilang otomatis setelah 2 detik.
5. **Kontrol**: mute (`aria-pressed`), ganti kamera depan/belakang, hentikan/mulai kamera.
6. **Keadaan kosong**: belum ada penugasan → "Akun ini belum ditugaskan ke Aktivitas/Sesi. Minta Admin Acara menugaskan Anda."; penugasan ada tetapi lifecycle belum siap → alasan per konteks.

Perubahan `QrScanner`:

- Prop `facingMode: "environment" | "user"` dan callback restart saat berubah.
- `landscape:aspect-video` + batas tinggi agar tidak melampaui viewport.
- Tetap memulai kamera hanya dari klik (iOS).
- Tetap memakai `BarcodeDetector` lalu fallback `@zxing/browser` dinamis.
- Tidak ada akses kamera otomatis di `useEffect`.

### 8.5 Pemilihan konteks

- Sumber: `GET /api/staff/assignments`.
- Bila hanya satu konteks → otomatis dipilih.
- Bila beberapa → `Select` Tema lalu `Select` Aktivitas/Sesi; konteks yang lifecycle-nya tidak siap ditandai teks dan tidak bisa dipilih.
- Deep link `/staff/scan?eventId=&activityId=&sessionId=` hanya preselection. Sebelum scan, halaman mencocokkan dengan daftar konteks milik pengguna; jika tidak cocok, tampilkan penolakan dan jangan kirim request. Backend tetap memvalidasi (`FR-190`).
- Konteks dikunci selama `processing`/`feedback`; mengganti konteks memicu re-fetch daftar konteks (`FR-191`).
- Jika backend mengembalikan 403 `FORBIDDEN`, halaman menandai konteks tidak valid, berhenti memindai, dan menyediakan tombol "Muat ulang konteks".

---

## 9. UI pengelolaan penugasan

Lokasi: tab **Petugas** (`/acara/:eventId/staff`), halaman `event-staff.tsx`, di bawah bagian anggota/undangan yang sudah ada.

### 9.1 Daftar

- Judul "Penugasan scanner" + deskripsi singkat tentang lingkup Aktivitas/Sesi.
- `Table` (shadcn) kolom: Petugas, Aktivitas, Sesi, Manual Check-in, Status, Aksi.
- `Badge` teks: `Aktif`, `Dicabut`, `Manual aktif`, `Belum ditugaskan`.
- Petugas aktif yang belum punya penugasan ditampilkan di blok peringatan dengan tautan "Buat penugasan".
- Baris `revoked` tetap terlihat bila filter `all`/`revoked` dipilih; default `active`.

### 9.2 Buat penugasan (Dialog)

- Petugas: `Select` dari membership `officer` aktif.
- Aktivitas: `Select` dari Aktivitas Tema yang tidak diarsipkan.
- Sesi: `Select`; wajib bila Aktivitas punya Sesi (tidak ada opsi "tanpa sesi" dalam kasus itu); jika tidak punya Sesi, field dinonaktifkan dengan teks "Aktivitas ini tanpa Sesi".
- Manual Check-in: `Checkbox` + hint "Hanya membuka Manual Entry; entitlement tetap terpisah."
- Submit → `POST`; sukses menutup dialog dan me-refresh daftar; error tampil inline di dialog dengan teks server.
- Fokus awal ke field pertama; `Dialog` shadcn menangani focus trap dan Escape.

### 9.3 Ubah dan cabut

- Checkbox manual di baris → `PATCH`; optimistic? **Tidak** — tunggu respons, tampilkan state sibuk, lalu refresh baris.
- "Cabut" → `Dialog` konfirmasi: "Petugas tidak bisa memindai konteks ini lagi. Riwayat transaksi tetap tersimpan." (`BR-052`).
- Tidak ada `window.confirm`.
- Semua aksi hanya dirender untuk `event_admin`/`superadmin`; Petugas yang membuka halaman tetap mendapat 403 dari Worker.

### 9.4 Catatan operasional

Tampilkan satu baris: "Satu perangkat boleh dipakai bergantian, tetapi setiap Petugas wajib memakai akun sendiri." (`FR-105`, `BR-053`).

---

## 10. Perubahan per berkas

### `packages/shared`

| Berkas | Perubahan |
|---|---|
| `src/staff-assignments.ts` (baru) | `StaffAssignment`, `StaffAssignmentListPayload`, `StaffAssignmentDetailPayload`, `StaffContext`, `StaffContextListPayload`. |
| `src/schemas/staff-assignments.ts` (baru) | `StaffAssignmentCreateRequestSchema`, `StaffAssignmentUpdateRequestSchema`, `StaffAssignmentListQuerySchema`, `AssignmentIdSchema`. |
| `src/index.ts` | Ekspor berkas baru. |
| `src/audit-allowlist.ts` | `AuditEntityType` + `staff_assignment`; field allowlist. |
| `src/audit-allowlist.test.ts` | Daftar entity type diperbarui. |

### `apps/api`

| Berkas | Perubahan |
|---|---|
| `src/domain/permissions.ts` | Aksi `assignment:manage` + `MIN_MEMBERSHIP`. |
| `src/domain/staff-context.ts` (baru) | Ekspansi/dedup konteks Petugas; murni. |
| `src/db/staff-assignments.ts` | List/get/update/revoke; `createdBy` pada insert. |
| `src/routes/staff-assignments.ts` (baru) | Empat route event + satu route staff; validasi, otorisasi, audit, `db.batch()`. |
| `src/app.ts` | Registrasi `staffAssignmentRoutes`. |
| `src/routes/staff-assignments.test.ts` (baru) | Tes API/otorisasi/audit/integritas. |
| `src/domain/staff-context.test.ts` (baru) | Tes murni ekspansi konteks. |
| `src/test/permissions.test.ts` | Matriks otomatis mencakup aksi baru; ekspektasi eksplisit bila ada. |
| `src/test/transactions.statements.test.ts` atau tes baru | Catat jumlah statement create/patch/revoke/konteks. |

`apps/api/src/routes/scan.ts` **tidak diubah** untuk otorisasi; penugasan sudah ditegakkan. Perubahan hanya bila tes menemukan celah.

### `apps/web`

| Berkas | Perubahan |
|---|---|
| `src/lib/activities.ts` (baru) | `listActivities`, `listActivitySessions` (dibutuhkan UI penugasan; belum ada binding). |
| `src/lib/assignments.ts` (baru) | Binding list/create/update/revoke + `listMyStaffContexts`. |
| `src/lib/assignments.test.ts` (baru) | Path/query builder murni. |
| `src/lib/scanner.ts` | State machine, klasifikasi respons/error, copy lima keadaan, helper konteks. |
| `src/lib/scanner.test.ts` (perluas/baru) | Tes murni state machine, klasifikasi, aksesibilitas teks. |
| `src/lib/scan-audio.ts` (baru) | Nada Web Audio + mute lokal. |
| `src/lib/scan-audio.test.ts` (baru) | Bagian murni (nada, preferensi mute, no-op saat tidak tersedia). |
| `src/components/qr-scanner.tsx` | `facingMode`, restart aman, orientasi, label aksesibilitas. |
| `src/components/scan-feedback.tsx` (baru) | Panel hasil besar; menggantikan pemakaian `scan-toast.tsx` di scanner. |
| `src/components/scan-toast.tsx` | Tetap ada bila masih dipakai layar lain; jika tidak, hapus dengan konfirmasi. |
| `src/pages/staff.tsx` | `StaffScanPage` ditulis ulang; `StaffHomePage`/`StaffHistoryPage` tetap. |
| `src/pages/event-staff.tsx` | Bagian penugasan + dialog buat/cabut + toggle manual. |
| `src/pages/staff-scan.tsx` | **Dihapus** (kode mati, disetujui pemilik). |

Tidak ada dependensi npm baru. `@zxing/browser`, shadcn/ui, Lucide, dan Web API sudah cukup.

### `docs`

| Berkas | Perubahan |
|---|---|
| `docs/DESAIN_API.md` | §4 tabel + kontrak penugasan; §7 `GET /api/staff/assignments`; jumlah route 87 → 92 definisi, 227 → 240 pola efektif. |
| `docs/DESAIN_DATABASE.md` | Catatan bahwa Q6 tidak mengubah skema; query/index penugasan. |
| `docs/RENCANA_PENGUJIAN.md` | T-105–T-107; status implementasi §9.6 setelah tes ada. |
| `docs/OPERASIONAL.md` | Prosedur uji perangkat (iPhone/Android), audio/mute, izin kamera, jaringan mati. |
| `docs/DECISIONS.md` | Perbaiki pemetaan fase `D-012`/`D-013` → Q6 dan `D-014` → Q7 (saat ini tertukar). Tidak ada ADR baru. |
| `docs/IMPLEMENTATION_ROADMAP.md` | Status implementasi setelah gate; bukan sekarang. |

---

## 11. Tes

### 11.1 Wajib (RENCANA_PENGUJIAN §9.6)

| ID | Tes | Berkas |
|---|---|---|
| T-100 ★ | Petugas tanpa penugasan ditolak backend walau URL mengirim `activityId`/`sessionId`; Admin Acara tetap boleh | `apps/api/src/routes/scan.test.ts` + `staff-assignments.test.ts` |
| T-101 ★ | Pencabutan tugas tidak menghapus transaksi historis Petugas itu | `apps/api/src/routes/staff-assignments.test.ts` |
| T-102 | Kesalahan jaringan dipetakan berbeda dari QR tidak valid (murni) | `apps/web/src/lib/scanner.test.ts` |
| T-103 | State scanner: terkunci selama feedback, kembali standby, tidak ada antrean offline (murni) | `apps/web/src/lib/scanner.test.ts` |
| T-104 | Setiap state punya teks/ikon, bukan hanya warna (murni) | `apps/web/src/lib/scanner.test.ts` |
| T-105 ★ | CRUD penugasan: hanya Admin Acara/Super Admin; Petugas 403; audit ditulis dalam batch yang sama | `apps/api/src/routes/staff-assignments.test.ts` |
| T-106 ★ | Penugasan lintas Tema/Aktivitas/Sesi ditolak; duplikasi aktif → 409; Sesi harus milik Aktivitas | `apps/api/src/routes/staff-assignments.test.ts` |
| T-107 ★ | Manual Check-in flag per penugasan: Petugas tidak bisa mengubah; flag efektif dipakai Manual Entry | `apps/api/src/routes/staff-assignments.test.ts` + `attendance` |

### 11.2 Tes murni tambahan

- Ekspansi konteks: aktivitas tanpa Sesi, aktivitas dengan Sesi, penugasan Sesi menimpa Aktivitas, dedup, archived dikecualikan, status lifecycle dikirim.
- `classifyScanResponse`: `SUCCESS` hanya untuk result yang dikenal; payload tak dikenal → `system` (tidak pernah sukses).
- `classifyScanFailure`: network vs 401 vs 403 vs 404/422 vs 429 vs 5xx.
- State machine: event tidak valid diabaikan; `feedback_elapsed` sebelum waktunya tidak membuka kunci.
- Audio: pemetaan tone→frekuensi/durasi; mute membaca/menulis aman saat `localStorage` melempar.
- Pembangun path/query assignment.

### 11.3 Tes yang harus **gagal** bila aturan dihapus

- Hapus pengecekan `findEffectiveAssignment` di scan → T-100 gagal.
- Hapus `status='active'` pada query konteks → Petugas yang dicabut masih bisa scan → T-101/T-106 gagal.
- Hapus partial unique index dari skema uji → duplikasi tidak lagi 409.
- Hapus audit dari `db.batch()` → T-105 gagal.
- Ganti `FORBIDDEN` menjadi sukses di UI → T-102/T-103 gagal.

---

## 12. Urutan kerja

### Fase A — Kontrak dan izin

1. Tambah tipe + schema `staff-assignments` di `packages/shared`.
2. Tambah `staff_assignment` ke audit allowlist dan perbarui tesnya.
3. Tambah `assignment:manage` di matriks izin.

Gate fase: `npm run typecheck` + tes shared/permissions hijau.

### Fase B — Data dan API

1. Tambah query DB dan fungsi murni ekspansi konteks.
2. Implementasi lima route + audit + `db.batch()`.
3. Registrasi route di `app.ts`.
4. Tes API T-100, T-101, T-105, T-106, T-107.

Gate fase: `npm run test -- apps/api/src/routes/staff-assignments.test.ts` hijau; hitung statement.

### Fase C — UI penugasan

1. Binding `activities`/`sessions` dan `assignments` di web.
2. Bagian penugasan di `event-staff.tsx` + dialog.
3. Tes path/query builder dan aturan tampilan murni (bila diekstrak).

Gate fase: `typecheck` + `lint` hijau; alur buat/ubah/cabut diuji manual di lokal.

### Fase D — Scanner

1. State machine + klasifikasi + audio di `lib/`.
2. `QrScanner` menerima `facingMode` dan orientasi.
3. `ScanFeedback` + `StaffScanPage` baru.
4. Hapus `pages/staff-scan.tsx`; pastikan tidak ada impor tersisa.
5. Tes T-102–T-104.

Gate fase: `typecheck` + `lint` + tes web hijau.

### Fase E — Dokumen dan verifikasi

1. Perbarui `DESAIN_API.md`, `DESAIN_DATABASE.md`, `RENCANA_PENGUJIAN.md`, `OPERASIONAL.md`, `DECISIONS.md`.
2. Jalankan `npm run typecheck` → `npm run lint` → `npm run test` → `npm run build`.
3. `git diff --check`.
4. Uji perangkat fisik oleh pemilik (lihat §14).

### Fase F — Gate

1. Isi status implementasi di `IMPLEMENTATION_ROADMAP.md` dan `RENCANA_PENGUJIAN.md` §9.6.
2. Catat hasil uji perangkat di `OPERASIONAL.md`.
3. Minta review manusia sebelum menutup gate Q6.

---

## 13. Perintah verifikasi

```bash
npm run typecheck
npm run lint
npm run test
npm run build

# terfokus saat iterasi
npm run test -- apps/api/src/routes/staff-assignments.test.ts
npm run test -- apps/web/src/lib/scanner.test.ts
npm run test -- apps/api/src/test/permissions.test.ts

git diff --check
```

Aturan repo: jangan klaim selesai bila salah satu dari `typecheck`/`lint`/`test` belum dijalankan. Suite penuh di akhir; iterasi memakai tes terfokus.

---

## 14. Gate akhir Q6

- `AC-026`–`AC-028`, `AC-048`, `AC-053` lulus dengan tes yang gagal bila aturannya dihapus.
- T-100–T-107 ada dan hijau.
- Petugas tanpa penugasan → 403 walau URL memilih konteks.
- Pencabutan tugas tidak mengubah transaksi historis.
- Error jaringan, error server, sesi berakhir, dan penugasan dicabut tidak pernah tampil sebagai sukses.
- Scanner mengunci pemrosesan selama feedback dan kembali standby ±2 detik.
- Setiap status punya teks + ikon; audio dapat dimatikan; scanner tetap usable tanpa audio.
- Uji perangkat fisik tercatat di `OPERASIONAL.md`:
  - iPhone Safari (fallback ZXing) dan Android Chrome (`BarcodeDetector`).
  - 20 scan berturut tanpa reload.
  - Kamera depan dan belakang; portrait dan landscape.
  - Jaringan dimatikan → pesan actionable, bukan sukses.
  - Mute bertahan setelah reload; audio tidak menumpuk.
  - Penugasan dicabut saat halaman terbuka → 403 dan tombol muat ulang konteks.
- `typecheck`, `lint`, `test`, `build` hijau.
- Tidak ada dependensi baru, tidak ada migrasi baru, tidak ada secret di dokumen/log.
- Review manusia sebelum tahap berikutnya (Q7).

---

## 15. Rollout dan rollback

- Tidak ada migrasi. Deploy Worker + web bersamaan lewat Workers Builds.
- Route baru additive; route lama tidak berubah.
- Rollback = deploy versi sebelumnya. Data penugasan yang dibuat Q6 tetap valid karena skema sudah ada sejak Q5.
- `staff_assignments` yang dicabut tidak dihapus; rollback tidak menghidupkannya kembali.
- Jangan mengubah `0011`; bila perlu perbaikan skema, buat `0012`.
- Pemilik proyek yang menjalankan `git push`/deploy.

---

## 16. Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Kamera butuh HTTPS/izin; iOS hanya dari gesture | Scanner tidak start | Tetap klik-untuk-mulai; pesan izin actionable; uji perangkat |
| `BarcodeDetector` tidak ada di iOS | Decode gagal | Fallback ZXing dinamis yang sudah ada; uji iPhone |
| AudioContext diblokir sebelum gesture | Tidak ada suara | Resume pada klik kamera/toggle mute; audio bukan satu-satunya indikator |
| Penugasan dicabut saat sesi berjalan | 403 di tengah scan | Tangani `FORBIDDEN` sebagai state khusus + muat ulang konteks |
| Konteks berubah saat feedback | Scan salah konteks | Kunci pemilihan konteks selama `processing`/`feedback`; backend tetap validasi |
| Duplikasi penugasan paralel | Dua baris aktif | Partial unique index; 409; tes konkuren |
| `navigator.onLine` menyesatkan | Indikator "online" padahal gagal | Indikator hanya petunjuk; kegagalan request adalah kebenaran |
| UI admin membengkak | Halaman lambat | Satu query list + dialog; tanpa N+1; tabel sederhana |
| Audit menyimpan PII | Pelanggaran privasi | Allowlist hanya ID/flag/status; tes allowlist |
| Timer feedback diuji dengan jam nyata | Flaky | State machine murni dengan `at` yang di-inject |
| `localStorage` diblokir | Mute gagal disimpan | `try/catch`; fallback in-memory per sesi |
| Bundle ZXing | Initial load berat | Sudah dynamic import; jangan pindahkan ke import statis |
| Perangkat bersama | Transaksi atas nama Petugas lain | UI mengingatkan akun sendiri; backend mencatat `recordedBy` |

---

## 17. Ditunda dan pertanyaan terbuka

- **AQ-012** — pesan scanner per Tema, variabel `{nama}`/`{id}`/`{acara}`/`{waktu}`, batas data peserta ke kiosk. Q6 memakai pesan bawaan deterministik. Jika AQ-012 dijawab sebelum Q6 selesai, konfigurasi pesan tetap pekerjaan terpisah dan tidak boleh menunda gate inti.
- **Manual Entry UI** — gap Q5; backend siap, UI belum. Bisa dimasukkan ke Q7 atau tahap khusus dengan persetujuan pemilik.
- **Konsumsi** — Q7; state `Consumption` di tipe scanner disiapkan, tetapi route/kuota tidak diaktifkan di Q6.
- **E2E browser** — belum ada; uji perangkat manual menjadi bukti gate.

---

## 18. Catatan status

- Dokumen ini **rencana**, bukan bukti implementasi. Status implementasi diisi setelah kode dan tes ada.
- Perubahan status gate Q6 hanya ditulis setelah verifikasi dan review manusia.
- Jangan menyalin isi `REQUIREMENTS.md` ke dokumen ini; rujuk `FR-`/`BR-`/`AC-`.
