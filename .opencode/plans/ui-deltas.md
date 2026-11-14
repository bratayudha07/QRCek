# Rencana Delta UI (pasca-Q6)

Tanggal: 14 November 2026
Status: disetujui pemilik — kebijakan **"UI minimum adalah bagian gate"**.

## 1. Latar

Q1–Q5 ditutup **API-only**. Q6 adalah tahap pertama yang mengerjakan API + UI sekaligus, dan
itu membuktikan dua hal:

- Scanner bisa diuji end-to-end hanya karena UI-nya ada.
- Bug konteks (`assignmentId::sessionId`) baru terlihat saat UI dipakai, bukan lewat tes API.

Saat menutup Q6 ditemukan delta UI yang belum pernah dibuat:

| Tahap | Delta | Dampak |
|---|---|---|
| Q1 | CRUD Aktivitas & Sesi | Admin tidak bisa membuat Aktivitas/Sesi baru; hanya mengandalkan data lama/API |
| Q2 | CRUD Kategori + pilihan kategori di form peserta | Form peserta masih memakai teks bebas `category`; typo diam-diam membuat kategori baru |
| Q3 | Konfigurasi hak peserta | Tema baru default-deny; scan selalu `NOT_ENTITLED` sampai diubah lewat API |
| Q4 | Rotasi QR | Kartu hilang tidak bisa diganti dari UI |
| Q5 | Manual Entry | Backend ada, tidak ada tombol di UI |

## 2. Kebijakan

- **Satu gate per tahap**, tetapi eksekusi boleh dipecah menjadi work package (WP) API dan UI.
- UI minimum = satu alur utama yang bisa dijalankan Admin/Petugas, memakai `shadcn/ui` dan
  token yang sudah ada. Bukan polish visual; itu Q9.
- Gate baru ditutup setelah alur utama **diuji lewat UI** dan hasilnya dicatat.
- Pengecualian (mis. perangkat yang tidak tersedia) harus ditulis eksplisit di roadmap dan
  `RENCANA_PENGUJIAN.md`, seperti pengecualian iPhone pada Q6.

## 3. Backlog dan urutan

Urutan mengikuti dependensi, bukan nomor tahap:

| # | Delta | Kenapa di sini | API | Ukuran |
|---|---|---|---|---|
| 1 | **Q2 Kategori** | Prasyarat entitlement; memperbaiki form peserta yang masih teks bebas | Sudah ada | Kecil |
| 2 | **Q3 Hak Peserta** | Membuka blokir scan dan Q7; butuh kategori dari #1 | Sudah ada | Sedang |
| 3 | **Q1 Aktivitas & Sesi** | Diperlukan untuk membuat Aktivitas consumption sebelum Q7 | Sudah ada | Sedang |
| 4 | **Q5 Manual Entry** | Operasional lapangan; backend sudah ada | Sudah ada | Kecil |
| 5 | **Q4 Rotasi QR** | Frekuensi rendah (kartu hilang); bisa menjelang Q8 | Sudah ada | Kecil |

Tidak ada migrasi baru dan tidak ada dependency baru untuk kelima delta ini.

## 4. Protokol eksekusi per delta

1. Tulis plan delta (tujuan, file, acceptance, out-of-scope).
2. Implementasi UI-only. Jika ternyata API kurang, hentikan dan laporkan — jangan diam-diam
   mengubah kontrak.
3. Tes terfokus selama iterasi (`npm run test -- <file>`), bukan suite penuh.
4. Di gate: `typecheck` → `lint` → `test` penuh → `build`, lalu E2E manual.
5. Perbarui `DESAIN_API.md` bila route berubah, `RENCANA_PENGUJIAN.md` untuk checklist manual,
   dan status roadmap.
6. Commit oleh sesi utama, bukan subagent.

## 5. Guardrail

- Tidak menambah design system kedua; `shadcn/ui` + token proyek + ikon Lucide.
- Tidak menambah dependency tanpa justifikasi tertulis (aturan AGENTS).
- Teks UI Bahasa Indonesia; identifier/komentar Inggris.
- Otorisasi tetap di Worker; UI hanya menyembunyikan/menampilkan.
- Jangan menulis aturan bisnis di komponen React; taruh di `apps/web/src/lib/`.
- Jangan mengubah keputusan `[A]` atau membuka AQ.

## 6. Definition of done per delta

- [ ] Alur utama bisa diselesaikan lewat UI tanpa DevTools/SQL.
- [ ] Logika murni punya unit test; tidak ada tes yang bergantung DOM.
- [ ] Empty/loading/error state jelas dan tidak menampilkan sukses palsu.
- [ ] `typecheck`, `lint`, tes terfokus hijau; suite penuh di gate.
- [ ] Checklist manual dijalankan dan dicatat.
- [ ] Dokumen status diperbarui; tidak ada klaim tanpa bukti.

## 7. Status

- Q6: **ditutup dengan pengecualian** 14 November 2026 (Android Chrome lolos; iPhone Safari
  dipindah ke Q11).
- Delta #1 (Q2 Kategori): plan ditulis, implementasi dimulai.
