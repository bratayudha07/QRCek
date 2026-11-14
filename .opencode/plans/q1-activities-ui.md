# Delta UI Q1 — Aktivitas & Sesi

Tanggal: 14 November 2026
Status: **implementasi selesai** (UI-only; API Q1 sudah live dan teruji). Verifikasi lokal
`typecheck`/`lint`/**809 tes di 78 file**/`build` hijau. E2E produksi dan prosedur
`OPERASIONAL.md` §12.3 belum dijalankan.
Prasyarat: delta Q2 Kategori dan Q3 Hak Peserta selesai.

## Tujuan

Admin dapat membuat dan mengelola Aktivitas serta Sesi dari UI. Tanpa ini Tema baru tidak
punya Aktivitas sama sekali (pembuatan Tema tidak membuat Aktivitas default), sehingga scanner
dan Q7 tidak bisa dipakai. Menutup `FR-181`–`FR-190`, `AC-028`, `AC-048`, dan lifecycle
`ADR-0012` dari sisi UI.

## Keputusan UI

- **Lokasi:** tab baru **“Aktivitas”** di workspace Tema, ditempatkan setelah **Ringkasan**
  (urutan: Ringkasan, Aktivitas, Peserta, Petugas, Absensi, Laporan, Hak).
- Satu halaman master-detail: tabel Aktivitas, lalu panel Sesi untuk Aktivitas terpilih.
- Jenis transaksi (`attendance`/`consumption`) **hanya dipilih saat membuat** Aktivitas. Saat
  mengubah, field ini ditampilkan sebagai teks baca-saja dengan penjelasan bahwa jenis tidak
  bisa diubah (kontrak `ActivityUpdateRequestSchema`).
- Tombol transisi status hanya menampilkan transisi yang diizinkan
  (`allowedActivityTransitions`/`allowedSessionTransitions`); Worker tetap otoritatif.
- Waktu Sesi diisi lewat `datetime-local` dan ditafsirkan dalam **zona waktu Tema**, bukan zona
  perangkat. Ditampilkan dengan `formatSchedule` yang sudah ada.
- Petugas dan Tema arsip bersifat baca-saja (kontrol tulis tidak dirender).

## Cakupan

### 1. `apps/web/src/lib/activities.ts` (perluas)

Tambahkan binding:

- `POST /api/events/:eventId/activities` (`createActivity`)
- `PATCH /api/events/:eventId/activities/:activityId` (`updateActivity`)
- `POST /api/events/:eventId/activities/:activityId/status` (`changeActivityStatus`)

Helper murni (diuji):

- `activityStatusLabel(status)` → Draf / Aktif / Selesai / Diarsipkan.
- `transactionTypeLabel(type)` → Absensi / Konsumsi.
- `activityTransitionActions(status)` → daftar `{ status, label }` dari
  `allowedActivityTransitions` (Aktifkan, Selesaikan, Arsipkan).
- `canManageActivities(accessRole, eventStatus)` → `event_admin`/`superadmin`, Tema tidak arsip.

### 2. `apps/web/src/lib/activity-sessions.ts` (baru)

Binding:

- `POST/GET .../sessions`, `GET/PATCH .../sessions/:sessionId`
- `POST .../sessions/:sessionId/status`
- `POST .../sessions/:sessionId/archive`
- `POST .../sessions/:sessionId/duplicate`

Helper murni:

- `sessionStatusLabel(status)` → Terjadwal / Berlangsung / Selesai / Dinonaktifkan.
- `sessionTransitionActions(status)` dari `allowedSessionTransitions`.
- `canArchiveActivitySession(session)` → `archivedAt === null && canArchiveSession(status)`.
- `sessionTimeRangeError(startsAt, endsAt)` → pesan validasi klien (selaras dengan skema).
- `sortSessions` bila perlu; API sudah mengurutkan, jadi jangan mengubah urutan tanpa alasan.

### 3. `apps/web/src/lib/activity-time.ts` (baru)

Konversi dua arah antara `datetime-local` dan epoch ms dalam zona waktu Tema:

- `localInputToEpoch(value: string, timeZone: string): number | null`
- `epochToLocalInput(epoch: number, timeZone: string): string`

Implementasi memakai `Intl.DateTimeFormat` (Web API, tanpa dependency) dan menangani offset
dua langkah. Tes memakai `Asia/Jakarta` dan satu zona DST (`America/New_York`), termasuk round
trip dan input tidak valid.

### 4. `apps/web/src/pages/event-activities.tsx` (baru)

Struktur:

1. Header “Aktivitas & Sesi”, penjelasan singkat, notice baca-saja bila perlu.
2. **Tabel Aktivitas**: Nama, Jenis, Status, Lokasi, Urutan, Aksi.
   - Tombol **Tambah Aktivitas** membuka dialog (nama, deskripsi, jenis transaksi, lokasi,
     urutan).
   - Tombol **Ubah** membuka dialog edit (jenis transaksi baca-saja).
   - Tombol transisi status sesuai helper; arsip memakai konfirmasi.
   - Tombol **Sesi** memilih Aktivitas untuk panel di bawah (default: Aktivitas aktif pertama,
     utamakan `attendance`).
   - Aktivitas arsip tetap tampil dengan badge dan tanpa aksi tulis.
3. **Panel Sesi** untuk Aktivitas terpilih: tabel Nama, Waktu, Lokasi, Status, Aksi.
   - **Tambah Sesi** (nama, lokasi, mulai, selesai) dengan validasi waktu klien.
   - **Ubah**, transisi status, **Duplikat**, dan **Arsipkan** hanya bila
     `canArchiveActivitySession`.
   - Empty state jelas bila Aktivitas belum punya Sesi.
4. Setiap mutasi: kirim satu request, tampilkan error API apa adanya, muat ulang daftar setelah
   `ok`. Tidak ada optimistic success.

State: `loading | ready | error` terpisah untuk Tema, Aktivitas, dan Sesi.

### 5. Navigasi & tes

- `router.ts`: `EVENT_TAB_KEYS` tambah `"activities"` (setelah `"overview"`).
- `navigation.ts`: label “Aktivitas” pada posisi setelah Ringkasan.
- `event-tabs.tsx`: ikon `CalendarClock`, grid 7 kolom, `min-w` disesuaikan.
- `event-workspace.tsx`: case `activities`.
- Perbarui `router.test.ts`, `navigation.test.ts`, `palette.test.ts` (tujuh tab).

## File yang disentuh

- `apps/web/src/lib/activities.ts` + tes baru `activities.test.ts`
- `apps/web/src/lib/activity-sessions.ts` (baru) + tes
- `apps/web/src/lib/activity-time.ts` (baru) + tes
- `apps/web/src/pages/event-activities.tsx` (baru)
- `apps/web/src/lib/router.ts`, `navigation.ts`, tes router/navigation/palette
- `apps/web/src/components/event-tabs.tsx`, `apps/web/src/pages/event-workspace.tsx`

Tidak menyentuh Worker, migrasi, atau `packages/shared`.

## Acceptance

- [ ] Tema baru tanpa Aktivitas: buat Aktivitas `attendance` dari UI, aktifkan, lalu scan
      Petugas berjalan (setelah hak peserta diatur).
- [ ] Buat Aktivitas `consumption`; jenis transaksi tidak bisa diubah setelah dibuat.
- [ ] Transisi status hanya menampilkan opsi yang valid; `draft → active` gagal dengan pesan
      kelengkapan hak peserta ditampilkan apa adanya.
- [ ] Buat Sesi dengan waktu; waktu tampil sesuai zona waktu Tema, bukan zona perangkat.
- [ ] Sesi bisa diubah, dimulai/diselesaikan/dinonaktifkan, diduplikasi, dan diarsipkan hanya
      setelah selesai/dinonaktifkan.
- [ ] Sesi arsip tetap terlihat tetapi tanpa aksi tulis.
- [ ] Petugas dan Tema arsip baca-saja; Worker tetap menolak tulis.
- [ ] Empty/loading/error state jelas; tidak ada sukses palsu.
- [ ] Tidak ada dependency atau migrasi baru.

## Verifikasi

```bash
npm run typecheck
npm run lint
npm run test -- apps/web/src/lib/activities.test.ts apps/web/src/lib/activity-sessions.test.ts apps/web/src/lib/activity-time.test.ts apps/web/src/lib/router.test.ts apps/web/src/lib/navigation.test.ts apps/web/src/lib/palette.test.ts
npm run test
npm run build
```

Manual: buat Aktivitas attendance + Sesi → atur hak peserta → scan; buat Aktivitas consumption
dan pastikan belum muncul di scanner attendance; arsipkan Sesi setelah selesai. Catat di
`docs/OPERASIONAL.md` §12 dan `docs/RENCANA_PENGUJIAN.md`.

## Out of scope

- Kuota konsumsi (Q7).
- Scanner UI (Q6, selesai).
- Reorder drag-and-drop; urutan diisi lewat angka.
- Bulk actions, impor Aktivitas/Sesi.
- Polish visual/design system (Q9).
