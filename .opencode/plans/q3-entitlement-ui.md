# Delta UI Q3 — Hak Peserta (Entitlement)

Tanggal: 14 November 2026
Status: siap dieksekusi (UI-only; API Q3 sudah live dan teruji).
Prasyarat: delta Q2 Kategori selesai (kategori terkelola).

## Tujuan

Admin dapat mengatur hak peserta per Aktivitas/Sesi dari UI, sehingga Tema baru tidak lagi
default-deny dan scan tidak berhenti di `NOT_ENTITLED` sampai ada yang memanggil API manual.
Menutup `FR-037`–`FR-042`, `AC-011`, `AC-012`, `AC-014`.

## Keputusan UI

- **Lokasi:** tab baru di workspace Tema, label **"Hak"**, halaman `Hak Peserta`.
  Tab lama tetap 5; total 6. Q8 boleh menata ulang navigasi.
- **Satu halaman, dua tingkat konteks:** pilih Aktivitas, lalu pilih scope
  **Aktivitas (semua Sesi)** atau **Sesi tertentu**.
- **Matriks kategori** adalah kontrol utama; override peserta adalah pengecualian.
- **Theme default** ditampilkan terpisah sebagai fallback, bukan bagian matriks.
- Bahasa UI Indonesia; identifier Inggris. Tanpa dependency baru.

## Cakupan

### 1. Router & navigasi

- `apps/web/src/lib/router.ts`: tambah `"entitlements"` ke `EVENT_TAB_KEYS`.
- `apps/web/src/lib/navigation.ts`: `EVENT_TABS` tambah `{ key: "entitlements", label: "Hak" }`.
- `apps/web/src/components/event-tabs.tsx`: ikon `ShieldCheck`; grid 6 kolom; `min-w` disesuaikan.
- `apps/web/src/pages/event-workspace.tsx`: case `entitlements`.
- Perbarui tes `router.test.ts` dan `navigation.test.ts` (daftar label/tab).

### 2. `apps/web/src/lib/entitlements.ts` (baru)

Path builder + binding:

- `GET  /api/events/:eventId/activities/:activityId/entitlements`
- `GET/PUT/DELETE /api/events/:eventId/entitlements/default`
- `PUT  .../activities/:activityId/entitlements/categories`
- `PUT  .../activities/:activityId/sessions/:sessionId/entitlements/categories`
- `PUT/DELETE .../activities/:activityId/entitlements/participants/:participantId`
- `PUT/DELETE .../activities/:activityId/sessions/:sessionId/entitlements/participants/:participantId`

Helper murni (diuji tanpa DOM):

- `entitlementStatusLabel(status)` → "Diizinkan" / "Ditolak" / "Ikut bawaan" / "Belum diatur".
- `scopeOptions(activity, sessions)` → daftar scope `{ key, label, sessionId }`.
- `categoryRows(matrix, sessionId)` → baris kategori untuk scope terpilih.
- `overrideRows(matrix, sessionId, participantsById)` → override + nama peserta.
- `missingCategoryNames(matrix)` → nama kategori yang belum dikonfigurasi.
- `canEditEntitlements(accessRole, eventStatus)` → `event_admin`/`superadmin` dan Tema tidak arsip.

Tes: `apps/web/src/lib/entitlements.test.ts` (path encoding, scope, baris, label, missing names).

### 3. `apps/web/src/pages/event-entitlements.tsx` (baru)

Struktur:

1. **Header**: judul "Hak Peserta", penjelasan singkat, status baca-saja bila Petugas/Tema arsip.
2. **Pemilih Aktivitas**: dari `listActivities(eventId)`; tampilkan nama + status. Default:
   Aktivitas aktif pertama (utamakan `attendance`).
3. **Kartu Theme default**: status saat ini (`null` = belum diatur), tombol
   "Izinkan semua", "Tolak semua", "Hapus fallback".
4. **Peringatan kelengkapan**: bila `entitlementComplete = false`, sebutkan kategori yang
   belum punya baris dan arahkan ke tab Peserta → "Kelola kategori".
5. **Pemilih scope**: Aktivitas (semua Sesi) atau Sesi tertentu (nama dari
   `listActivitySessions`; matriks hanya memberi id).
6. **Matriks kategori**: satu baris per kategori, `Select` status
   (Ikut bawaan / Diizinkan / Ditolak). Baris `null` menampilkan "Belum diatur" sebagai
   placeholder dan berubah setelah admin memilih. Simpan per perubahan (satu request),
   lalu muat ulang matriks. Tampilkan error API apa adanya; jangan pernah menampilkan sukses
   palsu.
7. **Override peserta**: daftar override pada scope terpilih (nama + status + hapus).
   Tombol "Tambah override" membuka dialog cari peserta (`listParticipants` dengan `query`,
   limit 20), pilih status, lalu PUT. Nama peserta diambil dari hasil pencarian; bila override
   lama tidak ada di halaman pertama, tampilkan id pendek sebagai fallback.

State: `loading | ready | error` untuk aktivitas, matriks, dan sesi. Tidak ada optimistic
success: UI hanya berubah setelah respons `ok`.

### 4. Data pendukung

- `listActivities` dan `listActivitySessions` dari `lib/activities.ts` (sudah ada).
- `listParticipants` dari `lib/participants.ts` (sudah ada).
- `getEvent` dari `lib/events.ts` untuk status Tema dan `accessRole`.

## File yang disentuh

- `apps/web/src/lib/router.ts`, `lib/navigation.ts`
- `apps/web/src/components/event-tabs.tsx`
- `apps/web/src/pages/event-workspace.tsx`
- `apps/web/src/lib/entitlements.ts` (baru) + tes
- `apps/web/src/pages/event-entitlements.tsx` (baru)
- Tes router/navigation yang sudah ada

Tidak menyentuh Worker, migrasi, atau `packages/shared`.

## Acceptance

- [ ] Tema baru: set Theme default "Izinkan semua" → scan Petugas `SUCCESS` tanpa DevTools.
- [ ] Matriks kategori: `inherit` melanjutkan ke fallback; `allowed`/`denied` memutus rantai.
- [ ] Override Sesi hanya berlaku untuk Sesi itu; Aktivitas lain tidak terpengaruh.
- [ ] Override individual menang atas aturan kategori.
- [ ] Peringatan kelengkapan muncul saat ada kategori aktif tanpa baris.
- [ ] Petugas dan Tema arsip bersifat baca-saja; Worker tetap menolak tulis.
- [ ] Error API tampil sebagai error; tidak ada state sukses palsu.
- [ ] Tidak ada dependency/migrasi baru.

## Verifikasi

```bash
npm run typecheck
npm run lint
npm run test -- apps/web/src/lib/entitlements.test.ts apps/web/src/lib/router.test.ts apps/web/src/lib/navigation.test.ts
npm run test
npm run build
```

Manual: Tema "Mhs" → tab Hak → Theme default → scan; lalu kategori `denied` → scan ditolak;
override peserta `allowed` → scan diterima; sesi berbeda → perilaku terpisah. Catat di
`docs/OPERASIONAL.md` (prosedur admin) dan `docs/RENCANA_PENGUJIAN.md`.

## Out of scope

- CRUD Aktivitas/Sesi (delta Q1 berikutnya).
- Kuota konsumsi (Q7).
- Konfigurasi pesan per Tema (AQ-012).
- Polish visual/design system (Q9).
