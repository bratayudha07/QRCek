# Riset Komponen UI — Brief untuk OpenCode

Tanggal riset: 2 November 2026  
Sumber awal: `ui_librari.csv` di folder Downloads. Entri Gooey Search tercatat dua kali; riset ini menghitungnya satu kali.

## Rekomendasi

Implementasikan **command palette pencarian dan navigasi acara** sebagai komponen pertama. Polanya mengambil inspirasi dari Search Modal Vengeance UI: pencarian langsung, daftar aksi, dan pintasan `Ctrl/⌘ K`. Ini mengisi celah yang terlihat di aplikasi: `EventSearch` sekarang hanya mengirim kata kunci ke halaman Peserta dan belum menyediakan jalan cepat ke tab lain.

Gunakan implementasi lokal dengan React, Tailwind, dan elemen HTML yang sudah tersedia. Jangan memasang komponen dari registry secara otomatis. Undangan petugas sudah memiliki Web Share, salin tautan, dan QR; jangan membuat Share Sheet kedua pada tahap ini.

## Temuan dari situs

| Sumber | Komponen/pola yang relevan | Keputusan untuk proyek |
|---|---|---|
| [Vengeance UI — Search Modal](https://www.vengenceui.com/components/search-modal) | Command palette dengan live filtering, hasil, aksi cepat, `Ctrl/⌘ K`, dan Escape. | **Prioritas implementasi.** Buat versi proyek sendiri yang memakai pencarian peserta dan rute acara yang sudah ada. |
| [Vengeance UI — Share Sheet](https://www.vengenceui.com/components/share-sheet) | Dialog berbagi, feedback salin, dan QR lokal. Registry-nya membutuhkan `framer-motion` dan `qrcode-generator`; proyek sudah memakai `qrcode-generator`, tetapi belum memakai `framer-motion`. | **Jangan salin atau pasang sekarang.** Halaman Petugas sudah menyediakan Web Share, salin tautan, dan QR undangan. Pertahankan alur token undangan yang hanya tampil sekali. |
| [Vengeance UI — Glass Dock](https://www.vengenceui.com/components/glass-dock) | Navigasi kapsul transparan bergaya dock. | Referensi visual saja. Sidebar proyek sudah memakai kapsul yang membuka saat hover; menggantinya berisiko mengulang persoalan animasi yang baru dirapikan. |
| [Animate UI](https://animate-ui.com/docs) dan [Tabs](https://animate-ui.com/docs/primitives/animate-ui/tabs) | Menekankan gerak transform/opacity, transisi yang bisa diarahkan ulang, dukungan reduced motion, dan perpindahan highlight. | Ambil prinsip motion saja. Paketnya memakai Motion dan primitif Radix/Base UI/React Aria yang tidak menjadi fondasi komponen proyek saat ini. |
| [Uiverse](https://uiverse.io/) dan [repositori Galaxy](https://github.com/uiverse-io/galaxy) | Elemen komunitas CSS/Tailwind untuk tombol, input, notifikasi, loader, dan toggle. Repositori menyatakan elemen di sana berlisensi MIT dan menganjurkan atribusi kreator. | Sumber inspirasi untuk elemen kecil. Jika menyalin elemen tertentu, simpan tautan kreator dan atribusi; jangan membawa efek dekoratif yang mengganggu alur absensi. |
| [Uilora](https://www.uilora.com/) dan [FAQ lisensinya](https://www.uilora.com/faq) | Situs mengklaim 700+ komponen gratis untuk penggunaan komersial dan dukungan React/Tailwind; halaman produknya menyebut Framer Motion untuk animasi web. | Referensi desain saja. Periksa lisensi serta dependency komponen per komponen sebelum adopsi; jangan menambah Motion hanya untuk animasi dekoratif. |
| [ForgeUI](https://forgeui.in/docs/introduction) | Copy-paste React/Tailwind, sebagian komponen gratis dan katalog Pro berbayar; dokumentasi instalasi Pro mencantumkan beberapa dependency animasi. | Gunakan contoh gratis hanya sebagai referensi. Jangan memakai komponen Pro/berbayar atau menambah GSAP/Motion untuk pekerjaan ini. |

Situs sumber menampilkan klaim dan contoh dari masing-masing pembuat, bukan audit independen. Periksa kembali lisensi dan kode komponen tertentu jika nanti ada komponen pihak ketiga yang benar-benar akan disalin.

## Brief implementasi untuk OpenCode

Jalankan tugas berikut di repo ini setelah membaca `AGENTS.md` dan aturan di `docs/`:

### Sasaran

Buat command palette untuk ruang kerja acara yang membuat pencarian peserta dan perpindahan tab lebih cepat, tanpa mengubah API, otorisasi, atau perilaku data.

### Cakupan

1. Tinjau `apps/web/src/components/event-search.tsx`, `apps/web/src/components/app-layout.tsx`, `apps/web/src/components/event-tabs.tsx`, dan helper rute di `apps/web/src/lib/router.ts`.
2. Ubah pencarian acara menjadi pemicu command palette yang jelas. Pertahankan jalur pencarian peserta yang sudah ada: pilih aksi pencarian harus menuju tab Peserta dengan query `q` melalui helper/router proyek.
3. Tambahkan aksi navigasi yang relevan untuk tab acara yang sudah tersedia. Filter aksi berdasarkan teks yang diketik; jangan menambahkan tujuan fiktif atau melakukan fetch baru.
4. Buka palette dengan `Ctrl/⌘ K`; tutup dengan Escape. Saat terbuka, fokuskan input. Dukung navigasi keyboard pada daftar hasil dan kembalikan fokus ke pemicu saat ditutup.
5. Gunakan elemen `<dialog>` modal native atau pola aksesibel yang sudah ada. Beri nama dialog dan input yang jelas, tampilkan keadaan kosong, dan cegah pintasan mengambil alih saat fokus berada di input/textarea atau saat modifier lain dipakai.
6. Gunakan gaya yang sudah ada: permukaan terang, sudut kapsul/kartu yang konsisten, border halus, blur latar secukupnya, dan hierarki tipografi yang ringkas. Animasi masuk/keluar hanya memakai opacity/transform, singkat, dapat dihentikan saat state berubah, dan menghormati `prefers-reduced-motion`.
7. Di layar kecil, dialog harus muat tanpa melewati viewport atau area safe-area. Pastikan sidebar dan tab tetap dapat digunakan dan tidak tertutup konflik z-index.

### Batasan

- Jangan menambah dependency. Khususnya, jangan memasang `motion`, `framer-motion`, `@animate-ui/react`, GSAP, atau CLI registry.
- Jangan menyalin kode dari registry Vengeance UI, ForgeUI, atau Uilora. Gunakan pola visual dan perilaku sebagai referensi, lalu tulis komponen sesuai struktur repo.
- Uiverse hanya boleh menjadi kode sumber jika lisensi MIT elemen tersebut dan kreatornya bisa diidentifikasi; simpan atribusi. Tidak diperlukan untuk sasaran command palette.
- Jangan mengubah handler Worker, kontrak API, skema D1, token undangan/QR, atau keamanan sesi.
- Identifier, komentar, dan nama file baru dalam bahasa Inggris; teks antarmuka dalam Bahasa Indonesia.
- Pertahankan komponen sebagai UI. Gunakan `navigate`, `participantsPath`, `eventTabPath`, dan tipe rute yang sudah ada; jangan menaruh logika bisnis/API di komponen.

### Kriteria penerimaan

- Tombol/pemicu membuka palette dan `Ctrl/⌘ K` bekerja pada halaman acara.
- Escape, klik aksi, dan penutupan mengembalikan fokus dengan benar.
- Aksi pencarian membawa query ke tab Peserta melalui mekanisme rute yang sudah ada; aksi tab membuka tab yang benar untuk acara aktif.
- Pencarian kosong dan hasil kosong memiliki tampilan yang jelas.
- Berfungsi dengan keyboard dan sentuhan; tidak ada ketergantungan hover.
- Reduced motion meniadakan atau mengurangi gerak.
- Tidak ada dependency baru, API baru, atau perubahan aturan keamanan.
- Tambahkan tes unit untuk pemfilteran/aksi murni bila logika itu diekstrak; jalankan gerbang repo berurutan: `npm run typecheck`, `npm run lint`, `npm run test`, lalu `npm run build`.

## Kandidat tahap berikutnya

- Jika pengguna meminta penyempurnaan undangan petugas, evaluasi layout Share Sheet sebagai **perombakan tampilan alur yang sudah ada**, bukan fitur baru. Web Share, fallback salin, QR tengah-logo, dan sifat token sekali tampil wajib dipertahankan.
- Pertahankan Glass Dock sebagai referensi untuk sidebar saja. Hindari magnifikasi ikon, efek cursor, glow, dan animasi besar di alur scan.
- Uiverse/ForgeUI/Uilora dapat dipakai untuk mencari inspirasi status, input, atau kartu metrik. Pilih hanya komponen yang memperjelas keadaan sistem dan sesuai kontras, keyboard, mobile, serta reduced motion.
