# Delta UI Q5 — Manual Entry

Tanggal: 14 November 2026
Status: **implementasi selesai** (UI-only; API Q5 sudah live dan teruji). Verifikasi lokal
`typecheck`/`lint`/**819 tes di 79 file**/`build` hijau. E2E produksi dan prosedur
`OPERASIONAL.md` §12.4 belum dijalankan.
Prasyarat: Q6 penugasan Petugas selesai (flag `can_manual_check_in` sudah bisa diatur dari UI).

## Tujuan

Petugas dapat mencatat kehadiran tanpa QR ketika kartu peserta hilang/rusak, hanya pada
penugasan yang mengizinkan dan hanya bila Tema mengizinkan Manual Check-in. Menutup
`FR-073`, `BR-034`, `AC-055`, `OQ-034`.

## Keputusan UI

- **Lokasi:** halaman Petugas `/staff/scan`, karena kewenangannya melekat pada penugasan dan
  konteks scanner yang sedang dipilih.
- Tombol **“Input manual”** hanya muncul bila konteks aktif `canManualCheckIn` dan konteks siap
  dipakai. Bila Tema mematikan `allowManual`, Worker menolak dan pesannya ditampilkan apa adanya
  (UI tidak menebak konfigurasi Tema).
- Dialog berisi pencarian peserta (nama/NIK/email), pilihan status kehadiran, dan catatan
  opsional. Status default **Hadir**.
- Konteks Aktivitas/Sesi diambil dari konteks scanner yang aktif; pengguna tidak bisa
  memindahkannya dari dialog.
- Tidak ada optimistic success: dialog tetap terbuka sampai Worker menjawab `ok`.

## Cakupan

### 1. `apps/web/src/lib/manual-entry.ts` (baru)

Helper murni (diuji):

- `manualEntryStatuses()` → daftar status yang boleh dipilih (`present`, `late`, `excused`,
  `absent`) beserta label Indonesia.
- `canUseManualEntry(context)` → `context.canManualCheckIn === true` dan
  `staffContextReadiness(context).ready`.
- `manualEntryRequest(context, participantId, status, note)` → `AttendanceManualRequest`
  dengan `activityId`/`sessionId` dari konteks; `note` kosong menjadi `undefined`.
- `manualEntrySuccessMessage(result)` → teks sukses yang menyebut nama peserta dan status.

Tes di `apps/web/src/lib/manual-entry.test.ts` (tanpa DOM).

### 2. `apps/web/src/components/manual-entry-dialog.tsx` (baru)

- Menerima `context: StaffContext`, `open`, `onClose`, `onRecorded`.
- Pencarian memakai `listParticipants(context.themeId, { query, status: "active", limit: 20 })`.
- Pilih satu peserta, pilih status, isi catatan opsional (maks. 500 karakter).
- Kirim lewat `createManualAttendance(context.themeId, input)` (binding sudah ada di
  `lib/attendance.ts`).
- Error API ditampilkan di dialog; sukses memanggil `onRecorded` lalu menutup dialog.
- Empty/loading/error state jelas; tidak ada daftar peserta palsu.

### 3. `apps/web/src/pages/staff.tsx`

- Tambah state dialog dan tombol **Input manual** di kartu konteks aktif, di samping tombol
  “Ganti konteks”.
- Tombol memakai `canUseManualEntry(selected)`; saat scanner sedang feedback/processing tombol
  nonaktif.
- Setelah sukses, tampilkan `Notice` di atas scanner: “Kehadiran manual tercatat untuk …”.
- Tidak mengubah alur scan QR, state machine scanner, atau audio.

## File yang disentuh

- `apps/web/src/lib/manual-entry.ts` (baru) + tes
- `apps/web/src/components/manual-entry-dialog.tsx` (baru)
- `apps/web/src/pages/staff.tsx`

Tidak menyentuh Worker, migrasi, `packages/shared`, atau binding API yang sudah ada.

## Acceptance

- [ ] Petugas dengan `canManualCheckIn = true` melihat tombol **Input manual**; Petugas tanpa
      flag itu tidak melihatnya.
- [ ] Dialog mencari peserta di Tema konteks aktif, bukan Tema lain.
- [ ] Submit mengirim `activityId`/`sessionId` konteks dan status yang dipilih.
- [ ] Tema dengan `allowManual = false` menampilkan pesan penolakan Worker, bukan sukses palsu.
- [ ] Duplikasi/kuota/entitlement ditolak Worker dan pesannya tampil di dialog.
- [ ] Catatan kosong tidak dikirim sebagai string kosong.
- [ ] Scan QR tetap berjalan seperti sebelumnya.
- [ ] Tidak ada dependency atau migrasi baru.

## Verifikasi

```bash
npm run typecheck
npm run lint
npm run test -- apps/web/src/lib/manual-entry.test.ts apps/web/src/lib/scanner.test.ts
npm run test
npm run build
```

Manual: aktifkan flag Manual Check-in pada satu penugasan, buka `/staff/scan`, catat peserta
tanpa QR, lalu coba pada Tema dengan `allowManual = false` dan pada Petugas tanpa flag. Catat
di `docs/OPERASIONAL.md` §12 dan `docs/RENCANA_PENGUJIAN.md`.

## Out of scope

- Manual Entry oleh Admin Acara/Super Admin (ditolak Worker; `D-024`).
- Koreksi/Reversal/Adjustment (UI sudah ada di tab Absensi).
- Antrean offline.
- Polish visual/design system (Q9).
