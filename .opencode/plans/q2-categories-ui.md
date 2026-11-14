# Delta UI Q2 — Kategori

Tanggal: 14 November 2026
Status: siap dieksekusi (UI-only, API sudah live).

## Tujuan

Admin dapat mengelola Kategori dari UI, dan form peserta memakai **kategori terkelola**
(`categoryId`), bukan teks bebas. Ini menutup `FR-034`–`FR-036` dan menghapus jalur yang
diam-diam membuat kategori baru saat nama diketik salah.

## Kenapa ini pertama

- Entitlement Q3 membutuhkan daftar kategori yang bisa dipercaya.
- Saat ini `ParticipantForm` mengirim `category` (nama). API menerjemahkannya dan **membuat
  kategori baru** bila nama belum ada (`routes/participants.ts`), sehingga typo menghasilkan
  kategori hantu.
- Tidak perlu migrasi dan tidak perlu endpoint baru.

## Cakupan

### 1. `apps/web/src/lib/categories.ts` (baru)

- Path builder: `/api/events/:eventId/categories` (+ `?status=active|archived|all`),
  `/api/events/:eventId/categories/:categoryId`, `.../status`.
- `listCategories(eventId, status)`, `createCategory`, `updateCategory`,
  `changeCategoryStatus` memakai `apiRequest` yang sudah ada.
- Helper murni:
  - `categoryStatusLabel(status)` → "Aktif" / "Diarsipkan".
  - `categoryOptionLabel(category)` → nama + jumlah peserta (bila ada).
  - `sortCategories` (pertahankan urutan API; helper hanya untuk form/select).
- Tes: `apps/web/src/lib/categories.test.ts` untuk path, label, dan opsi.

### 2. `apps/web/src/components/category-manager.tsx` (baru)

Dialog dari halaman Peserta:

- Daftar kategori (Aktif / Diarsipkan / Semua) dengan kolom Nama, Deskripsi, Peserta, Status.
- Form tunggal di atas daftar: mode tambah/ubah (klik "Ubah" mengisi form, tombol berubah
  jadi "Simpan perubahan").
- Aksi: arsipkan (konfirmasi), aktifkan kembali.
- Empty/loading/error state jelas; error API ditampilkan apa adanya.
- Setelah mutasi, panggil `onChanged()` agar halaman peserta memuat ulang.

### 3. Form peserta memakai `categoryId`

- `ParticipantFormValues.category` → `categoryId`.
- `ParticipantForm` menerima prop `categories: CategorySummary[]` dan merender `Select`
  kategori aktif. Kategori arsip milik peserta yang sedang diedit tetap ditampilkan
  (ditandai "diarsipkan") agar edit tidak memaksa pindah kategori.
- Validasi klien: `categoryId` wajib; server tetap otoritatif.
- Pemanggil diperbarui:
  - `apps/web/src/pages/event-participants.tsx`
  - `apps/web/src/pages/participant-detail.tsx`
- Halaman Peserta menambah tombol **"Kelola kategori"** dan memuat daftar kategori.
- Bila belum ada kategori aktif, form tidak bisa disubmit dan menampilkan arahan untuk
  membuka "Kelola kategori".

### 4. Impor CSV

Tidak diubah. API masih menerima nama kategori untuk impor; perilaku itu dicatat sebagai
kompatibilitas, bukan jalur utama UI.

## File yang disentuh

- `apps/web/src/lib/categories.ts` (baru)
- `apps/web/src/lib/categories.test.ts` (baru)
- `apps/web/src/components/category-manager.tsx` (baru)
- `apps/web/src/components/participant-form.tsx`
- `apps/web/src/pages/event-participants.tsx`
- `apps/web/src/pages/participant-detail.tsx`

Tidak menyentuh Worker, migrasi, atau `packages/shared` (kontrak sudah ada).

## Acceptance

- [ ] Kategori bisa dibuat, diubah, diarsipkan, dan diaktifkan lagi dari UI.
- [ ] Form tambah/edit peserta hanya menawarkan kategori aktif (plus kategori arsip milik
      peserta yang diedit).
- [ ] Payload peserta mengirim `categoryId`, bukan `category` nama.
- [ ] Rename kategori langsung terlihat di daftar/detail peserta setelah muat ulang.
- [ ] Kategori arsip tidak bisa dipilih untuk peserta baru.
- [ ] Tidak ada jalur UI yang membuat kategori baru dari teks bebas.
- [ ] Empty/loading/error state tidak menampilkan sukses palsu.

## Verifikasi

```bash
npm run typecheck
npm run lint
npm run test -- apps/web/src/lib/categories.test.ts
npm run test
npm run build
```

Manual: buat kategori → tambah peserta → rename → arsipkan → coba tambah peserta lagi →
aktifkan kembali. Catat hasil di `docs/OPERASIONAL.md` bagian prosedur admin (tambahkan
subbagian singkat bila belum ada).

## Out of scope

- Menghapus kategori (API archive-only).
- Re-kategorisasi massal.
- Mengubah pemetaan impor CSV.
- UI entitlement (delta berikutnya).
- Perubahan visual/design system (Q9).
