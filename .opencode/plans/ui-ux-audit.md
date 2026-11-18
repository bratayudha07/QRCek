# Audit UI/UX QRCek — stabilitas & konsistensi

Tanggal: 18 November 2026. **Status: UI-1, UI-2, dan UI-5 sudah dieksekusi; UI-3/UI-4/UI-6
belum.** Dokumen ini bukan rencana tahap roadmap; Q9 (design system) tetap belum dibuka dan
tidak boleh menambah fitur.

**Hasil eksekusi 18 November 2026** (commit `a1609a0`, sudah di-push ke `main`):

| Paket | Status | Bukti |
|---|---|---|
| UI-1 | Selesai | `components/error-boundary.tsx`, `lib/document-title.ts` (+ tes), dipasang di `App.tsx` dan `AppShell`; `index.html` → `QRCek` |
| UI-2 | Selesai | `eventTimezone` pada `AttendanceRecord`, `timezone` pada dashboard/audit/`StaffContext`; `scan-feedback` dan dialog transaksi menerima prop zona; `formatDateTimeWithZone` + tes WIB/WITA/WIT |
| UI-5 | Selesai | `participantName`/`participantCategory` pada `TransactionRecord`; dialog Transaksi tidak lagi memanggil `listParticipants` |
| UI-3 | Belum | 12 `window.confirm` masih ada |
| UI-4 | Belum | `Field` belum punya slot error |
| UI-6 | Belum | menunggu Q8 |

Tambahan di luar paket (permintaan pemilik): tab **Peserta** memakai `Table` responsif, dan
pilihan peran Admin Acara dihapus dari form undangan (lihat §5).

## 1. Metode

- `ui-ux-pro-max`: `--design-system` untuk konteks "attendance operations admin dashboard" dan
  pencarian domain `ux` untuk confirmation dialog, focusable error summary, table overflow,
  toast, touch target, empty state.
- `ui-styling`: referensi katalog shadcn/ui; dicek langsung ke `https://ui.shadcn.com/llms.txt`
  (18 November 2026) untuk memastikan komponen yang diusulkan memang ada di registry.
- `design-system`, `design`, `banner-design`: diperiksa, **tidak dipakai** — tidak ada kebutuhan
  banner/identitas baru, dan Q9 yang berwenang mengubah token visual.
- Inspeksi kode: `apps/web/src` (24 komponen, 22 halaman, 6.842 baris halaman), `components/ui/`,
  `lib/format.ts`, `lib/http.ts`, `components/app-layout.tsx`, `components/ui/dialog.tsx`,
  `apps/api/src/routes/attendance.ts`, `db/transactions.ts`.
- Inventaris dependensi: `@base-ui/react@1.9.0` sudah menyediakan `alert-dialog`, `field`,
  `fieldset`, `form`, `combobox`, `progress`, `scroll-area`, `menu`, `popover`, `toast`, `switch`,
  `number-field`, `otp-field`. **Semua usulan di bawah bisa dikerjakan tanpa dependensi baru.**

Catatan penting: saran `--design-system` (Glassmorphism + font Fira) **tidak diadopsi**. QRCek
sudah punya token shadcn dan Q9 yang berwenang soal visual. Yang diambil dari hasil pencarian
hanya panduan perilaku (density, status color, focus terlihat, reduced motion).

## 2. Yang sudah baik — jangan diutak-atik

Ini bukan aplikasi yang perlu dirombak. Fondasi UI-nya di atas rata-rata:

| Aspek | Bukti |
|---|---|
| Skip link + fokus pindah per rute | `components/app-layout.tsx:113` (`Lewati ke konten`), fokus ke `<main>` kecuali saat ganti tab |
| Tab = link asli, `aria-current="page"`, roving tabindex | `components/event-tabs.tsx` |
| Dialog pakai `<dialog>` native (focus trap + inert gratis) | `components/ui/dialog.tsx` |
| Tabel aman di layar sempit | `components/ui/table.tsx` membungkus `overflow-x-auto` |
| Status loading/error/empty konsisten | `components/page-state.tsx` |
| Toast scan: `role="alert"`/`status`, auto-dismiss 2,8 s | `components/scan-toast.tsx:29,50` |
| Token warna + safe-area + `prefers-reduced-motion`? | `index.css`, `app-layout.tsx` (`env(safe-area-inset-bottom)`) |
| Fetch wrapper: cookie same-origin, CSRF, respons non-JSON dinormalisasi | `lib/http.ts` |
| 404 tertangani | `pages/not-found.tsx` |
| Hanya 5 elemen interaktif mentah di luar `components/ui/` | hasil grep |

Kesimpulan: masalahnya bukan "UI dibuat dari nol", tapi **beberapa lubang kecil yang berdampak
besar** dan beberapa pola yang belum diseragamkan.

## 3. Temuan

Prioritas: **P0** = bisa membuat aplikasi tidak bisa dipakai, **P1** = salah data/menyesatkan,
**P2** = konsistensi/efisiensi.

| ID | Temuan | Dampak | Bukti | Prioritas |
|---|---|---|---|---|
| F1 | Tidak ada error boundary React | Satu error render = layar putih total, tanpa jalan pulih selain reload manual | tidak ada `ErrorBoundary` di `apps/web/src`; `main.tsx` merender `<App/>` langsung | **P0** |
| F2 | Zona waktu Tema diabaikan di 5 tempat (`Asia/Jakarta` hardcoded) | Jam transaksi/schedule salah untuk Tema WITA/WIT; `EventSummary.timezone` sudah ada tapi tidak dipakai | `components/scan-feedback.tsx:40`, `pages/activity.tsx:87`, `pages/dashboard.tsx:46`, `pages/event-reports.tsx:140`, `pages/staff.tsx:740` | **P1** |
| F3 | `window.confirm` dipakai 12× | Dialog sistem: tidak bisa di-style, tidak punya focus ring/aria, tidak konsisten dengan dialog lain, di iOS tampil sebagai alert blocking | `category-manager.tsx:169`, `participant-detail.tsx:169`, `account.tsx:58,69`, `event-staff.tsx:165,180`, `event-reports.tsx:75,86`, `event-overview.tsx:133`, `event-entitlements.tsx:356`, `event-activities.tsx:373,546` | **P1** |
| F4 | `Field` tidak punya slot error; error form hanya satu paragraf di atas form, tanpa `aria-invalid`/`aria-describedby`, tanpa ringkasan error yang bisa difokus | Pengguna keyboard/screen reader tidak tahu field mana yang salah; panduan UX menandai ini High | `components/ui/field.tsx` (props: label, hint, required saja) | **P1** |
| F5 | `GET .../transactions` tidak mengirim `participantName`, padahal SQL sudah `JOIN participants` | Dialog Transaksi menebak nama dengan memanggil daftar peserta sampai 10 halaman (1.000 baris). Di Tema >1.000 peserta nama tampil "Peserta tidak dikenal"; biaya request juga naik | `routes/attendance.ts:276-282` (`toTransactionRecord`), `db/transactions.ts:37,60` (`participant_name` sudah ada), `packages/shared/src/attendance.ts:115` (`TransactionRecord` tanpa nama) | **P1** |
| F6 | `<title>` statis "Absensi Acara" untuk semua halaman | Tab browser, riwayat, dan screen reader tidak membedakan halaman | `apps/web/index.html:7` | P2 |
| F7 | Sebagian empty state tanpa aksi | Panduan UX: empty state harus menuntun ke tindakan; beberapa hanya teks | `EmptyState` di `event-reports.tsx:140`, `dashboard.tsx:46` (yang ini sudah ada tautan) vs beberapa tanpa | P2 |
| F8 | Daftar panjang hanya "Muat lagi", tanpa indikator posisi | Sulit tahu sudah sejauh apa; tidak ada jalan kembali ke atas daftar | `consumption-transactions-dialog.tsx`, daftar peserta | P2 |
| F9 | Pencarian peserta berupa input + daftar hasil manual | Bisa dibuat Combobox aksesibel (navigasi panah, `aria-activedescendant`) tanpa dependensi baru | `components/manual-entry-dialog.tsx:220`, `consumption-quota-dialog.tsx:583` | P2 |
| F10 | Belum ada dark mode (tidak ada `.dark` di `index.css`) | Bukan masalah stabilitas; masuk Q9, bukan audit ini | `index.css` | Q9 |

## 4. Usulan paket kerja

Semua paket di bawah: tanpa dependensi baru, memakai `components/ui/` yang ada atau primitif
`@base-ui/react` yang sudah terpasang.

### UI-1 — Error boundary + judul dokumen (P0, kecil)

- `components/error-boundary.tsx`: kelas React dengan fallback Bahasa Indonesia ("Terjadi
  kesalahan pada halaman ini"), tombol **Muat ulang**, dan detail teknis yang bisa dibuka
  (bukan stack trace penuh). Dipasang sekali di `App.tsx` membungkus `AppLayout`.
- `lib/document-title.ts`: hook `useDocumentTitle(text)`; dipakai `AppLayout` dari nama Tema +
  nama tab. Halaman login/aktivasi memakai judul sendiri.
- Tes: unit untuk pembentuk judul (murni). Error boundary tidak diuji lewat DOM (proyek tanpa
  jsdom) — dicatat sebagai keterbatasan.

### UI-2 — Zona waktu Tema (P1, kecil–sedang)

- Ganti 5 pemanggilan `Asia/Jakarta` dengan `event.timezone` bila payload menyediakannya.
- Halaman lintas Tema (`dashboard.tsx`, `activity.tsx`) memakai timezone per baris; bila payload
  belum membawanya, tambahkan field `timezone` di baris yang bersangkutan (aditif) atau tampilkan
  label zona.
- `scan-feedback.tsx` menerima `timeZone` sebagai prop, bukan konstanta.
- Tes: `format.test.ts` sudah ada; tambah kasus WITA/WIT.

### UI-3 — `ConfirmDialog` menggantikan 12 `window.confirm` (P1, sedang)

- `components/ui/alert-dialog.tsx` di atas `@base-ui/react/alert-dialog` (sudah terpasang),
  mengikuti gaya `ui/dialog.tsx`.
- API: `confirm({ title, description, confirmLabel, tone: "default" | "destructive", reason? })`
  mengembalikan Promise. Untuk aksi yang butuh alasan (Reversal) tetap memakai dialog form yang
  sudah ada.
- Ganti 12 pemanggilan satu per satu; tiap penggantian kecil dan bisa direview terpisah.
- Tes: helper teks tombol/label per tone (murni). Perilaku fokus diserahkan ke primitif.

### UI-4 — Validasi form: error inline + ringkasan (P1, sedang)

- `Field` menerima `error?: string`; render `aria-invalid` pada kontrol, `aria-describedby` ke
  pesan error, dan `role="alert"` pada pesan.
- `components/form-error-summary.tsx`: ringkasan di atas form, `tabIndex={-1}`, fokus otomatis
  setelah submit gagal, tiap butir menautkan ke field.
- Terapkan pada form terpanjang dulu: `event-form`, `participant-detail`, `manual-entry-dialog`,
  `consumption-quota-dialog`, `event-activities`.
- Tes: pembentuk daftar error (murni).

### UI-5 — `participantName` pada daftar transaksi (P1, kecil, menyentuh API)

- Tambah `participantName: string` dan `participantCategory: string | null` (opsional) ke
  `TransactionRecord`; isi dari kolom yang sudah di-join.
- Dialog Transaksi berhenti memanggil `listParticipants` (hapus `loadParticipantNames`).
- Perubahan kontrak **aditif**: klien lama tetap jalan. Wajib dicatat di `docs/DESAIN_API.md`
  dan dihitung ulang statement-nya (target tetap < 50).
- Tes: route mengembalikan nama; dialog tidak lagi butuh lookup.

### UI-6 — P2, opsional, dikerjakan hanya bila diminta

- Pagination + indikator posisi pada daftar panjang.
- Combobox peserta (Base UI) untuk Manual Entry dan kuota.
- Empty state dengan aksi.
- Perbaikan ini tidak mengubah perilaku; cocok digabung dengan Q8 saat filter laporan dibangun.

## 5. Keputusan yang dibutuhkan: peran Admin Acara

Permintaan: "untuk Admin Acara tidak usah, cukup Super Admin dan Petugas." Ini **mengubah
keputusan produk yang sudah `[A]`**, jadi tidak boleh dieksekusi tanpa keputusan baru + ADR.

Yang terdampak:

| Hal | Kondisi sekarang | Bila peran dihapus |
|---|---|---|
| Koreksi/Reversal | `D-006` [A]: hanya Admin Acara. `D-024` [A]: Super Admin **ditolak** | Tidak ada yang boleh mengoreksi, **kecuali** `D-024` dibuka dan koreksi diberikan ke Super Admin |
| Pendaftaran admin | `D-018` [A]: undangan Super Admin | Undangan Admin Acara tidak dipakai lagi |
| Otorisasi | `event_memberships.role` + izin `transaction:correct` | ~48 referensi `event_admin` di API/web/shared; CHECK constraint di `users.role`, `event_memberships.role`, `invites.role` → migrasi rebuild tabel |
| Data produksi | 1 membership `event_admin` (`01M6KESV4R1RRGEQV7S0T5DQ4E`) yang barusan dipakai untuk smoke Reversal | Akun itu kehilangan akses mengelola Tema |

Opsi:

1. **Hapus peran sepenuhnya.** Super Admin mengelola semua Tema dan juga melakukan koreksi
   (membatalkan `D-024`, mengganti `D-006`). Paling bersih secara mental model, paling mahal:
   ADR + migrasi + ~48 titik kode + seluruh tes otorisasi + data produksi.
2. **Nonaktifkan dari alur, jangan hapus.** Tidak ada undangan Admin Acara baru; Super Admin
   yang mengelola; akun Admin Acara yang ada tetap valid sampai dicabut. Tidak perlu migrasi,
   tapi menyisakan dua jalur otorisasi dan aturan koreksi tetap di Admin Acara — jadi Reversal
   jadi tidak bisa dilakukan siapa pun setelah akun terakhir dicabut.
3. **Tidak berubah.** Tetap seperti sekarang.

Catatan penting untuk opsi 1 dan 2: **Reversal yang baru di-smoke bergantung pada Admin Acara.**
Kalau peran ini dihapus tanpa memindahkan izin koreksi, fitur koreksi menjadi mati.

Rekomendasi saya: opsi 1 **hanya jika** Anda memang ingin satu peran admin dan bersedia
menanggung satu ADR + satu migrasi + regresi otorisasi. Kalau tujuannya sekadar "jangan
repot mengurus admin per Tema", opsi 2 cukup dan jauh lebih murah.

**Keputusan pemilik (18 November 2026): opsi 2 — nonaktifkan dari alur.** Implementasi hanya di
UI: pilihan peran Admin Acara dihapus dari form undangan `event-staff.tsx`, `createEventInvite`
selalu mengirim `role: "officer"`, dan ditambahkan penjelasan bahwa Super Admin mengelola Tema.
API, skema, `D-006`/`D-018`/`D-024`, dan akun lama tidak berubah. Konsekuensi operasional
(termasuk larangan mencabut Admin Acara terakhir) dicatat di `docs/OPERASIONAL.md` §12.6.

## 6. Batas audit ini

- **Bukan** Q8: ringkasan konsumsi di dashboard, empat laporan, ekspor CSV per filter, audit UI
  lintas Tema tetap pekerjaan Q8 (dan `AQ-013` masih terbuka).
- **Bukan** Q9: dark mode, skala tipografi, token visual, kontras menyeluruh.
- Tidak menambah dependensi, tidak mengubah skema, tidak mengubah `REQUIREMENTS.md`.

## 7. Urutan eksekusi yang diusulkan

1. UI-1 (error boundary + judul) — dampak terbesar, risiko terkecil.
2. UI-5 (`participantName`) — menutup bug yang saya buat di dialog Transaksi.
3. UI-2 (zona waktu) — perbaikan kebenaran data.
4. UI-3 (`ConfirmDialog`) — 12 penggantian, bisa dicicil.
5. UI-4 (validasi form) — paling banyak menyentuh halaman, kerjakan terakhir.
6. UI-6 menunggu keputusan, kemungkinan digabung Q8.

Verifikasi tiap paket: `typecheck` → `lint` → tes terfokus → suite penuh di akhir; smoke UI di
`npm run dev:web` + `dev:api` sebelum push, karena Workers Builds langsung deploy dari `main`.
