# QRCek — Product Requirements Document

> **Status:** Draft — Pending Product Owner Review
> **Product:** QRCek
> **Language:** Bahasa Indonesia dengan istilah teknis Inggris
> **Commit acuan verifikasi:** `157c330`
> **Tanggal verifikasi repository:** 3 November 2026
> **Sumber kebutuhan:** Product Requirements Document yang diberikan product owner pada 3 November 2026, koreksi aturan koreksi transaksi pada tanggal yang sama, keputusan produk dan rekomendasi revisi v0.3, koreksi konsistensi v0.3.1, serta keputusan dan koreksi faktual v0.3.2 (struktur dokumen disepakati, `D-024` disepakati, koreksi baseline scanner).
> **Sifat dokumen:** Sumber utama untuk kebutuhan produk, ruang lingkup, aturan bisnis, dan kriteria penerimaan. Dokumen ini **bukan** keputusan arsitektur, skema database, atau rencana implementasi.

---

## 0. Document Control

### 0.1 Metadata

| Atribut | Nilai |
|---|---|
| Nama dokumen | Product Requirements |
| Produk | QRCek |
| Versi | 0.3.3 |
| Status | Draft — Pending Product Owner Review |
| Pemilik keputusan produk | Product owner QRCek |
| Tanggal dibuat | 3 November 2026 |
| Tanggal revisi v0.3.1 | 3 November 2026 |
| Tanggal revisi v0.3.2 | 3 November 2026 |
| Tanggal revisi v0.3.3 | 6 November 2026 |
| Commit repository yang diverifikasi | `5951361` (Q1); baseline `157c330` (§7.1) |
| Metode verifikasi | Pembacaan source code, migrations, schema, route, dan test; eksekusi `npm run test` |
| Hasil verifikasi | 53 file test, 525 test lulus (baseline `157c330`: 48 file, 458 test) |
| Batas verifikasi | Tidak ada pengujian perangkat fisik, akun Google Sheets nyata, atau CPU produksi |
| Jumlah baris | 1259 |

### 0.2 Cara membaca dokumen

Dokumen ini memisahkan enam jenis informasi:

| Penanda | Arti |
|---|---|
| **Target** | Kebutuhan produk yang harus dipenuhi. Ditulis normatif dengan kata “harus”. |
| **Baseline** | Kondisi implementasi aktual yang terverifikasi pada commit acuan. Bukan klaim bahwa kebutuhan sudah selesai. |
| **Delta** | Selisih antara target dan baseline. |
| **Keputusan disepakati (`D-xxx [A]`)** | Keputusan yang sudah disetujui product owner dan menjadi dasar requirement. |
| **Keputusan proposed (`D-xxx [P]`)** | Rekomendasi yang belum disetujui. Bukan keputusan final; implementasi tidak boleh menganggapnya disetujui. |
| **Open question (`OQ-xxx [O]`)** | Hal yang belum diputuskan dan belum memiliki rekomendasi final. |

Marker status yang dipakai pada requirement, business rule, dan acceptance criterion:

| Marker | Arti |
|---|---|
| `[A]` | Berasal dari keputusan yang sudah disepakati. |
| `[P]` | Berasal dari rekomendasi proposed; menunggu review product owner. |
| `[O]` | Masih terbuka; belum ada keputusan. |

Kode kebutuhan:

| Kode | Arti |
|---|---|
| `G-xxx` | Product goal |
| `NG-xxx` | Non-goal |
| `FR-xxx` | Functional requirement |
| `BR-xxx` | Business rule / invariant |
| `NFR-xxx` | Non-functional requirement |
| `AC-xxx` | Acceptance criterion |
| `AC-G-xx` | Acceptance principle global |
| `OQ-xxx` | Open question |
| `D-xxx` | Keputusan disepakati atau proposed |

### 0.3 Hubungan dengan dokumen lain

| Dokumen | Peran |
|---|---|
| `docs/REQUIREMENTS.md` | Sumber utama kebutuhan produk. Dokumen ini. |
| `docs/ARCHITECTURE.md` | Rancangan arsitektur dan model sistem. Draft v1, diselaraskan dengan dokumen ini pada 3 November 2026; menggantikan `docs/ARSITEKTUR.md`. Diperbarui 6 November 2026: AQ-001/AQ-006/AQ-010/AQ-014 dijawab. |
| `docs/DECISIONS.md` | Indeks keputusan produk, ADR, dan pertanyaan arsitektur (AQ). Dibuat 3 November 2026; memuat ADR-0001–0015 per 6 November 2026. |
| `docs/adr/` | Catatan keputusan arsitektur individual. ADR-0001–0008 diekstrak dari `docs/ARSITEKTUR.md` pada 3 November 2026 tanpa perubahan keputusan; ADR-0009–0015 ditulis 4–6 November 2026. |
| `docs/IMPLEMENTATION_ROADMAP.md` | Urutan implementasi tahap Q0–Q11 dan gate. Draft v1, dibuat 3 November 2026; Q1 dibuka dan hasil implementasinya dicatat 4–6 November 2026. |
| `.opencode/plans/` | Rencana eksekusi teknis per tahap. Rencana Q0 diperbarui 3 November 2026; rencana Q1 tersedia; rencana Q2 ditulis setelah AQ-006 diterima. |
| `docs/DESAIN_API.md` | Kontrak API aktual. |
| `docs/DESAIN_DATABASE.md` | Desain database aktual. |
| `docs/RENCANA_PENGUJIAN.md` | Strategi pengujian aktual. |
| `docs/OPERASIONAL.md` | Prosedur operasional dan catatan lingkungan. |
| `COSTS_AND_LIMITS.md` | Batasan free tier. Lokasi final: root (`/COSTS_AND_LIMITS.md`); `OQ-027` ditutup. |

Dokumen teknis yang sudah ada dipertahankan selama masih relevan. Perubahan nama, lokasi, dan status dokumen harus dikoordinasikan melalui pembaruan dokumentasi dan `AGENTS.md` (`D-001` [A]). Struktur dokumen di tabel ini disepakati product owner pada 3 November 2026 (v0.3.2).

### 0.4 Prinsip integrasi dokumen ini

1. Seluruh kebutuhan dari PRD dipertahankan; tidak ada yang dihapus hanya karena belum masuk rilis pertama.
2. Kondisi implementasi tidak boleh dipakai untuk menurunkan kebutuhan produk.
3. Dokumen ini tidak menetapkan tabel, kolom, indeks, atau bentuk payload API.
4. Keputusan yang sudah disepakati (`D-xxx [A]`) menjadi dasar requirement.
5. Rekomendasi proposed (`D-xxx [P]`) tidak boleh diperlakukan sebagai keputusan final sebelum disetujui product owner.
6. Hal yang belum jelas dicatat sebagai `OQ-xxx [O]`, bukan diasumsikan.
7. Tidak ada kewajiban migrasi data produksi karena aplikasi belum digunakan di produksi; kode dan fitur lama tetap dapat dipakai ulang setelah evaluasi.
8. Perubahan schema tetap memerlukan validasi dan regression testing meskipun tidak ada kewajiban kompatibilitas data produksi.

---

## 1. Product Overview

QRCek adalah sistem manajemen kehadiran dan distribusi konsumsi berbasis QR Code untuk kegiatan atau acara yang memiliki banyak aktivitas dan sesi.

Setiap peserta memiliki satu QR Identity per Tema Acara. QR tersebut dapat digunakan pada berbagai Aktivitas dan Sesi dalam Tema yang sama sesuai entitlement peserta.

QRCek tidak hanya mencatat kehadiran, tetapi juga mengelola:

- Data peserta.
- Kategori peserta.
- Hak akses peserta terhadap aktivitas dan sesi.
- Kehadiran berdasarkan Aktivitas dan Sesi.
- Distribusi konsumsi berdasarkan kuota dan jenis distribusi.
- Petugas dan pembagian tugas.
- Riwayat transaksi, reversal, adjustment, dan audit.
- Laporan serta ekspor data.

### 1.1 Product Goals

| ID | Goal |
|---|---|
| `G-01` | Menyederhanakan proses registrasi dan verifikasi peserta. |
| `G-02` | Menggunakan satu QR Identity per peserta per Tema Acara. |
| `G-03` | Mendukung banyak Aktivitas dan Sesi dalam satu Tema Acara. |
| `G-04` | Mencegah kehadiran dan distribusi konsumsi ganda. |
| `G-05` | Memastikan setiap transaksi divalidasi oleh backend. |
| `G-06` | Mempertahankan riwayat transaksi dan perubahan data. |
| `G-07` | Menyediakan laporan operasional yang mudah dipahami. |
| `G-08` | Memisahkan antarmuka administrasi dan scanner/kiosk. |
| `G-09` | Mempertahankan fitur yang sudah berjalan dan masih relevan. |

### 1.2 Non-Goals

| ID | Non-goal |
|---|---|
| `NG-01` | Integrasi langsung dengan Canva. |
| `NG-02` | Card designer internal. |
| `NG-03` | Pembuatan desain kartu peserta di dalam QRCek. |
| `NG-04` | Generator PDF kartu peserta. |
| `NG-05` | Generator PDF massal kartu A4. |
| `NG-06` | Mode transaksi offline pada scanner. |

Admin dapat mengunduh QR Code dalam format PNG, kemudian menggunakannya secara manual untuk membuat desain kartu di Canva.

---

## 2. Actors and Roles

### 2.1 Role summary

| Aktor | Cakupan |
|---|---|
| Super Admin | Seluruh Tema Acara, pengelolaan pengguna, pengaturan sistem, seluruh laporan, seluruh audit log, dan melihat transaksi lintas Tema. |
| Admin Acara | Tema Acara yang ditugaskan: peserta, kategori, entitlement, Aktivitas, Sesi, petugas, laporan, serta Reversal dan Adjustment. |
| Petugas | Akses operasional scanner sesuai penugasan Aktivitas/Sesi. Tidak memiliki kewenangan Reversal atau Adjustment. |

### 2.2 Catatan peran

1. Satu perangkat scanner dapat digunakan oleh beberapa petugas, tetapi masing-masing harus menggunakan akun sendiri.
2. Pencabutan tugas tidak menghapus transaksi historis.
3. Setiap transaksi mencatat identitas Petugas yang melakukan tindakan.
4. Kewenangan Reversal dan Adjustment hanya dimiliki Admin Acara. Petugas tidak memiliki kewenangan tersebut, termasuk terhadap transaksi miliknya sendiri atau Petugas lain.
5. Super Admin tidak memiliki kewenangan Reversal atau Adjustment; Super Admin hanya dapat melihat transaksi dan audit lintas Tema, dan tidak ada emergency override pada rilis awal (`D-024` [A]).
6. Pendaftaran Admin Acara melalui undangan Super Admin merupakan rekomendasi proposed (`D-018` [A]) dan menunggu keputusan (`OQ-022` [A]).

---

## 3. Domain Model and Glossary

### 3.1 Core product hierarchy

```text
Tema Acara
├── Peserta (terdaftar pada Theme)
├── Kategori Peserta
└── Aktivitas
    ├── Transaksi (jika Aktivitas tanpa Sesi)
    │   ├── Attendance
    │   └── Consumption
    └── Sesi (0..n)
        └── Transaksi
            ├── Attendance
            └── Consumption
```

Aturan konteks transaksi:

1. Setiap transaksi wajib memiliki konteks **Tema Acara** dan **Aktivitas**.
2. Jika Aktivitas tidak memiliki Sesi, transaksi terhubung langsung ke Aktivitas.
3. Jika Aktivitas memiliki satu atau beberapa Sesi, setiap transaksi wajib merujuk ke Sesi valid yang berada di bawah Aktivitas tersebut.
4. Backend harus menolak kombinasi Aktivitas/Sesi yang tidak konsisten.
5. Aktivitas dapat memiliki nol, satu, atau banyak Sesi.
6. Sesi tidak boleh disimpulkan otomatis dari waktu jam; Sesi harus dipilih atau ditentukan secara eksplisit.

Hierarki ini adalah **target kebutuhan produk** (`D-003` [A]). Dokumen ini tidak menetapkan skema database. Tidak ada kewajiban migrasi data produksi (`D-007` [A]).

### 3.2 Glossary

| Istilah | Definisi |
|---|---|
| Tema Acara | Entitas utama yang mengelompokkan peserta, aktivitas, konfigurasi, dan transaksi. Contoh: Seminar Pendidikan 2027. |
| Aktivitas | Kegiatan operasional di bawah satu Tema Acara. Contoh: Registrasi, Seminar, Distribusi Konsumsi, Pengambilan Perlengkapan. |
| Sesi | Bagian dari Aktivitas yang membutuhkan pencatatan transaksi terpisah. Contoh: Sesi Pagi, Sesi Siang, Sarapan, Makan Siang, Snack. |
| Peserta | Orang yang terdaftar pada tingkat Tema Acara dan memiliki QR Identity. |
| Kategori Peserta | Pengelompokan peserta pada tingkat Tema Acara, misalnya VIP, Reguler, Undangan. Menjadi dasar entitlement. |
| Entitlement | Hak akses peserta terhadap Aktivitas dan Sesi, dengan prioritas Individual–Session, Category–Session, Individual–Activity, Category–Activity, lalu Theme default. |
| QR Identity | Token opaque yang menjadi identitas peserta dalam satu Tema Acara. Scope-nya Tema + Peserta, bukan wadah data pribadi. |
| Transaksi | Catatan operasional yang dihasilkan dari QR Scan atau Manual Entry, serta dapat dikoreksi melalui Reversal atau Adjustment. |
| Transaction Type | Jenis transaksi: Attendance atau Consumption. Satu Aktivitas hanya memiliki satu tipe utama. |
| Transaction Source | Sumber transaksi: QR Scan atau Manual Entry. Bukan Correction Operation. |
| Correction Operation | Operasi koreksi: Reversal atau Adjustment. Bukan Transaction Source. |
| Reversal | Operasi yang membatalkan efek transaksi tanpa menghapus transaksi asli. |
| Adjustment | Operasi yang mencatat perubahan pada transaksi dengan menyimpan nilai before/after. |
| Effective Transaction | Transaksi yang belum di-reversal dan masih dihitung untuk duplikasi serta kuota. |
| External Reference | Kunci referensi eksternal peserta yang dipakai untuk pencocokan impor CSV dalam satu Tema. |
| Distribusi Konsumsi | Penukaran barang/konsumsi dengan kuota yang dapat dikonfigurasi. |
| Kiosk | Antarmuka scanner operasional yang terpisah dari dashboard admin. |
| Custom Field | Field tambahan yang dibuat admin pada tingkat Tema Acara. |
| Baseline | Kondisi implementasi aktual pada commit acuan. |

### 3.3 Contoh hierarki

| Tema Acara | Aktivitas | Sesi |
|---|---|---|
| Seminar Pendidikan 2027 | Registrasi | — |
| Seminar Pendidikan 2027 | Seminar | Sesi Pagi, Sesi Siang |
| Seminar Pendidikan 2027 | Distribusi Konsumsi | Sarapan, Makan Siang, Snack |
| Reuni Akbar 2027 | Pengambilan Perlengkapan | — |

Kehadiran pada satu Sesi tidak otomatis dianggap sebagai kehadiran pada Sesi lainnya. Aktivitas yang tidak memiliki Sesi tetap harus memiliki konteks transaksi yang jelas.

### 3.4 Batas dokumen

Dokumen ini tidak menentukan:

- Nama tabel, kolom, indeks, atau relasi database.
- Apakah `events` yang ada menjadi Tema Acara atau berada di bawah Tema Acara.
- Apakah Attendance dan Consumption memakai satu tabel transaksi atau tabel terpisah.
- Strategi migrasi data produksi, karena tidak ada kewajiban mempertahankannya.
- Bentuk payload API.

Semua hal tersebut harus diputuskan di `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, dan ADR terkait. Kode dan fitur lama boleh dipakai ulang setelah evaluasi (`D-007` [A]).

---

## 4. Functional Requirements

> Seluruh `FR-xxx` di bagian ini adalah **target**. Marker `[A]` berarti berasal dari keputusan yang sudah disepakati; `[P]` berarti rekomendasi proposed yang belum disetujui; `[O]` berarti masih terbuka. Requirement `[P]` tidak boleh diperlakukan sebagai keputusan final sebelum product owner menyetujuinya. Baseline dan delta dibahas terpisah di §7 dan §8.

### 4.1 Tema Acara

| ID | Requirement | Sumber |
|---|---|---|
| `FR-001` | Sistem harus memiliki Tema Acara sebagai entitas utama yang mengelompokkan peserta, aktivitas, konfigurasi, dan transaksi. | PRD §2.1 |
| `FR-002` | Satu Tema Acara harus dapat memiliki banyak Aktivitas. | PRD §2.1 |
| `FR-003` | Peserta harus terdaftar pada tingkat Tema Acara. | PRD §2.4 |
| `FR-004` | Setiap peserta harus memiliki satu QR Identity per Tema Acara; QR tersebut berlaku untuk seluruh Aktivitas dan Sesi dalam Tema yang sama sesuai entitlement. | PRD §2.4; `D-004` [A] |

### 4.2 Aktivitas

| ID | Requirement | Sumber |
|---|---|---|
| `FR-005` | Aktivitas harus menjadi kegiatan operasional di bawah satu Tema Acara. | PRD §2.2 |
| `FR-006` | Aktivitas harus dapat berdiri sendiri tanpa Sesi atau memiliki satu/beberapa Sesi. | PRD §2.2; `D-003` [A] |
| `FR-007` | Aktivitas harus menentukan konteks operasional scanner. | PRD §2.3, §2.4 |
| `FR-008` | Aktivitas tanpa Sesi harus menjadi konteks transaksi langsung; transaksi harus terhubung ke Aktivitas tersebut. | PRD §2.4; `D-003` [A] |
| `FR-182` | Setiap Aktivitas harus memiliki satu tipe transaksi utama: Attendance atau Consumption. Aktivitas tidak boleh mencampur kedua tipe dalam satu Aktivitas. | PRD §7.2; `D-009` [A] |

### 4.3 Sesi

| ID | Requirement | Sumber |
|---|---|---|
| `FR-009` | Sesi harus menjadi bagian dari satu Aktivitas dan hanya dapat digunakan untuk pencatatan transaksi terpisah. | PRD §2.3; `D-003` [A] |
| `FR-010` | Sistem harus mencatat kehadiran berdasarkan Aktivitas, dan berdasarkan Sesi apabila Aktivitas memiliki Sesi. | PRD §2.3, §6.1; `D-003` [A] |
| `FR-011` | Sesi harus menentukan ruang lingkup transaksi apabila Aktivitas memiliki Sesi. | PRD §2.4; `D-003` [A] |
| `FR-012` | Kehadiran pada satu Sesi tidak boleh otomatis dianggap sebagai kehadiran pada Sesi lain. | PRD §2.3; `D-003` [A] |

### 4.4 Peserta

| ID | Requirement | Sumber |
|---|---|---|
| `FR-013` | Setiap peserta harus memiliki field inti: Participant ID, Full Name, Category, Email, Phone, Status, dan QR Identity. | PRD §3.1 |
| `FR-014` | Participant ID harus dibuat otomatis dan tidak berubah. | PRD §3.1 |
| `FR-015` | Participant ID harus unik dalam Tema Acara. | PRD §3.1; `D-003` [A] |
| `FR-016` | Full Name harus wajib. | PRD §3.1 |
| `FR-017` | Category harus wajib. | PRD §3.1 |
| `FR-018` | Email dan Phone harus opsional. | PRD §3.1 |
| `FR-019` | Status peserta harus berupa aktif atau nonaktif. | PRD §3.1, §3.3 |
| `FR-020` | Peserta harus dapat dinonaktifkan tanpa menghapus riwayat. | PRD §3.3 |
| `FR-021` | Peserta nonaktif tidak boleh melakukan check-in. | PRD §3.3 |
| `FR-022` | Peserta nonaktif tidak boleh melakukan penukaran konsumsi. | PRD §3.3 |
| `FR-023` | QR Code peserta nonaktif tidak boleh dapat digunakan. | PRD §3.3 |
| `FR-024` | Riwayat transaksi peserta nonaktif harus tetap tersedia. | PRD §3.3 |
| `FR-025` | Aktivasi kembali peserta tidak boleh mengatur ulang riwayat transaksi. | PRD §3.3 |

### 4.5 Custom Fields

| ID | Requirement | Sumber |
|---|---|---|
| `FR-026` | Admin harus dapat membuat custom field sesuai kebutuhan Tema Acara. | PRD §3.2 |
| `FR-027` | Custom field harus mendukung tipe: Text, Number, Email, Phone, Select, Multi-select, Date, Textarea, dan Checkbox. | PRD §3.2 |
| `FR-028` | Setiap custom field harus memiliki nama, deskripsi, tipe, status required/optional, pilihan nilai bila diperlukan, urutan tampilan, dan status aktif/nonaktif. | PRD §3.2 |
| `FR-029` | Perubahan nama dan deskripsi field tidak boleh menghapus data yang telah tersimpan. | PRD §3.2 |
| `FR-030` | Field yang dinonaktifkan harus tetap menyimpan data lama dan harus dapat diaktifkan kembali. | PRD §3.2 |
| `FR-031` | Penghapusan field harus menggunakan pendekatan arsip atau soft-delete. | PRD §3.2 |
| `FR-032` | Perubahan tipe field harus melalui validasi kompatibilitas data. | PRD §3.2 |
| `FR-033` | Field khusus Aktivitas, seperti nomor kursi, baris, atau meja, tidak boleh dicampur dengan profil inti peserta. | PRD §3.2 |

### 4.6 Kategori Peserta

| ID | Requirement | Sumber |
|---|---|---|
| `FR-034` | Kategori peserta harus dikelola pada tingkat Tema Acara. | PRD §4 |
| `FR-035` | Kategori harus membantu menentukan entitlement peserta terhadap Aktivitas dan Sesi. | PRD §4 |
| `FR-036` | Sistem harus mendukung kategori seperti VIP, Reguler, dan Undangan. | PRD §4 |

### 4.7 Entitlement

| ID | Requirement | Sumber |
|---|---|---|
| `FR-037` | Entitlement harus memiliki lima tingkat: Individual–Session, Category–Session, Individual–Activity, Category–Activity, dan Theme default. | PRD §4.1; `D-005` [A] |
| `FR-038` | Prioritas entitlement dari tertinggi ke terendah harus: Individual–Session → Category–Session → Individual–Activity → Category–Activity → Theme default. | PRD §4.1; `D-005` [A] |
| `FR-039` | Status override harus mendukung Inherit, Allowed, dan Denied. Entitlement Sesi mewarisi entitlement Aktivitas kecuali di-override; override Sesi hanya berlaku untuk Sesi tersebut. | PRD §4.1; `D-005` [A] |
| `FR-040` | Saat Aktivitas baru dibuat, Admin harus mengonfigurasi entitlement untuk setiap kategori peserta secara eksplisit. | PRD §4.2; `D-005` [A] |
| `FR-041` | Aktivitas baru tidak otomatis mewarisi Theme-wide entitlement sebagai konfigurasi final. | PRD §4.2; `D-005` [A] |
| `FR-042` | Perubahan aturan kategori tidak boleh menghapus override individual. | PRD §4.2; `D-005` [A] |
| `FR-043` | Backend harus memvalidasi entitlement sebelum menerima transaksi. | PRD §4.3 |
| `FR-044` | Jika peserta tidak memiliki entitlement, transaksi harus ditolak dan tidak boleh menghasilkan catatan kehadiran atau penukaran yang berhasil. | PRD §4.3 |
| `FR-045` | Scanner harus menampilkan informasi bahwa peserta tidak memiliki akses. | PRD §4.3 |
| `FR-199` | Perubahan entitlement hanya berlaku untuk transaksi berikutnya; transaksi sukses yang sudah ada tetap valid dan tidak otomatis di-reversal atau dihapus. | PRD §4.2; `D-005` [A] |

### 4.8 Peserta: Import CSV

| ID | Requirement | Sumber |
|---|---|---|
| `FR-046` | Sistem harus mendukung impor peserta melalui CSV. | PRD §3.4 |
| `FR-047` | Alur impor harus mencakup: unggah CSV → pemetaan kolom → validasi → peninjauan duplikat → konfirmasi admin → laporan hasil. | PRD §3.4; `D-008` [A] |
| `FR-048` | Sistem harus mendukung penanganan duplikat berupa Skip dan Update; Update hanya boleh dilakukan setelah konfirmasi admin. | PRD §3.4; `D-008` [A] |
| `FR-049` | Update data peserta hanya boleh dilakukan setelah konfirmasi admin. | PRD §3.4 |
| `FR-050` | Sistem tidak boleh memperbarui data peserta secara otomatis tanpa persetujuan admin. | PRD §3.4 |
| `FR-051` | Participant ID harus dibuat oleh QRCek, bukan diambil begitu saja dari CSV. | PRD §3.4 |
| `FR-052` | Pencocokan peserta harus menggunakan External Reference dalam Tema yang sama. Jika External Reference cocok satu peserta, tawarkan Skip atau Update. Jika External Reference kosong atau tidak tersedia, anggap baris sebagai peserta baru dan tampilkan kemungkinan duplikat (nama, email, phone) untuk review manual. Jika External Reference cocok banyak kandidat, admin harus memilih secara eksplisit; sistem tidak boleh memilih atau menggabungkan secara otomatis. Nama, email, dan phone adalah sinyal peringatan saja, bukan identity key otomatis. | PRD §3.4; `D-008` [A] |
| `FR-053` | Nama, email, atau phone yang sama harus menghasilkan warning, bukan merge otomatis. Tidak boleh ada penggabungan profil peserta otomatis. | PRD §3.4; `D-008` [A] |
| `FR-197` | Impor CSV harus dibatasi maksimum 2 MB dan 1.000 baris data di luar header; error harus jelas dan actionable. | PRD §3.4; `D-020` [A] |
| `FR-205` | Field CSV yang kosong tidak boleh menghapus data peserta yang sudah tersimpan; nilai kosong diperlakukan sebagai tidak ada perubahan kecuali admin secara eksplisit memilih menghapus nilai. | PRD §3.4; `D-008` [A] |

### 4.9 QR Identity

| ID | Requirement | Sumber |
|---|---|---|
| `FR-054` | Setiap peserta harus memiliki satu QR Identity per Tema Acara dengan scope Tema + Peserta; peserta yang mengikuti beberapa Tema memiliki QR terpisah untuk setiap Tema. | PRD §5.1; `D-004` [A] |
| `FR-055` | QR Code harus berfungsi sebagai identitas/token, bukan tempat menyimpan seluruh data pribadi peserta. | PRD §5.1 |
| `FR-056` | Token QR harus acak dan sulit ditebak. | PRD §5.2 |
| `FR-057` | QR tidak boleh mengekspos data pribadi secara langsung. | PRD §5.2 |
| `FR-058` | Backend harus memvalidasi token setiap kali QR dipindai. | PRD §5.2 |
| `FR-059` | Token lama harus langsung tidak berlaku setelah rotasi. | PRD §5.2; `D-004` [A] |
| `FR-060` | Rotasi QR tidak boleh mengubah riwayat transaksi. | PRD §5.2; `D-004` [A] |
| `FR-061` | QR milik peserta nonaktif harus ditolak. | PRD §5.2 |
| `FR-062` | Perubahan atau rotasi QR harus dicatat dalam audit log. | PRD §5.2 |
| `FR-063` | Admin harus dapat mengunduh QR Code individual dalam format PNG. Backend harus mengotorisasi dan menyediakan data token yang diperlukan; generasi PNG dilakukan di browser. | PRD §5.3; `D-016` [A] |
| `FR-064` | Admin harus dapat mengunduh ZIP berisi file PNG QR setiap peserta. Backend mengotorisasi; browser melakukan packaging dengan batas batch dan memory. | PRD §5.3; `D-016` [A] |
| `FR-065` | Setiap file hasil ekspor harus dapat diidentifikasi dengan peserta yang benar. | PRD §5.3 |
| `FR-200` | QR token tidak boleh diekspos dalam konteks yang tidak berwenang; backend harus mengotorisasi setiap permintaan data token. | PRD §5.2; `D-016` [A] |

### 4.10 Attendance Management

| ID | Requirement | Sumber |
|---|---|---|
| `FR-066` | Kehadiran harus dicatat berdasarkan Aktivitas, dan berdasarkan Sesi apabila Aktivitas memiliki Sesi. | PRD §6.1; `D-003` [A] |
| `FR-067` | Peserta harus aktif, QR valid, memiliki entitlement, dan berada dalam konteks Aktivitas/Sesi yang benar agar kehadiran dapat dicatat. | PRD §6.2; `D-003` [A] |
| `FR-068` | Peserta tidak boleh memiliki lebih dari satu transaksi kehadiran efektif pada ruang lingkup yang sama: Aktivitas tanpa Sesi atau Sesi tertentu. | PRD §6.2; `D-006` [A] |
| `FR-069` | Pemindaian pada Sesi berbeda harus tetap dapat diterima apabila peserta memiliki entitlement. | PRD §6.4 |
| `FR-070` | Backend harus menjadi sumber kebenaran transaksi. | PRD §6.2 |
| `FR-071` | Keberhasilan hanya boleh ditampilkan setelah backend mengonfirmasi transaksi. | PRD §6.2 |
| `FR-072` | Sistem harus memisahkan Transaction Source (QR Scan atau Manual Entry) dari Correction Operation (Reversal atau Adjustment). Koreksi bukan Transaction Source. | PRD §6.3; `D-011` [A] |
| `FR-073` | Manual Check-in hanya boleh dilakukan oleh Petugas yang ditugaskan pada Aktivitas/Sesi tersebut apabila Admin Acara mengaktifkan kemampuan ini, atau oleh Admin Acara yang berwenang. Izin Manual Check-in untuk Super Admin belum ditetapkan (`OQ-034` [A]); legacy permission `attendance:correct` tidak boleh diinferensikan sebagai otorisasi target. | PRD §6.3; `D-022` [A], `OQ-034` [A] |
| `FR-074` | Transaksi Manual Entry harus mencatat akun pelaku dan source Manual Entry. | PRD §6.3; `D-022` [A] |
| `FR-075` | Pencegahan duplikasi harus dilakukan di backend dan database, bukan hanya melalui frontend. | PRD §6.4 |
| `FR-076` | Reversal harus membatalkan efek transaksi tanpa menghapus transaksi asli. | PRD §6.5; `D-006` [A] |
| `FR-077` | Reversal dan Adjustment hanya boleh dilakukan oleh Admin Acara. Petugas dan Super Admin tidak memiliki kewenangan koreksi; Super Admin hanya dapat melihat transaksi dan audit lintas Tema. | PRD §6.5; koreksi product owner 3 Nov 2026; `D-006` [A], `D-024` [A] |
| `FR-078` | Reversal dan Adjustment wajib memiliki alasan. | PRD §6.5; `D-006` [A] |
| `FR-079` | Reversal harus menghasilkan catatan pembalikan; Adjustment harus mencatat perubahan dengan nilai before/after. Tidak boleh menimpa riwayat secara diam-diam. | PRD §6.5; `D-006` [A] |
| `FR-080` | Audit log koreksi harus mencatat pelaku, waktu, alasan, objek yang dikoreksi, dan nilai before/after hanya untuk field yang diizinkan allowlist audit. | PRD §6.5; `D-006` [A], `FR-207` |
| `FR-201` | Transaksi yang sudah di-reversal tidak boleh dihitung sebagai duplikat; sistem harus mengizinkan check-in baru yang valid apabila syarat lain terpenuhi. | PRD §6.5; `D-006` [A] |
| `FR-202` | Adjustment harus menyimpan nilai before/after dan tidak boleh menimpa nilai historis secara diam-diam. | PRD §6.5; `D-006` [A] |

### 4.11 Consumption Distribution and Redemption

| ID | Requirement | Sumber |
|---|---|---|
| `FR-081` | Sistem harus mendukung distribusi konsumsi atau barang dengan kuota pengambilan. | PRD §7 |
| `FR-082` | Setiap jenis distribusi, seperti sarapan, makan siang, atau snack, harus merupakan transaksi independen. | PRD §7 |
| `FR-083` | Peserta harus aktif, QR valid, dan memiliki entitlement agar dapat menukar konsumsi. | PRD §7.1 |
| `FR-084` | Kuota konsumsi harus dapat dikonfigurasi: default di Aktivitas, override kategori, dan override individual. Nilai kuota boleh 0, 1, atau lebih. | PRD §7.1; `D-014` [A] |
| `FR-085` | Setiap penukaran harus dicatat sebagai transaksi. | PRD §7.1 |
| `FR-086` | Penukaran ganda harus dicegah berdasarkan transaksi efektif (`D-006` [A]); transaksi yang di-reversal tidak menghabiskan kuota (`D-014` [A]). | PRD §7.1; `D-006` [A], `D-014` [A] |
| `FR-087` | Riwayat penukaran tidak boleh dihapus karena perubahan entitlement. | PRD §7.1; `D-005` [A] |
| `FR-088` | Backend harus mengembalikan result code stabil: `SUCCESS`, `DUPLICATE`, `NOT_ENTITLED`, `INVALID_QR`, dan `SYSTEM_ERROR`. Result code harus terpisah dari pesan user-facing. | PRD §7.2, §10.3; `D-011` [A] |
| `FR-089` | Attendance dan Consumption harus menggunakan Transaction Type yang berbeda; satu Aktivitas hanya memiliki satu tipe utama. | PRD §7.2; `D-009` [A] |
| `FR-203` | Pesan duplikat harus kontekstual: Attendance “Sudah tercatat hadir”; Consumption “Sudah diambil”. | PRD §7.2; `D-011` [A] |

### 4.12 Activity and Session Lifecycle

| ID | Requirement | Sumber |
|---|---|---|
| `FR-090` | Aktivitas harus memiliki status Draft, Aktif, Selesai, dan Diarsipkan. | PRD §8.1 |
| `FR-091` | Sesi harus memiliki status operasional Terjadwal, Berlangsung, Selesai, dan Dinonaktifkan. Status arsip bukan status operasional kelima; arsip adalah state administratif terpisah (lihat `FR-206`). | PRD §8.2 |
| `FR-092` | Status Aktivitas dan status Sesi harus merupakan state machine terpisah. | PRD §8.2 |
| `FR-093` | Admin harus dapat membuat Sesi, mengubah nama/tanggal/waktu/lokasi, menonaktifkan, mengarsipkan, dan menggandakan konfigurasi Sesi. Pengarsipan Sesi tidak boleh menghapus atau membalik transaksi historis. | PRD §8.3; `FR-206` |
| `FR-094` | Penggandaan Sesi hanya boleh menyalin konfigurasi; riwayat transaksi tidak boleh ikut disalin. | PRD §8.3 |
| `FR-095` | Sesi hasil duplikasi harus memiliki identitas baru dan status awal Terjadwal. | PRD §8.3 |
| `FR-096` | Perubahan konfigurasi atau status Aktivitas/Sesi tidak boleh menghapus transaksi historis. | PRD §8.3 |
| `FR-183` | Backend harus menolak transaksi pada Aktivitas berstatus Draft, Selesai, atau Diarsipkan. | PRD §8.1; `D-010` [A] |
| `FR-184` | Aktivitas Aktif tanpa Sesi harus menerima transaksi yang terhubung langsung ke Aktivitas. | PRD §8.1; `D-010` [A] |
| `FR-185` | Aktivitas Aktif dengan Sesi harus mewajibkan pemilihan Sesi valid yang berada di bawah Aktivitas tersebut. | PRD §8.2; `D-010` [A] |
| `FR-186` | Transaksi hanya diterima pada Sesi berstatus Berlangsung; Sesi Terjadwal, Selesai, Dinonaktifkan, atau diarsipkan harus ditolak. | PRD §8.2; `D-010` [A] |
| `FR-187` | Sistem tidak boleh menyimpulkan Sesi secara otomatis dari waktu jam. | PRD §8.2; `D-010` [A] |
| `FR-188` | Backend harus menolak kombinasi Aktivitas/Sesi yang tidak konsisten. | PRD §8.2; `D-003` [A], `D-010` [A] |
| `FR-206` | Arsip Sesi harus menjadi state administratif terpisah dari status operasional. Sesi yang diarsipkan harus menolak transaksi baru, tetapi transaksi historisnya tetap dapat diakses, tidak dihapus, dan tidak di-reversal otomatis. Syarat kapan pengarsipan boleh dilakukan belum ditetapkan dan dicatat pada `OQ-033` [A]. | PRD §8.3; `OQ-033` [A] |

### 4.13 User Roles and Access Control

| ID | Requirement | Sumber |
|---|---|---|
| `FR-097` | Super Admin harus memiliki akses ke seluruh Tema Acara, pengelolaan pengguna, pengaturan sistem, seluruh laporan, seluruh audit log, dan melihat transaksi lintas Tema. Kewenangan Reversal/Adjustment tidak termasuk dalam akses ini; lihat `FR-077` dan `D-024` [A]. | PRD §9.1; `D-006` [A], `D-024` [A] |
| `FR-098` | Admin Acara harus memiliki akses terhadap Tema Acara yang ditugaskan untuk mengelola peserta, kategori, entitlement, Aktivitas, Sesi, Petugas, laporan, serta Reversal dan Adjustment. | PRD §9.2; `D-006` [A] |
| `FR-099` | Petugas harus ditugaskan pada Aktivitas atau Sesi tertentu. | PRD §9.3 |
| `FR-100` | Petugas hanya boleh mengakses scanner dalam lingkup tugasnya. | PRD §9.3 |
| `FR-101` | Petugas tidak boleh mengubah entitlement peserta. | PRD §9.3 |
| `FR-102` | Petugas tidak boleh mengubah konfigurasi Aktivitas. | PRD §9.3 |
| `FR-103` | Setiap transaksi harus mencatat identitas Petugas yang melakukan tindakan. | PRD §9.3 |
| `FR-104` | Pencabutan tugas tidak boleh menghapus transaksi historis. | PRD §9.3 |
| `FR-105` | Satu perangkat scanner boleh digunakan beberapa Petugas, tetapi masing-masing harus menggunakan akun sendiri. | PRD §9.3 |
| `FR-106` | Petugas tidak memiliki kewenangan Reversal atau Adjustment. | Koreksi product owner 3 Nov 2026; `D-006` [A] |
| `FR-194` | Pendaftaran Admin Acara harus melalui undangan Super Admin; pendaftaran mandiri publik harus dinonaktifkan; Super Admin harus dapat mencabut akses. | `D-018` [A] |

### 4.14 Scanner / Kiosk Interface

| ID | Requirement | Sumber |
|---|---|---|
| `FR-107` | Scanner harus merupakan antarmuka operasional terpisah dari dashboard admin. | PRD §10 |
| `FR-108` | Scanner harus mendukung konsep kiosk dengan kamera menghadap peserta dan peserta menunjukkan QR Code ke kamera. | PRD §10.1 |
| `FR-109` | Antarmuka scanner harus mengutamakan kamera dan hasil pemindaian. | PRD §10.1 |
| `FR-110` | Scanner harus memiliki camera preview dominan. | PRD §10.2 |
| `FR-111` | Scanner harus mendukung orientasi portrait dan landscape. | PRD §10.2 |
| `FR-112` | Scanner harus mendukung pemilihan kamera depan/belakang. | PRD §10.2 |
| `FR-113` | Scanner harus menyediakan feedback visual dan audio. | PRD §10.2 |
| `FR-114` | Scanner harus menampilkan indikator status jaringan. | PRD §10.2 |
| `FR-115` | Scanner harus menangani error kamera. | PRD §10.2 |
| `FR-116` | Scanner harus memiliki cooldown/debounce pemindaian. | PRD §10.2 |
| `FR-117` | Scanner harus menangani duplikasi. | PRD §10.2 |
| `FR-118` | Scanner harus kembali ke kondisi standby setelah hasil scan. | PRD §10.2 |
| `FR-119` | Scanner harus menampilkan lima keadaan utama: Success, Duplicate/Already Attended, Not Entitled, Invalid QR, dan System Error, untuk Attendance maupun Consumption. | PRD §7.2, §10.3; `D-011` [A] |
| `FR-120` | Pesan scanner harus dapat dikonfigurasi admin pada tingkat Tema Acara. | PRD §10.3 |
| `FR-121` | Variabel pesan yang direncanakan harus mencakup `{nama}`, `{id}`, `{acara}`, dan `{waktu}`. | PRD §10.3 |
| `FR-122` | Scanner harus online; tidak boleh ada antrean transaksi offline. | PRD §10.4 |
| `FR-123` | Setiap transaksi harus dikonfirmasi backend. | PRD §10.4 |
| `FR-124` | Audio feedback tidak boleh menumpuk tanpa batas. | PRD §10.4 |
| `FR-125` | Cooldown frontend tidak boleh menggantikan perlindungan duplikasi database. | PRD §10.4 |
| `FR-126` | Kesalahan jaringan harus dibedakan dari QR tidak valid. | PRD §10.4 |
| `FR-127` | Petugas hanya boleh menggunakan scanner sesuai Aktivitas/Sesi yang ditugaskan. | PRD §10.5 |
| `FR-128` | Pemilihan konteks scanner harus sesuai dengan izin Petugas. | PRD §10.5 |
| `FR-189` | Scanner harus menampilkan hasil scan lalu otomatis kembali ke standby; durasi feedback disarankan sekitar dua detik. Pemrosesan scan harus terkunci selama feedback ditampilkan dan tidak memerlukan konfirmasi manual setiap scan. | PRD §10.2; `D-012` [A] |
| `FR-190` | Scanner harus menampilkan konteks Aktivitas/Sesi yang aktif dan memvalidasi penugasan Petugas. URL parameter boleh memilih konteks awal, tetapi tidak boleh memberi otorisasi. | PRD §10.5; `D-012` [A] |
| `FR-191` | Petugas harus terautentikasi; tidak boleh ada URL scanning publik tanpa autentikasi. Konteks harus terkunci selama scanning, dan perubahan konteks memerlukan revalidasi. | `D-012` [A] |
| `FR-192` | Feedback visual/audio harus dapat dikonfigurasi pada tingkat Tema Acara, memiliki mute lokal per perangkat, tidak boleh mengandalkan warna saja, dan harus menyertakan teks dan/atau ikon. Scanner harus tetap usable tanpa audio. | PRD §10.3; `D-013` [A] |

#### 4.14.1 Detail feedback scanner

| Keadaan | Attendance | Consumption | Warna yang disarankan |
|---|---|---|---|
| Success | “Selamat Datang, {nama}!” | Status Berhasil; teks pesan belum ditentukan | Hijau |
| Duplicate / Already Attended | “Sudah tercatat hadir” | “Sudah diambil” | Amber |
| Not Entitled | Status Tidak berhak; teks pesan belum ditentukan | Status Tidak berhak; teks pesan belum ditentukan | Oranye |
| Invalid QR | “QR tidak dikenali.” | “QR tidak dikenali.” | Merah |
| System Error | Pesan kesalahan sistem atau jaringan | Pesan kesalahan sistem atau jaringan | Netral/error |

Warna di atas adalah rekomendasi proposed (`D-013` [A]); bukan keputusan final. Status tidak boleh disampaikan hanya melalui warna; harus ada teks dan/atau ikon. System Error harus dibedakan dari QR tidak valid dan tidak boleh menampilkan keberhasilan palsu. Pesan dapat dikonfigurasi admin pada tingkat Tema Acara. Variabel yang direncanakan: `{nama}`, `{id}`, `{acara}`, `{waktu}`.

### 4.15 Dashboard and Navigation

| ID | Requirement | Sumber |
|---|---|---|
| `FR-129` | Dashboard harus menampilkan informasi Tema Acara yang sedang dipilih. | PRD §11 |
| `FR-130` | Dashboard harus menampilkan informasi Tema Acara, total peserta, peserta hadir, peserta belum hadir, daftar Aktivitas dan status, ringkasan distribusi konsumsi, dan aktivitas terbaru. | PRD §11.1 |
| `FR-131` | Dashboard tidak boleh menggunakan grafik atau chart untuk versi yang direncanakan. | PRD §11.1 |
| `FR-132` | Dashboard harus memprioritaskan stat cards, tabel, dan daftar Aktivitas. | PRD §11.1 |
| `FR-133` | Navigasi admin harus terdiri dari Dashboard, Peserta, Aktivitas, Kategori Peserta, Laporan, dan Pengaturan. | PRD §11.2 |
| `FR-134` | Scanner/Kiosk harus memiliki antarmuka dan navigasi terpisah. | PRD §11.2 |

### 4.16 Audit Log

| ID | Requirement | Sumber |
|---|---|---|
| `FR-135` | Audit log harus mencatat tindakan penting, termasuk pembuatan/perubahan peserta, penonaktifan peserta, perubahan kategori, perubahan entitlement, pembuatan/rotasi/ekspor QR, pembuatan/perubahan Aktivitas/Sesi, penugasan Petugas, Manual Check-in, Reversal, Adjustment, impor, ekspor laporan, dan tindakan administratif/keamanan. | PRD §12; `D-023` [A] |
| `FR-136` | Setiap catatan audit harus mencakup Actor, Action, Object type, Object ID, Timestamp, dan Context/reason bila relevan. Before/after hanya boleh dicatat untuk field yang masuk allowlist audit; audit tidak boleh menyimpan snapshot objek penuh secara otomatis. | PRD §12.1; `D-023` [A], `FR-207` |
| `FR-137` | Audit log harus bersifat append-only. | PRD §12.1 |
| `FR-138` | Super Admin harus dapat mengakses seluruh audit log lintas Tema. | PRD §12.2 |
| `FR-139` | Admin Acara harus dapat mengakses audit log Tema yang dikelola. | PRD §12.2 |
| `FR-140` | Petugas tidak boleh memiliki akses ke audit log. | PRD §12.2 |
| `FR-195` | Audit log tidak boleh memuat token QR plaintext, password, atau secret; PII harus diminimalkan atau dimask. Untuk perubahan pada field peserta yang sensitif, audit hanya mencatat bahwa field tersebut berubah tanpa menampilkan nilai lama atau nilai baru. | PRD §12.1; `D-023` [A], `FR-207` |
| `FR-207` | Audit harus memakai strategi field allowlist: hanya field yang diperlukan untuk audit dan secara eksplisit diizinkan yang boleh disimpan sebagai before/after. Field PII atau sensitif di luar allowlist harus dikeluarkan atau dimask, dan perubahan padanya dicatat sebagai status "berubah" tanpa nilai. Actor, timestamp, action, object reference, dan reason tetap dipertahankan; audit tetap append-only. | PRD §12.1; `D-023` [A], `NFR-006` |

### 4.17 Reporting and Export

| ID | Requirement | Sumber |
|---|---|---|
| `FR-141` | Sistem harus menyediakan Participant Report yang memuat identitas peserta, kategori, dan status. | PRD §13.1 |
| `FR-142` | Sistem harus menyediakan Attendance Report yang memuat Aktivitas, Sesi, status kehadiran, waktu transaksi, dan Petugas. | PRD §13.1 |
| `FR-143` | Sistem harus menyediakan Distribution Report yang memuat jenis distribusi, total peserta berhak, total sudah mengambil, dan total belum mengambil. | PRD §13.1 |
| `FR-144` | Sistem harus menyediakan Activity Summary yang memuat ringkasan Aktivitas, status Aktivitas, dan ringkasan transaksi. | PRD §13.1 |
| `FR-145` | Laporan harus dapat difilter berdasarkan Aktivitas, Sesi, kategori, rentang tanggal, dan status peserta. | PRD §13.2 |
| `FR-146` | Laporan harus dapat diekspor dalam format CSV pada rilis awal. | PRD §13.3; `D-015` [A] |
| `FR-147` | Laporan harus dapat diekspor dalam format Excel (.xlsx) pada tahap implementasi berikutnya; XLSX tidak boleh dihapus dari kebutuhan jangka panjang. | PRD §13.3; `D-015` [A] |
| `FR-148` | Ekspor laporan harus mempertahankan konsistensi dengan filter yang sedang diterapkan. | PRD §13.3 |
| `FR-149` | Ekspor laporan harus dicatat dalam audit log. | PRD §13.3 |
| `FR-193` | Integrasi Google Sheets harus opsional per Tema, bukan sumber kebenaran; kegagalan sinkronisasi tidak boleh memblokir transaksi inti QRCek, dan integrasi tidak boleh diklaim production-ready sebelum diuji dengan akun Google nyata. | `D-017` [A] |

### 4.18 User Interface and Design System

| ID | Requirement | Sumber |
|---|---|---|
| `FR-150` | Arah desain harus minimal, modern, responsif, mudah digunakan, dan konsisten. | PRD §14 |
| `FR-151` | Referensi inspirasi harus mencakup Linear, Vercel, Supabase, dan shadcn/ui, sebagai inspirasi dan bukan target menyalin. | PRD §14 |
| `FR-152` | Desain harus mendukung light mode dan dark mode menggunakan CSS variables/design tokens. | PRD §14.1; `D-021` [A] |
| `FR-153` | Palet warna harus biru/slate. | PRD §14.1 |
| `FR-154` | Tipografi harus menggunakan Geist dengan aset lokal atau dependency; tidak boleh bergantung pada runtime CDN. | PRD §14.1; `D-021` [A] |
| `FR-155` | shadcn/ui harus menjadi komponen utama. | PRD §14.1 |
| `FR-156` | Ikon harus menggunakan Lucide. | PRD §14.1 |
| `FR-157` | Desain harus menggunakan border halus, shadow minimal, dan rounded corner sekitar 8–12 px. | PRD §14.1 |
| `FR-158` | Statistik harus menggunakan tabular numbers. | PRD §14.1 |
| `FR-159` | Setiap baris tabel tidak boleh dijadikan card. | PRD §14.1 |
| `FR-160` | Dashboard admin harus menggunakan pendekatan responsive dashboard. | PRD §14.2 |
| `FR-161` | Scanner harus menggunakan antarmuka khusus yang berorientasi kamera dan beradaptasi dengan portrait maupun landscape. | PRD §14.2 |
| `FR-204` | Implementasi UI harus memakai ulang CSS/token yang ada bila memungkinkan dan tidak boleh menambah runtime CDN. | `D-021` [A] |

### 4.19 Data Integrity and Security Principles

| ID | Requirement | Sumber |
|---|---|---|
| `FR-162` | Backend harus menjadi sumber kebenaran transaksi. | PRD §15 |
| `FR-163` | Frontend tidak boleh menentukan keberhasilan transaksi sendiri. | PRD §15 |
| `FR-164` | Semua transaksi harus divalidasi terhadap status peserta, entitlement, dan konteks Aktivitas/Sesi. | PRD §15; `D-003` [A] |
| `FR-165` | Pencegahan duplikasi harus ditegakkan di database. | PRD §15 |
| `FR-166` | Transaksi historis tidak boleh hilang akibat perubahan konfigurasi. | PRD §15 |
| `FR-167` | Koreksi harus dilakukan dengan Reversal atau Adjustment, bukan penimpaan diam-diam. | PRD §15; `D-006` [A] |
| `FR-168` | Token QR harus sulit ditebak dan tidak mengekspos data pribadi. | PRD §15 |
| `FR-169` | Entitlement harus diperiksa pada setiap endpoint yang relevan. | PRD §15 |
| `FR-170` | Operasi penting harus dicatat dalam audit log. | PRD §15 |
| `FR-171` | Perubahan schema harus melalui validasi dan regression test; tidak ada kewajiban kompatibilitas data produksi. | PRD §15; `D-007` [A] |

### 4.20 Existing System and Compatibility Requirements

| ID | Requirement | Sumber |
|---|---|---|
| `FR-172` | Fitur yang sudah berjalan dan masih relevan harus dievaluasi untuk dipakai ulang; tidak ada kewajiban mempertahankan struktur yang tidak kompatibel. | PRD §16.1; `D-007` [A] |
| `FR-173` | Fitur tidak boleh dibangun ulang tanpa alasan teknis yang jelas. | PRD §16.1 |
| `FR-174` | Perubahan arsitektur tidak wajib mempertahankan data produksi, tetapi harus mempertimbangkan reuse kode dan fitur. | PRD §16.1; `D-007` [A] |
| `FR-175` | Redesign atau migrasi internal harus memiliki validasi dan regression test; tidak ada kewajiban kompatibilitas data produksi. | PRD §16.1; `D-007` [A] |
| `FR-176` | Dokumentasi lama yang masih relevan harus dipertahankan sebagai referensi teknis. | PRD §16.1 |
| `FR-177` | Status implementasi harus dibedakan dari kebutuhan produk. | PRD §16.1 |
| `FR-178` | Dokumentasi tidak boleh mengklaim fitur selesai hanya karena endpoint atau komponen backend sudah tersedia. | PRD §16.1 |
| `FR-196` | Identifier teknis lama (`@absensi/*`, `absensi_session`, `X-Absensi-Csrf`, `absensi:v1:`) harus dipertahankan kecuali ada alasan teknis yang terbukti; nama produk tetap QRCek. | `D-019` [A] |
| `FR-198` | Tidak ada kewajiban migrasi data produksi; struktur database boleh dirancang ulang, dan kode/fitur lama boleh dipakai ulang setelah evaluasi. | `D-007` [A] |

### 4.21 Documentation Governance

| ID | Requirement | Sumber |
|---|---|---|
| `FR-179` | Dokumen ini harus menjadi sumber kebutuhan produk QRCek. | PRD §19 |
| `FR-180` | Dokumen terkait harus mencakup `ARCHITECTURE.md`, `DECISIONS.md`, `docs/adr/`, `IMPLEMENTATION_ROADMAP.md`, `.opencode/plans/`, `DESAIN_API.md`, `DESAIN_DATABASE.md`, `RENCANA_PENGUJIAN.md`, `OPERASIONAL.md`, dan `COSTS_AND_LIMITS.md`. | PRD §19 |
| `FR-181` | Perubahan nama, lokasi, dan status dokumen harus dikoordinasikan melalui pembaruan dokumentasi dan `AGENTS.md` (`D-001` [A]). | PRD §19 |

---

## 5. Business Rules

Business rule di bawah adalah invariant yang harus tetap benar terlepas dari pilihan arsitektur. Marker `[A]`/`[P]`/`[O]` mengikuti §0.2.

### 5.1 Hierarki dan konteks

| ID | Rule | Basis |
|---|---|---|
| `BR-001` | Peserta terdaftar pada tingkat Tema Acara. | PRD §2.4; `D-003` [A] |
| `BR-002` | Satu peserta memiliki satu QR Identity per Tema Acara; scope QR adalah Tema + Peserta. | PRD §5.1; `D-004` [A] |
| `BR-003` | Setiap transaksi harus terhubung dengan peserta, Tema Acara, Aktivitas, dan Sesi bila Aktivitas memiliki Sesi. | PRD §6.1; `D-003` [A] |
| `BR-004` | Aktivitas menentukan konteks operasional scanner. | PRD §2.3; `D-003` [A] |
| `BR-005` | Sesi menentukan ruang lingkup transaksi apabila Aktivitas memiliki Sesi. | PRD §2.4; `D-003` [A] |
| `BR-006` | Kehadiran pada satu Sesi tidak otomatis berlaku untuk Sesi lain. | PRD §2.3 |
| `BR-007` | Riwayat transaksi tidak boleh hilang ketika Aktivitas atau Sesi dinonaktifkan maupun diarsipkan. Pengarsipan Sesi hanya menolak transaksi baru; transaksi historis tetap tersedia dan tidak diubah. | PRD §8.3; `FR-206` |
| `BR-008` | Aktivitas yang tidak memiliki Sesi tetap harus memiliki konteks transaksi yang jelas, yaitu Aktivitas itu sendiri. | PRD §2.4; `D-003` [A] |
| `BR-009` | Struktur database tidak boleh ditentukan hanya berdasarkan dokumen kebutuhan ini; tidak ada kewajiban migrasi data produksi, tetapi reuse dan regression test harus dievaluasi. | `D-007` [A] |
| `BR-070` | Setiap Aktivitas hanya memiliki satu tipe transaksi utama: Attendance atau Consumption. | PRD §7.2; `D-009` [A] |

### 5.2 Peserta dan custom field

| ID | Rule | Basis |
|---|---|---|
| `BR-010` | Participant ID dibuat otomatis, tidak berubah, dan unik dalam Tema Acara. | PRD §3.1; `D-003` [A] |
| `BR-011` | Peserta nonaktif tidak boleh check-in atau menukar konsumsi; QR-nya harus ditolak. | PRD §3.3 |
| `BR-012` | Riwayat peserta nonaktif tetap tersedia; aktivasi ulang tidak mengatur ulang riwayat. | PRD §3.3 |
| `BR-013` | Perubahan nama/deskripsi custom field tidak boleh menghapus data tersimpan. | PRD §3.2 |
| `BR-014` | Custom field yang dinonaktifkan tetap menyimpan data dan dapat diaktifkan kembali. | PRD §3.2 |
| `BR-015` | Penghapusan custom field menggunakan arsip atau soft-delete. | PRD §3.2 |
| `BR-016` | Perubahan tipe custom field memerlukan validasi kompatibilitas data. | PRD §3.2 |
| `BR-017` | Field khusus Aktivitas tidak boleh dicampur dengan profil inti peserta. | PRD §3.2 |

### 5.3 Kategori dan entitlement

| ID | Rule | Basis |
|---|---|---|
| `BR-018` | Prioritas entitlement: Individual–Session → Category–Session → Individual–Activity → Category–Activity → Theme default. | PRD §4.1; `D-005` [A] |
| `BR-019` | Aktivitas baru harus mengonfigurasi entitlement setiap kategori secara eksplisit dan tidak otomatis mewarisi Theme-wide entitlement sebagai konfigurasi final. | PRD §4.2; `D-005` [A] |
| `BR-020` | Perubahan aturan kategori tidak boleh menghapus override individual. | PRD §4.2; `D-005` [A] |
| `BR-021` | Backend memvalidasi entitlement sebelum menerima transaksi. | PRD §4.3 |
| `BR-022` | Transaksi yang ditolak karena entitlement tidak boleh menghasilkan catatan kehadiran atau penukaran yang berhasil. | PRD §4.3 |
| `BR-023` | Entitlement Sesi mewarisi entitlement Aktivitas kecuali di-override; override Sesi hanya berlaku untuk Sesi tersebut. | PRD §4.1; `D-005` [A] |
| `BR-075` | Perubahan entitlement hanya berlaku untuk transaksi berikutnya; transaksi sukses yang sudah ada tetap valid dan tidak otomatis dibalik atau dihapus. | PRD §4.2; `D-005` [A] |

### 5.4 QR Identity

| ID | Rule | Basis |
|---|---|---|
| `BR-024` | Token QR harus acak dan sulit ditebak. | PRD §5.2 |
| `BR-025` | QR tidak boleh mengekspos data pribadi. | PRD §5.2 |
| `BR-026` | Backend memvalidasi token pada setiap scan. | PRD §5.2 |
| `BR-027` | Rotasi QR membuat token lama langsung tidak berlaku. | PRD §5.2; `D-004` [A] |
| `BR-028` | Rotasi QR tidak mengubah riwayat transaksi. | PRD §5.2; `D-004` [A] |
| `BR-029` | Setiap perubahan atau rotasi QR dicatat dalam audit log. | PRD §5.2 |

### 5.5 Kehadiran dan koreksi

| ID | Rule | Basis |
|---|---|---|
| `BR-030` | Kehadiran dicatat berdasarkan Aktivitas, dan berdasarkan Sesi bila Aktivitas memiliki Sesi. | PRD §6.1; `D-003` [A] |
| `BR-031` | Syarat kehadiran: peserta aktif, QR valid, memiliki entitlement, dan konteks Aktivitas/Sesi valid. | PRD §6.2; `D-003` [A] |
| `BR-032` | Duplikasi dihitung berdasarkan transaksi efektif pada ruang lingkup yang sama: Aktivitas tanpa Sesi atau Sesi tertentu. Sesi berbeda dapat diterima bila berhak. | PRD §6.4; `D-006` [A] |
| `BR-033` | Pencegahan duplikasi ditegakkan di backend dan database, bukan hanya di frontend. | PRD §6.4 |
| `BR-034` | Manual Check-in hanya oleh Petugas yang ditugaskan dan diaktifkan Admin Acara, atau Admin Acara berwenang; pelaku dan source harus dicatat. Izin Manual Check-in untuk Super Admin belum ditetapkan (`OQ-034` [A]); legacy permission `attendance:correct` tidak boleh dianggap sebagai otorisasi target. | PRD §6.3; `D-022` [A], `OQ-034` [A] |
| `BR-035` | Keberhasilan transaksi hanya ditampilkan setelah backend mengonfirmasi. | PRD §6.2 |
| `BR-036` | Reversal dan Adjustment hanya boleh dilakukan oleh Admin Acara. Petugas dan Super Admin tidak memiliki kewenangan koreksi. | PRD §6.5; koreksi product owner 3 Nov 2026; `D-006` [A], `D-024` [A] |
| `BR-037` | Reversal dan Adjustment wajib memiliki alasan. | PRD §6.5; `D-006` [A] |
| `BR-038` | Reversal membatalkan efek transaksi tanpa menghapus transaksi asli; Adjustment menyimpan before/after dan tidak menimpa riwayat secara diam-diam. | PRD §6.5; `D-006` [A] |
| `BR-039` | Koreksi dicatat dalam audit log dengan pelaku, waktu, alasan, objek, dan before/after bila relevan. | PRD §6.5; `D-006` [A] |
| `BR-040` | Koreksi tidak boleh menghapus riwayat transaksi; transaksi yang di-reversal tidak lagi menghalangi check-in baru yang valid. | PRD §6.5; `D-006` [A] |
| `BR-072` | Result code backend harus stabil dan terpisah dari pesan user-facing; respons backend yang masih pending tidak boleh ditampilkan sebagai sukses. | PRD §10.4; `D-011` [A] |

### 5.6 Distribusi konsumsi

| ID | Rule | Basis |
|---|---|---|
| `BR-041` | Setiap jenis distribusi konsumsi merupakan transaksi independen. | PRD §7 |
| `BR-042` | Penukaran memerlukan peserta aktif, QR valid, dan entitlement yang sesuai. | PRD §7.1 |
| `BR-043` | Kuota konsumsi harus dapat dikonfigurasi dengan default Aktivitas, override kategori, dan override individual; nilai boleh 0, 1, atau lebih. | PRD §7.1; `D-014` [A] |
| `BR-044` | Penukaran ganda harus dicegah berdasarkan transaksi efektif. | PRD §7.1; `D-006` [A] |
| `BR-045` | Riwayat penukaran tetap ada setelah perubahan entitlement. | PRD §7.1; `D-005` [A] |
| `BR-046` | Attendance dan Consumption adalah Transaction Type yang berbeda; satu Aktivitas hanya memiliki satu tipe utama. | PRD §7.2; `D-009` [A] |
| `BR-073` | Transaksi Consumption yang di-reversal tidak menghabiskan kuota dan kuota yang dibebaskan dapat dipakai transaksi valid berikutnya. Ini adalah perilaku kuota proposed, bukan bagian dari keputusan Reversal yang sudah disepakati. | PRD §7.1; `D-014` [A] |

### 5.7 Lifecycle

| ID | Rule | Basis |
|---|---|---|
| `BR-047` | State machine Aktivitas dan Sesi terpisah. | PRD §8.2 |
| `BR-048` | Penggandaan Sesi hanya menyalin konfigurasi, membuat identitas baru, dan memakai status awal Terjadwal. | PRD §8.3 |
| `BR-049` | Perubahan konfigurasi/status tidak menghapus transaksi historis. | PRD §8.3 |
| `BR-071` | Backend harus menolak kombinasi lifecycle yang tidak valid: Aktivitas Draft/Selesai/Diarsipkan, Sesi Terjadwal/Selesai/Dinonaktifkan/diarsipkan, atau Sesi yang bukan milik Aktivitas tersebut. Sesi tidak boleh disimpulkan dari waktu jam. | PRD §8.1, §8.2; `D-010` [A] |
| `BR-078` | Status operasional Sesi dan state arsip adalah dua hal berbeda. Sesi yang diarsipkan menolak transaksi baru tanpa menghapus, membalik, atau menyembunyikan transaksi historis; syarat kapan pengarsipan boleh dilakukan masih terbuka (`OQ-033` [A]). | PRD §8.3; `FR-206`, `OQ-033` [A] |

### 5.8 Peran dan scanner

| ID | Rule | Basis |
|---|---|---|
| `BR-050` | Petugas ditugaskan pada Aktivitas/Sesi tertentu; scanner dibatasi pada penugasan itu. Aktivitas tanpa Sesi memakai konteks Aktivitas; Aktivitas dengan Sesi memerlukan pemilihan Sesi eksplisit. | PRD §9.3, §10.5; `D-012` [A] |
| `BR-051` | Petugas tidak dapat mengubah entitlement atau konfigurasi Aktivitas. | PRD §9.3 |
| `BR-052` | Pencabutan tugas tidak menghapus transaksi historis. | PRD §9.3 |
| `BR-053` | Perangkat scanner bersama tetap memerlukan akun masing-masing Petugas. | PRD §9.3 |
| `BR-054` | Scanner harus online; tidak ada antrean transaksi offline. | PRD §10.4 |
| `BR-055` | Cooldown frontend tidak menggantikan perlindungan duplikasi database. | PRD §10.4 |
| `BR-056` | Kesalahan jaringan harus dibedakan dari QR tidak valid. | PRD §10.4 |
| `BR-057` | Scanner tidak boleh menampilkan keberhasilan palsu. | PRD §10.4 |

### 5.9 Audit dan ekspor

| ID | Rule | Basis |
|---|---|---|
| `BR-058` | Audit log bersifat append-only. | PRD §12.1 |
| `BR-059` | Ekspor laporan dicatat dalam audit log. | PRD §13.3 |
| `BR-060` | Ekspor laporan harus konsisten dengan filter yang sedang diterapkan. | PRD §13.3 |
| `BR-074` | Audit log tidak boleh memuat token QR plaintext, password, atau secret; PII harus diminimalkan atau dimask; akses audit mengikuti peran. | PRD §12.1; `D-023` [A] |
| `BR-079` | Audit hanya menyimpan before/after untuk field yang ada dalam allowlist. Snapshot objek penuh, nilai PII mentah, dan kredensial tidak boleh disimpan; perubahan field sensitif dicatat sebagai "berubah" tanpa nilai lama/baru. | PRD §12.1; `D-023` [A], `FR-207` |

### 5.10 Import

| ID | Rule | Basis |
|---|---|---|
| `BR-061` | Sistem tidak boleh memperbarui peserta secara otomatis tanpa persetujuan admin. | PRD §3.4 |
| `BR-062` | Participant ID dibuat oleh QRCek, bukan diambil dari CSV. | PRD §3.4 |
| `BR-063` | Pencocokan impor menggunakan External Reference dalam Tema yang sama. Baris tanpa External Reference dianggap peserta baru dengan warning kemungkinan duplikat (nama/email/phone) untuk review manual. External Reference yang cocok banyak kandidat memerlukan pilihan eksplisit oleh admin; tidak ada pemilihan atau merge otomatis. Nama/email/phone tidak boleh menjadi identity key otomatis. Tidak ada penggabungan profil otomatis. | PRD §3.4; `D-008` [A] |
| `BR-076` | Impor CSV dibatasi 2 MB dan 1.000 baris data di luar header; error harus jelas dan actionable. | PRD §3.4; `D-020` [A] |
| `BR-077` | Field CSV kosong tidak boleh menghapus data peserta yang sudah ada; nilai kosong berarti tidak ada perubahan kecuali admin memilih menghapus nilai secara eksplisit. | PRD §3.4; `D-008` [A] |

### 5.11 Integritas dan kompatibilitas

| ID | Rule | Basis |
|---|---|---|
| `BR-064` | Backend adalah sumber kebenaran transaksi. | PRD §15 |
| `BR-065` | Frontend tidak boleh menentukan keberhasilan transaksi sendiri. | PRD §15 |
| `BR-066` | Transaksi historis tidak boleh dihapus atau ditimpa secara diam-diam. | PRD §15 |
| `BR-067` | Tidak ada kewajiban kompatibilitas data produksi; perubahan schema tetap harus melalui validasi dan regression test. | PRD §16.1; `D-007` [A] |
| `BR-068` | Fitur lama yang masih relevan boleh dipakai ulang setelah evaluasi; tidak ada kewajiban mempertahankan struktur yang tidak kompatibel. | PRD §16.1; `D-007` [A] |
| `BR-069` | Dokumentasi tidak boleh mengklaim fitur selesai hanya karena endpoint backend tersedia. | PRD §16.1 |

---

## 6. Non-Functional Requirements

> **Catatan referensi ADR.** Sejak v0.3.2, ADR historis yang semula tercatat inline di `docs/ARSITEKTUR.md` sudah diekstrak tanpa perubahan keputusan ke `docs/adr/`: ADR-002 → `docs/adr/0002-passwordless-token-auth.md`, ADR-003 → `docs/adr/0003-opaque-qr-token.md`, ADR-006 → `docs/adr/0006-qr-credential-hash-ciphertext.md`, ADR-007 → `docs/adr/0007-event-admin-self-signup.md`. `docs/ARSITEKTUR.md` sekarang bernama `docs/ARCHITECTURE.md`.

| ID | Requirement | Sumber |
|---|---|---|
| `NFR-001` | Otorisasi harus dievaluasi di backend pada setiap endpoint yang relevan. | PRD §15; `AGENTS.md` dan `docs/ARCHITECTURE.md` |
| `NFR-002` | Sesi harus menggunakan cookie `HttpOnly`, `SameSite=Lax`, `Path=/`, dan `Secure` saat HTTPS. | ADR-0002 (`docs/adr/0002-passwordless-token-auth.md`) |
| `NFR-003` | Semua request non-GET harus memakai header CSRF khusus dan `Origin` yang cocok dengan host. Nama header mengikuti `OQ-026` [A]. | `AGENTS.md` dan ADR-0002; `D-019` [A] |
| `NFR-004` | Rate limiting login, aktivasi, pemulihan, dan scan harus memakai penyimpanan D1, bukan layanan berbayar. | `AGENTS.md` dan `docs/ARCHITECTURE.md` |
| `NFR-005` | Secret Google Sheets, penandatanganan QR, dan secret sesi tidak boleh sampai ke bundle frontend. | `AGENTS.md` dan `docs/ARCHITECTURE.md` |
| `NFR-006` | Log dan audit trail tidak boleh memuat PII, nama, email, nomor telepon, atau token QR mentah; nilai before/after untuk field sensitif tidak boleh disimpan dan hanya dicatat sebagai perubahan. | `AGENTS.md` dan `docs/ARCHITECTURE.md`; `FR-207` |
| `NFR-007` | Token QR harus memiliki entropi yang memadai dan tidak dapat diprediksi. | PRD §5.2 |
| `NFR-008` | Penyimpanan QR harus memakai hash untuk lookup dan ciphertext untuk cetak ulang, tanpa plaintext. | ADR-0003 dan ADR-0006 (`docs/adr/`) |
| `NFR-009` | Solusi tidak boleh memerlukan layanan berbayar; seluruh komponen harus berada dalam free tier. | `AGENTS.md` |
| `NFR-010` | Desain harus memperhitungkan batas CPU Workers Free 10 ms per request. | `COSTS_AND_LIMITS.md` |
| `NFR-011` | Desain harus memperhitungkan batas D1 Free 50 query per invokasi Worker dan memakai batch untuk operasi atomik. | `COSTS_AND_LIMITS.md` |
| `NFR-012` | Desain harus memperhitungkan batas penyimpanan D1 500 MB dan kebijakan retensi audit. | `COSTS_AND_LIMITS.md` |
| `NFR-013` | Semua waktu harus disimpan dalam UTC; konversi zona waktu hanya di lapisan presentasi. | `AGENTS.md` |
| `NFR-014` | Scanner memerlukan secure context (HTTPS atau localhost) untuk akses kamera. | Aturan platform |
| `NFR-015` | Akses kamera di iOS Safari harus dipicu gesture pengguna, bukan otomatis. | Aturan platform |
| `NFR-016` | Antarmuka admin harus responsif; scanner harus mendukung portrait dan landscape. | PRD §14.2 |
| `NFR-017` | Tidak ada kewajiban kompatibilitas data produksi; perubahan schema harus tetap menjaga konsistensi riwayat transaksi dalam aplikasi dan melalui regression test. | PRD §15, §16.1; `D-007` [A] |
| `NFR-018` | Setiap aturan integritas penting harus memiliki test yang gagal bila aturan dihapus. | `AGENTS.md` |
| `NFR-019` | Setiap perubahan perilaku harus disertai pembaruan dokumentasi terkait. | `AGENTS.md` |
| `NFR-020` | Tidak boleh menambah dependensi tanpa justifikasi tertulis dan tanpa mengevaluasi Web API atau kode sendiri. | `AGENTS.md` |
| `NFR-021` | Aset font dan UI harus disajikan lokal atau dibundel; tidak boleh bergantung pada runtime CDN. | `D-021` [A] |
| `NFR-022` | Scanner harus tetap dapat digunakan tanpa audio; status tidak boleh disampaikan hanya melalui warna. | `D-013` [A] |
| `NFR-023` | Retensi audit harus mempertimbangkan batas D1 free tier dan tidak boleh mengorbankan sifat append-only atau memuat PII berlebihan. | `COSTS_AND_LIMITS.md`; `D-023` [A] |

---

## 7. Baseline Implementasi Terverifikasi

> Bagian ini **bukan kebutuhan**. Ini adalah potret implementasi pada commit `157c330`, diverifikasi 3 November 2026. Baseline tetap berlaku sebagai fakta historis dan tidak diubah oleh keputusan v0.3. Tidak ada klaim bahwa fitur sudah selesai end-to-end.
>
> **Koreksi faktual v0.3.2.** Baris "Scanner UI" (§7.2), §7.3 #4, dan baris "Scanner/kiosk" (§8.2) dikoreksi karena bukti v0.3.1 keliru: `apps/web/src/pages/staff-scan.tsx` tidak diimpor di mana pun, sedangkan rute `/staff/scan` merender `StaffScanPage` di `apps/web/src/pages/staff.tsx` yang memanggil endpoint scan. Ini koreksi fakta pada commit yang sama, bukan penyesuaian baseline terhadap target (§14 #15).

### 7.1 Ringkasan eksekusi

| Item | Hasil |
|---|---|
| Perintah | `npm run test` |
| File test | 48 |
| Test | 458 lulus |
| Route API | 50 definisi route; 87 pola efektif setelah alias `/api/calendar` |
| Migrasi | 6 file (`0001`–`0006`) |
| Source code diubah saat verifikasi | Tidak |
| Perangkat fisik diuji | Tidak |
| Google Sheets nyata diuji | Tidak |
| CPU produksi diukur | Tidak |

#### 7.1.1 Metode penghitungan route

| Metrik | Angka | Metode |
|---|---|---|
| Definisi route | 50 | Menghitung entri `pattern:` pada file route non-test di `apps/api/src/routes/*.ts`; setiap entri adalah pasangan method + path. |
| Route dengan alias | 37 | Entri yang pattern-nya `/api/events` atau diawali `/api/events/`; `apps/api/src/app.ts` menduplikasinya menjadi alias `/api/calendar...`. |
| Pola efektif | 87 | 50 definisi route + 37 alias. |
| “Sekitar 60” | Tidak terverifikasi | Angka estimasi dari audit sebelumnya; tidak didukung hitungan source code. Angka yang dipakai adalah 50 definisi dan 87 pola efektif. |

### 7.1.2 Verifikasi setelah Q1 (6 November 2026)

> Angka di sini **bukan** baseline §7.1 dan tidak menggantikannya. Baseline pada `157c330` tetap fakta historis (§14 #15).

| Item | Hasil |
|---|---|
| Perintah | `npm run test` (didahului `typecheck` dan `lint`, ditutup `build`) |
| File test | 53 |
| Test | 525 lulus |
| Route API | 61 definisi route; 159 pola efektif setelah alias `/api/calendar` dan `/api/themes` |
| Metode hitung | 61 entri `pattern:`; 49 di antaranya berawalan `/api/events`, masing-masing menghasilkan dua alias |
| Migrasi | 7 file (`0001`–`0007`) |
| Cakupan Q1 | Aktivitas/Sesi API-only; registrasi publik ditutup (ADR-0013) |
| Catatan | Migrasi `0007` diterapkan di remote **6 November 2026** setelah backup penuh; verifikasi `schema_version = 7`. |

### 7.2 Baseline per area

| Area | Kondisi aktual | Bukti |
|---|---|---|
| Autentikasi | Passwordless berbasis token, aktivasi undangan, kode pemulihan, sesi cookie, revoke sesi, rate limit. | `apps/api/src/routes/auth.ts`, `apps/api/src/test/auth.*.test.ts`, `migrations/0002_auth.sql` |
| Peran dan membership | Tiga peran: `superadmin`, `event_admin`, `officer`; membership per acara. | `apps/api/src/domain/permissions.ts`, `apps/api/src/test/permissions.test.ts` |
| Pendaftaran mandiri | Admin acara dapat mendaftar sendiri (ADR-0007, `docs/adr/0007-event-admin-self-signup.md`). | `apps/api/src/routes/auth.ts`, `migrations/0006_self_signup.sql`, `apps/api/src/test/auth.register.test.ts` |
| Acara | CRUD acara, status `draft/active/closed/archived`, ringkasan, anggota, undangan. | `apps/api/src/routes/events.ts`, `apps/api/src/test/events.crud.test.ts` |
| Peserta | CRUD peserta, status `active/inactive`, field `external_ref`, `full_name`, `phone`, `email`, `category` (teks), `note`. | `apps/api/src/routes/participants.ts`, `migrations/0003_participants.sql`, `apps/api/src/test/participants.crud.test.ts` |
| Impor CSV | Header tetap 6 kolom, batas 2 MB dan 1.000 baris, pratinjau `dry_run`, upsert berdasarkan `external_ref`. | `apps/api/src/domain/participant-import.ts`, `packages/shared/src/schemas/participants.ts`, `apps/api/src/test/participants.import.test.ts` |
| Kategori | Hanya kolom teks `participants.category`; tidak ada entitas kategori atau CRUD kategori. | `migrations/0003_participants.sql` |
| Entitlement | Tidak ada model hak akses per aktivitas/kategori/individu. | Tidak ada tabel atau route terkait |
| Aktivitas dan sesi | Tidak ada tabel aktivitas atau sesi. | `migrations/` hanya memiliki `events` |
| QR Identity | Token opaque `absensi:v1:<token>`, hash HMAC untuk lookup, ciphertext AES-256-GCM, rotasi, audit ekspor. | `apps/api/src/domain/qr-token.ts`, `migrations/0004_qr.sql`, `apps/api/src/test/qr-token.test.ts`, `apps/api/src/test/qr.db.test.ts` |
| Label QR | Konfigurasi field per acara, preview dan cetak A4/sticker melalui `window.print()`. Belum ada unduhan PNG individual atau ZIP. | `apps/api/src/routes/labels.ts`, `apps/web/src/components/label-sheet.tsx`, `apps/web/src/lib/qr-labels.ts` |
| Scan | Endpoint `POST /api/events/:eventId/scan`; hasil `present`, `duplicate`, `not_found`, `wrong_event`, `event_closed`, `participant_inactive`. | `apps/api/src/routes/scan.ts`, `packages/shared/src/attendance.ts`, `apps/api/src/routes/scan.test.ts` |
| Kehadiran | Satu baris per peserta per acara; `UNIQUE (event_id, participant_id)`. Status `present/late/absent/excused`; metode `qr_scan/manual/correction`. | `migrations/0005_attendance_sync.sql` baris 31, `apps/api/src/routes/attendance.ts` |
| Manual check-in | Tersedia bila `events.allow_manual = 1`; otorisasi memakai aksi `attendance:correct` sehingga hanya admin acara/superadmin. | `apps/api/src/routes/attendance.ts`, `apps/api/src/domain/permissions.ts` |
| Koreksi | Menimpa baris `attendance` dengan `UPDATE`, menyimpan snapshot before/after di audit. Alasan wajib. | `apps/api/src/db/attendance.ts` baris 238, `apps/api/src/routes/attendance.ts` |
| Distribusi konsumsi | Tidak ada. | Tidak ada tabel atau route terkait |
| Lifecycle aktivitas/sesi | Tidak ada; hanya lifecycle acara. | `migrations/0002_auth.sql` |
| Audit | Tabel append-only; aksi yang terverifikasi: `attendance.recorded`, `attendance.corrected`, `attendance.wrong_event`, `qr.labels_exported`. Mutasi peserta, acara, kategori, entitlement, dan ekspor laporan belum tercatat. | `migrations/0004_qr.sql`, `apps/api/src/db/audit.ts`, `apps/api/src/routes/audit.ts`, `apps/api/src/routes/audit.test.ts` |
| Dashboard | Endpoint dashboard global dan per acara; tanpa chart. | `apps/api/src/routes/dashboard.ts`, `packages/shared/src/attendance.ts` |
| Laporan | Ekspor CSV kehadiran dan CSV peserta; belum ada XLSX atau laporan distribusi. | `apps/api/src/routes/attendance.ts`, `apps/api/src/routes/participants.ts` |
| Sinkronisasi Google Sheets | Outbox persisten D1, proyeksi satu baris per peserta, cron, retry. Tidak dibahas di PRD. | `migrations/0005_attendance_sync.sql`, `apps/api/src/services/outbox.ts`, `apps/api/src/routes/sync.ts`, `apps/api/src/routes/sync.test.ts` |
| Kesehatan dan operasional | `GET /api/health`, `GET /api/health/ready`, `GET /api/admin/usage`, security headers. | `apps/api/src/routes/health.ts`, `apps/api/src/routes/admin.ts`, `apps/api/src/test/ops.test.ts` |
| Scanner UI | Rute `/staff/scan` merender `StaffScanPage` (`staff.tsx`): pemilihan acara dari keanggotaan, kamera, pemanggilan `POST /api/events/:eventId/scan`, kunci selama request, toast hasil, dan pesan koneksi bermasalah. `QrScanner` memakai kamera belakang (`facingMode: environment`) dan debounce; belum ada audio, pemilihan kamera depan/belakang, indikator status jaringan, konteks Aktivitas/Sesi, atau mode kiosk. `staff-scan.tsx` adalah placeholder lama yang tidak diim| `apps/web/src/pages/staff-scan.tsx` baris 23, `apps/web/src/components/qr-scanner.tsx` |
| Navigasi admin | Dashboard, Acara, Aktivitas, Pengaturan; tab acara: Ringkasan, Peserta, Petugas, Absensi, Laporan. | `apps/web/src/lib/navigation.ts` |
| Desain | Token monokrom, font sistem, light mode saja, belum ada Geist atau dark mode. | `apps/web/src/index.css` |
| Nama teknis | Paket `@absensi/*`, cookie `absensi_session`, header `X-Absensi-Csrf`, prefix QR `absensi:v1:`; Worker bernama `qrcek`. | `package.json`, `apps/api/wrangler.jsonc`, `apps/api/src/domain/qr-token.ts` |

### 7.3 Batasan baseline

1. Tidak ada verifikasi perangkat fisik untuk scanner.
2. Tidak ada verifikasi akun Google Sheets nyata.
3. Tidak ada pengukuran CPU produksi.
4. `staff-scan.tsx` belum terintegrasi ke API, sehingga alur scan end-to-end belum selesai.
5. Baseline ini tidak boleh diubah menjadi klaim bahwa kebutuhan PRD sudah terpenuhi.
6. Baseline ini tidak berubah karena keputusan v0.3; perubahan target dicatat di §8.

---

## 8. Delta Requirements vs Implementation

### 8.1 Legenda status

| Status | Arti |
|---|---|
| Sesuai | Implementasi sudah memenuhi kebutuhan pada tingkat yang terverifikasi. |
| Sebagian | Sebagian kebutuhan terpenuhi; ada bagian yang belum atau berbeda. |
| Bertentangan | Implementasi saat ini tidak dapat memenuhi kebutuhan tanpa perubahan model/perilaku. |
| Belum ada | Tidak ada implementasi terkait. |
| Menunggu keputusan | Bergantung pada `OQ-xxx` atau rekomendasi `D-xxx [P]`. |

### 8.2 Matriks delta

| Area | Status | Delta utama | Bukti |
|---|---|---|---|
| Tema Acara | Bertentangan | Tidak ada entitas Tema Acara terpisah; hanya `events` datar. Target hierarki ditetapkan `D-003` [A]; tidak ada kewajiban migrasi data produksi (`D-007` [A]). | `migrations/0002_auth.sql` |
| Aktivitas | Belum ada | Tidak ada tabel, route, atau UI Aktivitas. Target `D-003` [A] dan `D-009` [A]. | `migrations/` |
| Sesi | Belum ada | Tidak ada tabel, route, atau UI Sesi. Target `D-003` [A]. | `migrations/` |
| Kehadiran per Sesi | Bertentangan | `UNIQUE (event_id, participant_id)` membatasi satu kehadiran per acara, bukan per Aktivitas/Sesi. Target `D-003` [A]. | `migrations/0005_attendance_sync.sql` baris 31 |
| Field inti peserta | Sebagian | Field inti tersedia, tetapi `category` masih teks bebas dan nullable; belum ada validasi wajib kategori. | `migrations/0003_participants.sql`, `packages/shared/src/schemas/participants.ts` |
| Custom fields | Belum ada | Tidak ada definisi field, nilai, atau UI. | `migrations/` |
| Kategori peserta | Bertentangan | Kategori hanya string; tidak ada entitas, CRUD, atau relasi. | `migrations/0003_participants.sql` |
| Entitlement | Belum ada | Tidak ada model lima tingkat, override, atau validasi akses per Aktivitas/Sesi. Target `D-005` [A]. | Tidak ada implementasi |
| Impor CSV | Sebagian | Sudah ada pratinjau dan upsert `external_ref`, tetapi belum ada pemetaan kolom, peninjauan duplikat Skip/Update, atau persetujuan update per baris. Target `D-008` [A], `D-020` [A]. | `apps/api/src/domain/participant-import.ts`, `apps/api/src/routes/participants.ts` |
| QR Identity | Sesuai | Token opaque, hash, ciphertext, rotasi, audit. Scope target Tema + Peserta ditetapkan `D-004` [A]; token saat ini terbit per event. | `apps/api/src/domain/qr-token.ts`, `migrations/0004_qr.sql` |
| Ekspor QR PNG/ZIP | Belum ada | Yang ada adalah preview dan cetak browser (A4/sticker), bukan unduhan PNG individual atau ZIP. Target `D-016` [A]. | `apps/web/src/components/label-sheet.tsx`, `apps/api/src/routes/labels.ts` |
| Attendance | Bertentangan | Model saat ini per acara, bukan per Aktivitas/Sesi. Target `D-003` [A]. | `migrations/0005_attendance_sync.sql` |
| Pencegahan duplikat | Sebagian | Ditegakkan di database, tetapi pada level acara, bukan Aktivitas/Sesi; belum memperhitungkan transaksi efektif dan Reversal. Target `D-006` [A]. | `migrations/0005_attendance_sync.sql` |
| Manual check-in | Sebagian | Tersedia, tetapi hanya untuk admin acara/superadmin; rekomendasi Petugas berizin masih `D-022` [A]. | `apps/api/src/routes/attendance.ts`, `apps/api/src/domain/permissions.ts` |
| Koreksi transaksi | Bertentangan | Saat ini menimpa baris `attendance`; target `D-006` [A] meminta Reversal/Adjustment yang mempertahankan transaksi asli. Otorisasi Admin Acara sudah sesuai; Super Admin masih proposed `D-024` [A]. | `apps/api/src/db/attendance.ts` baris 238, `apps/api/src/routes/attendance.ts` |
| Distribusi konsumsi | Belum ada | Tidak ada model, route, UI, atau laporan. Target `D-009` [A], `D-014` [A]. | Tidak ada implementasi |
| Lifecycle Aktivitas/Sesi | Belum ada | Hanya lifecycle acara. Target `D-010` [A]. | `migrations/0002_auth.sql` |
| Peran dan penugasan | Sebagian | Tiga peran tersedia, tetapi Petugas ditugaskan per acara, bukan per Aktivitas/Sesi. Target `D-012` [A]. | `apps/api/src/domain/permissions.ts`, `migrations/0002_auth.sql` |
| Scanner/kiosk | Sebagian | Halaman placeholder, belum memanggil API; belum ada audio, pemilihan kamera, indikator jaringan, atau pemilihan konteks. Target `D-012` [A], `D-013` [A]. | `apps/web/src/pages/staff-scan.tsx`, `apps/web/src/components/qr-scanner.tsx` |
| Dashboard | Sebagian | Sudah ada statistik dan daftar, tetapi belum memuat Aktivitas, Sesi, atau distribusi konsumsi. | `apps/api/src/routes/dashboard.ts` |
| Navigasi | Bertentangan | Navigasi admin saat ini belum memiliki Peserta, Kategori Peserta, dan Laporan sebagai level global. | `apps/web/src/lib/navigation.ts` |
| Audit | Sebagian | Append-only dan beberapa aksi sudah tercatat; cakupan aksi target dan privasi audit masih `D-023` [A]. | `apps/api/src/db/audit.ts`, `apps/api/src/routes/audit.ts` |
| Laporan | Sebagian | CSV peserta dan kehadiran tersedia; XLSX, laporan distribusi, dan filter lanjutan belum ada. Target `D-015` [A]. | `apps/api/src/routes/attendance.ts`, `apps/api/src/routes/participants.ts` |
| Desain | Bertentangan | Monokrom, font sistem, tanpa dark mode, belum Geist. Target `D-021` [A]. | `apps/web/src/index.css` |
| Nama produk | Sebagian | Produk disebut QRCek, tetapi identifier teknis masih `absensi`. Rekomendasi mempertahankan identifier ada di `D-019` [A]. | `package.json`, `apps/api/wrangler.jsonc`, `apps/api/src/domain/qr-token.ts` |
| Google Sheets | Menunggu keputusan | Fitur berjalan, tetapi belum jelas apakah dipertahankan dan bagaimana bentuknya setelah ada Sesi/konsumsi. Rekomendasi `D-017` [A]. | `apps/api/src/routes/sync.ts`, `migrations/0005_attendance_sync.sql` |

---

## 9. Acceptance Criteria

> Marker `[A]`/`[P]`/`[O]` mengikuti §0.2. Acceptance criterion `[P]` belum final sampai rekomendasi terkait disetujui.

### 9.1 Prinsip penerimaan global

| ID | Kriteria |
|---|---|
| `AC-G-01` | Persyaratan fungsional terpenuhi. |
| `AC-G-02` | Validasi backend tersedia. |
| `AC-G-03` | Hak akses diuji. |
| `AC-G-04` | Pencegahan transaksi ganda diuji. |
| `AC-G-05` | Riwayat transaksi tetap konsisten. |
| `AC-G-06` | Error handling tersedia. |
| `AC-G-07` | UI sesuai dengan konteks pengguna. |
| `AC-G-08` | Test yang relevan lulus. |
| `AC-G-09` | Dokumentasi diperbarui. |
| `AC-G-10` | Perubahan siap melalui review manusia. |

### 9.2 Kriteria per kapabilitas

| ID | Kapabilitas | Kriteria penerimaan | Basis |
|---|---|---|---|
| `AC-001` | Tema, Aktivitas, Sesi | Model dapat merepresentasikan satu Tema Acara dengan banyak Aktivitas dan Sesi; tidak ada kewajiban mempertahankan data produksi, tetapi riwayat transaksi dalam aplikasi tetap konsisten. | `D-003` [A], `D-007` [A] |
| `AC-002` | Konteks transaksi | Setiap transaksi dapat ditelusuri ke peserta, Tema, Aktivitas, dan Sesi bila Aktivitas memiliki Sesi. | `D-003` [A] |
| `AC-003` | Isolasi konteks | Transaksi dengan peserta/Aktivitas/Sesi yang tidak cocok ditolak. | `D-003` [A] |
| `AC-004` | Aktivitas dengan/tanpa Sesi | Aktivitas tanpa Sesi menerima transaksi langsung ke Aktivitas; Aktivitas dengan Sesi mewajibkan Sesi valid milik Aktivitas tersebut. | `D-003` [A] |
| `AC-005` | Riwayat | Menonaktifkan atau mengarsipkan Aktivitas/Sesi tidak menghapus transaksi historis. | PRD §8.3 |
| `AC-006` | Peserta | Field inti tervalidasi; Participant ID otomatis, tidak berubah, dan unik dalam Tema. | PRD §3.1; `D-003` [A] |
| `AC-007` | Status peserta | Peserta nonaktif ditolak pada check-in dan penukaran; riwayat tetap ada setelah aktivasi ulang. | PRD §3.3 |
| `AC-008` | Custom field | Rename, deactivate, archive, dan perubahan tipe tidak menghapus data yang masih valid. | PRD §3.2 |
| `AC-009` | Impor | Admin dapat memetakan kolom, meninjau duplikat, memilih Skip/Update, dan mengonfirmasi sebelum penulisan. Pencocokan memakai External Reference dalam Tema yang sama; baris tanpa External Reference dianggap peserta baru dengan warning duplikat untuk review manual; External Reference yang cocok banyak memerlukan pilihan eksplisit admin. | `D-008` [A] |
| `AC-010` | Impor tanpa persetujuan | Tidak ada update peserta otomatis tanpa konfirmasi admin. | PRD §3.4 |
| `AC-011` | Kategori dan entitlement | Prioritas Individual–Session → Category–Session → Individual–Activity → Category–Activity → Theme default diuji, termasuk Inherit/Allowed/Denied. | `D-005` [A] |
| `AC-012` | Aktivitas baru | Aktivitas baru mengonfigurasi entitlement setiap kategori secara eksplisit dan tidak otomatis memakai Theme-wide entitlement sebagai konfigurasi final. | `D-005` [A] |
| `AC-013` | Penolakan entitlement | Peserta tanpa hak ditolak dan tidak menghasilkan transaksi berhasil. | PRD §4.3 |
| `AC-014` | Override individual | Perubahan aturan kategori tidak menghapus override individual. | `D-005` [A] |
| `AC-015` | QR | Token opaque, tidak memuat PII, scope Tema + Peserta, dan divalidasi backend pada setiap scan. | `D-004` [A] |
| `AC-016` | Rotasi QR | Token lama langsung ditolak; riwayat transaksi tidak berubah; rotasi tercatat di audit. | PRD §5.2 |
| `AC-017` | QR nonaktif | QR peserta nonaktif ditolak. | PRD §5.2 |
| `AC-018` | Ekspor QR | PNG individual dan ZIP dapat diunduh; backend mengotorisasi; browser menghasilkan PNG/packaging; setiap file teridentifikasi dengan peserta yang benar; batas batch/memory diterapkan. | `D-016` [A] |
| `AC-019` | Attendance | Scan valid mencatat Attendance pada Aktivitas/Sesi yang benar. | `D-003` [A] |
| `AC-020` | Duplikat Attendance | Scan ulang pada ruang lingkup efektif yang sama ditolak; Sesi berbeda dapat diterima bila berhak; transaksi yang di-reversal tidak menghalangi check-in baru. | `D-006` [A] |
| `AC-021` | Manual check-in | Hanya aktor berizin; pelaku dan source tercatat; validasi backend dan duplikasi tetap berjalan. Izin Manual Check-in untuk Super Admin belum ditetapkan; legacy permission `attendance:correct` tidak bukti otorisasi target. | `D-022` [A], `OQ-034` [A] |
| `AC-022` | Reversal | Hanya Admin Acara; alasan wajib; transaksi asli tetap ada; efek dibatalkan; audit tercatat. | `D-006` [A] |
| `AC-023` | Koreksi dan peran | Petugas tidak dapat melakukan Reversal/Adjustment; Super Admin masih proposed dan belum final. | `D-006` [A], `D-024` [A] |
| `AC-024` | Konsumsi | Setiap jenis distribusi independen; kuota default Aktivitas, override kategori/individual; penukaran ganda berdasarkan transaksi efektif ditolak. | `D-014` [A] |
| `AC-025` | Riwayat konsumsi | Perubahan entitlement tidak menghapus riwayat penukaran. | `D-005` [A] |
| `AC-026` | Feedback scanner | Success, Duplicate/Already Attended, Not Entitled, Invalid QR, dan System Error dibedakan untuk Attendance dan Consumption. | `D-011` [A] |
| `AC-027` | Scanner online | Tidak ada antrean offline; kegagalan jaringan tidak menampilkan keberhasilan. | PRD §10.4 |
| `AC-028` | Penugasan scanner | Petugas hanya dapat memindai dalam Aktivitas/Sesi yang ditugaskan; konteks divalidasi backend. | `D-012` [A] |
| `AC-029` | Dashboard | Menampilkan seluruh konten yang diminta tanpa chart. | PRD §11 |
| `AC-030` | Navigasi | Enam tujuan admin tersedia dan terpisah dari scanner. | PRD §11.2 |
| `AC-031` | Audit | Aksi penting tercatat; audit append-only; akses sesuai peran; PII diminimalkan; before/after terbatas pada field allowlist. | `D-023` [A], `FR-207` |
| `AC-032` | Laporan | Empat jenis laporan tersedia dan dapat difilter. | PRD §13 |
| `AC-033` | Ekspor laporan | CSV tersedia pada rilis awal; XLSX tersedia pada tahap berikutnya; hasil konsisten dengan filter; ekspor tercatat di audit. | `D-015` [A] |
| `AC-034` | Keamanan | Setiap endpoint menguji otorisasi; tidak ada kebocoran PII atau secret. | PRD §15 |
| `AC-035` | Integritas | Aturan duplikasi dan riwayat memiliki test yang gagal bila aturan dihapus. | `AGENTS.md` |
| `AC-036` | Legacy data | Tidak ada kewajiban migrasi data produksi; perubahan schema memiliki validasi dan regression test. | `D-007` [A] |
| `AC-037` | Reuse | Fitur lama yang masih relevan boleh dipakai ulang dan test lama tetap lulus setelah evaluasi. | `D-007` [A] |
| `AC-038` | Dokumentasi | Dokumen terkait diperbarui pada perubahan yang sama. | `AGENTS.md` |
| `AC-039` | Desain | Light/dark mode, palet biru/slate, Geist lokal, shadcn/ui, Lucide, radius 8–12 px, tabular numbers, dan layout responsif terpenuhi; tabel tidak diubah menjadi card. | `D-021` [A] |
| `AC-040` | Konsistensi hasil scan | Result code `SUCCESS`, `DUPLICATE`, `NOT_ENTITLED`, `INVALID_QR`, `SYSTEM_ERROR` konsisten untuk Attendance dan Consumption; tidak ada keberhasilan palsu. | `D-011` [A] |
| `AC-041` | Adjustment | Perubahan mencatat before/after dan tidak menimpa nilai historis secara diam-diam. | `D-006` [A] |
| `AC-042` | Tanpa merge otomatis | Nama/email/phone yang sama menghasilkan warning; kandidat ambigu direview manual; tidak ada penggabungan profil otomatis. | `D-008` [A] |
| `AC-043` | Entitlement future-only | Perubahan entitlement tidak mengubah transaksi sukses yang sudah ada dan tidak melakukan reversal otomatis. | `D-005` [A] |
| `AC-044` | Kombinasi lifecycle | Kombinasi Aktivitas/Sesi yang tidak valid ditolak; tidak ada inferensi Sesi dari waktu jam. | `D-010` [A] |
| `AC-045` | Reversal membebaskan slot | Attendance yang di-reversal tidak lagi dihitung sebagai duplikat dan check-in baru yang valid dapat dilakukan. | `D-006` [A] |
| `AC-046` | Kuota setelah Reversal | Reversal pada transaksi Consumption mengembalikan kuota yang sebelumnya terpakai. Perilaku ini proposed dan belum final. | `D-014` [A] |
| `AC-047` | Privasi audit | Audit tidak memuat token QR plaintext, password, atau secret; nilai before/after untuk field sensitif tidak disimpan, hanya status perubahannya; PII diminimalkan/dimask. | `D-023` [A], `FR-207` |
| `AC-048` | Pending bukan sukses | Respons backend yang masih pending tidak pernah ditampilkan sebagai sukses; scanner mengunci pemrosesan selama feedback. | `D-012` [A] |
| `AC-049` | Manual source | Manual Check-in adalah Transaction Source, bukan Correction Operation; Petugas tidak dapat melakukan Reversal/Adjustment. Izin Manual Check-in untuk Super Admin belum ditetapkan (`OQ-034` [A]). | `D-022` [A], `OQ-034` [A] |
| `AC-050` | Registrasi Admin | Admin Acara hanya dapat mendaftar melalui undangan; self-registration publik nonaktif; pencabutan akses berfungsi. | `D-018` [A] |
| `AC-051` | Google Sheets | Integrasi opsional; kegagalan sync tidak memblokir transaksi inti; belum diklaim production-ready sebelum diuji dengan akun nyata. | `D-017` [A] |
| `AC-052` | Identifier teknis | Identifier lama dipertahankan kecuali ada alasan teknis terbukti; nama produk QRCek. | `D-019` [A] |
| `AC-053` | Aksesibilitas UI | Status tidak hanya warna; teks/ikon tersedia; scanner usable tanpa audio; aset font lokal/tanpa runtime CDN. | `D-013` [A], `D-021` [A] |
| `AC-054` | Impor field kosong | Field CSV kosong tidak menghapus data peserta yang sudah ada; perubahan hanya terjadi bila admin mengonfirmasi. | `D-008` [A] |
| `AC-055` | Izin Manual Check-in | Legacy permission `attendance:correct` tidak boleh otomatis dianggap sebagai otorisasi Manual Check-in pada model target; otorisasi harus direkonsiliasi sebelum implementasi. | `OQ-034` [A] |

---

## 10. Out of Scope

Ruang lingkup yang dikecualikan didefinisikan sebagai `NG-01`–`NG-06` di §1.2. Tidak ada non-goal tambahan di dokumen ini.

Desain kartu peserta dibuat manual di Canva menggunakan hasil ekspor PNG dari QRCek.

---

## 11. Open Questions and Pending Decisions

> Bagian ini membedakan tiga status: pertanyaan yang sudah ditutup, pertanyaan yang sudah memiliki rekomendasi proposed tetapi belum disetujui, dan pertanyaan yang masih terbuka tanpa rekomendasi final.

### 11.1 Pertanyaan yang sudah ditutup

| ID | Pertanyaan asli | Diselesaikan oleh | Status |
|---|---|---|---|
| `OQ-001` | Bagaimana strategi migrasi model event yang sekarang menuju hierarki Tema Acara → Aktivitas → Sesi? | `D-003` [A], `D-007` [A] | Ditutup |
| `OQ-002` | Apakah event lama akan menjadi tema acara atau aktivitas di bawah tema baru? | `D-003` [A], `D-007` [A] | Ditutup |
| `OQ-003` | Apakah aktivitas tertentu boleh memiliki transaksi langsung tanpa sesi, atau semua transaksi harus memiliki konteks sesi? | `D-003` [A] | Ditutup |
| `OQ-004` | Bagaimana hubungan entitas aktivitas dan sesi diterapkan tanpa merusak data lama? | `D-003` [A], `D-007` [A] | Ditutup |
| `OQ-005` | Bagaimana detail pewarisan hak akses dari kategori ke aktivitas dan sesi? | `D-005` [A] | Ditutup |
| `OQ-006` | Apakah hak akses individual dapat berlaku pada tingkat sesi? | `D-005` [A] | Ditutup |
| `OQ-007` | Bagaimana perubahan hak akses menangani transaksi yang sudah terjadi? | `D-005` [A] | Ditutup |
| `OQ-023` | Apakah `AGENTS.md` boleh diperbarui untuk menunjuk struktur dokumen baru? | `D-001` [A] | Ditutup |
| `OQ-024` | Apa status final `IMPLEMENTATION_PLAN.md` dan `PLAN_TAB_PESERTA.md`: diarsipkan, dipindah, atau dipertahankan? | `D-002` [A] | Ditutup |
| `OQ-032` | Apakah token QR terikat pada kombinasi Tema Acara dan Peserta, atau token cukup mengidentifikasi peserta dan Tema Acara ditentukan berdasarkan konteks scanner? | `D-004` [A] | Ditutup |
| `OQ-008` | Bagaimana strategi pencocokan peserta saat impor CSV tanpa Participant ID? | `D-008` [A] | Ditutup |
| `OQ-009` | Bagaimana sistem menangani kemungkinan dua peserta memiliki nama, email, atau nomor telepon yang sama? | `D-008` [A] | Ditutup |
| `OQ-010` | Apakah tipe aktivitas (kehadiran dan distribusi) menjadi konfigurasi eksplisit? | `D-009` [A] | Ditutup |
| `OQ-011` | Bagaimana aturan transaksi berdasarkan status aktivitas dan sesi? | `D-010` [A] | Ditutup |
| `OQ-012` | Bagaimana struktur transaksi koreksi dan pembalikan? | `D-011` [A] | Ditutup |
| `OQ-013` | Bagaimana transaksi distribusi dan kehadiran direpresentasikan serta dipisahkan? | `D-009` [A], `D-011` [A] | Ditutup |
| `OQ-014` | Setelah transaksi, apakah scanner langsung kembali standby atau menampilkan hasil sementara sebelum standby? | `D-012` [A] | Ditutup |
| `OQ-015` | Bagaimana detail konfigurasi feedback audio dan visual? | `D-013` [A] | Ditutup |
| `OQ-016` | Bagaimana pengelolaan konteks scanner pada aktivitas yang memiliki sesi dan yang tidak memiliki sesi? | `D-012` [A] | Ditutup |
| `OQ-017` | Apakah kuota konsumsi selalu 1 per jenis distribusi, atau dapat dikonfigurasi per kategori/peserta? | `D-014` [A] | Ditutup |
| `OQ-018` | Bagaimana mekanisme pemilihan konteks kiosk: URL, konfigurasi perangkat, atau login petugas? | `D-012` [A] | Ditutup |
| `OQ-019` | Apakah XLSX wajib pada rilis pertama, atau CSV lebih dulu? | `D-015` [A] | Ditutup |
| `OQ-020` | Apakah PNG dan ZIP dibuat di browser atau di server? | `D-016` [A] | Ditutup |
| `OQ-021` | Apakah sinkronisasi Google Sheets dipertahankan? Jika ya, bagaimana bentuknya setelah ada sesi dan konsumsi? | `D-017` [A] | Ditutup |
| `OQ-022` | Apakah pendaftaran mandiri Admin Acara (ADR-007 historis di `docs/ARSITEKTUR.md`) dipertahankan? | `D-018` [A] | Ditutup |
| `OQ-025` | Apakah Super Admin termasuk pihak yang boleh melakukan koreksi transaksi? | `D-024` [A] | Ditutup |
| `OQ-026` | Apakah identifier teknis lama (`@absensi/*`, cookie `absensi_session`, header `X-Absensi-Csrf`, prefix QR `absensi:v1:`) akan diganti menjadi QRCek? | `D-019` [A] | Ditutup |
| `OQ-027` | Lokasi final `COSTS_AND_LIMITS.md`: tetap di root atau dipindah ke `docs/`? | Tetap di root | Ditutup |
| `OQ-028` | Apakah batas impor aktual (1.000 baris, 2 MB) dipertahankan sebagai batas produk? | `D-020` [A] | Ditutup |
| `OQ-029` | Apakah penambahan font Geist dan mode gelap memerlukan dependensi baru, atau dapat memakai aset lokal/Web API? | `D-021` [A] | Ditutup |
| `OQ-030` | Apakah Petugas berizin boleh melakukan manual check-in, atau kewenangan itu tetap hanya untuk Admin Acara? | `D-022` [A] | Ditutup |
| `OQ-031` | Aksi audit mana yang wajib pada rilis pertama, mengingat PRD menyebut daftar contoh yang lebih luas daripada implementasi saat ini? | `D-023` [A] | Ditutup |
| `OQ-033` | Syarat kapan pengarsipan Sesi boleh dilakukan: hanya setelah Selesai, atau juga pada status lain? Apakah ada batasan operasional tambahan? | Hanya dari Selesai/Dinonaktifkan, hanya Admin Acara | Ditutup |
| `OQ-034` | Apakah Super Admin boleh melakukan Manual Check-in, atau kewenangan Manual Check-in hanya untuk Admin Acara dan Petugas berizin? | Tidak; hanya Admin Acara dan Petugas berizin | Ditutup |

Pertanyaan di atas tidak boleh dibuka kembali. Riwayat dan keputusan lengkapnya ada di §12.1.


Semua pertanyaan di atas sudah ditutup oleh keputusan disepakati di §12.1.

---

## 12. Decision Register

Bagian ini mencatat keputusan dan rekomendasi secara terpisah. Keputusan `[A]` sudah disetujui product owner. Keputusan `[P]` adalah rekomendasi yang belum disetujui dan tidak boleh diperlakukan sebagai keputusan final. Pertanyaan yang masih terbuka tetap dicatat di §11.3.

### 12.1 Keputusan yang sudah disepakati (`[A]`)

#### `D-001` — Pembaruan `AGENTS.md`

| Atribut | Nilai |
|---|---|
| ID | `D-001` |
| Status | Disepakati `[A]` |
| Bekas open question | `OQ-023` |
| Pertanyaan asli | Apakah `AGENTS.md` boleh diperbarui untuk menunjuk struktur dokumen baru? |
| Keputusan | `AGENTS.md` boleh diperbarui setelah struktur dokumentasi disepakati. |
| Tanggal keputusan | 3 November 2026 |
| Pemilik keputusan | Product owner QRCek |

Konsekuensi:

1. Pembaruan `AGENTS.md` tidak boleh mendahului kesepakatan struktur dokumentasi.
2. `AGENTS.md` belum diubah pada revisi dokumen ini; perubahan tersebut berada di luar batas pekerjaan sekarang.
3. Setelah struktur disepakati, `AGENTS.md` harus menunjuk dokumen kanonik yang baru tanpa menduplikasi isinya.

#### `D-002` — Status `IMPLEMENTATION_PLAN.md` dan `PLAN_TAB_PESERTA.md`

| Atribut | Nilai |
|---|---|
| ID | `D-002` |
| Status | Disepakati `[A]` |
| Bekas open question | `OQ-024` |
| Pertanyaan asli | Apa status final `IMPLEMENTATION_PLAN.md` dan `PLAN_TAB_PESERTA.md`: diarsipkan, dipindah, atau dipertahankan? |
| Keputusan | `IMPLEMENTATION_PLAN.md` dipertahankan sebagai arsip historis. Bagian relevan dari `PLAN_TAB_PESERTA.md` dievaluasi dan diintegrasikan ke rencana implementasi baru. |
| Tanggal keputusan | 3 November 2026 |
| Pemilik keputusan | Product owner QRCek |

Konsekuensi:

1. `IMPLEMENTATION_PLAN.md` tidak dijadikan sumber rencana aktif dan tidak dihapus.
2. Isi `PLAN_TAB_PESERTA.md` tidak disalin mentah-mentah; hanya bagian yang relevan yang diintegrasikan.
3. Rencana implementasi baru tetap merujuk ke `FR-xxx`, `BR-xxx`, dan `AC-xxx`, bukan menyalin ulang dokumen ini.
4. Rencana implementasi baru belum dibuat pada revisi ini.

#### `D-003` — Hierarki produk dan konteks transaksi

| Atribut | Nilai |
|---|---|
| ID | `D-003` |
| Status | Disepakati `[A]` |
| Menyelesaikan | `OQ-001`, `OQ-002`, `OQ-003`, `OQ-004` |
| Keputusan | Hierarki produk adalah Tema Acara → Aktivitas → Sesi. Peserta terdaftar pada Tema. Aktivitas berada di bawah Tema. Sesi opsional berada di bawah Aktivitas. Aktivitas dapat memiliki nol, satu, atau banyak Sesi. Jika Aktivitas tidak memiliki Sesi, transaksi terhubung langsung ke Aktivitas. Jika Aktivitas memiliki Sesi, setiap transaksi wajib merujuk Sesi valid milik Aktivitas tersebut. Backend wajib menolak kombinasi Aktivitas/Sesi yang tidak konsisten. |
| Tanggal keputusan | 3 November 2026 |
| Pemilik keputusan | Product owner QRCek |

Konsekuensi:

1. Tidak ada transaksi pada level Tema tanpa Aktivitas.
2. Tidak ada Sesi lintas Aktivitas.
3. Sesi tidak boleh disimpulkan otomatis dari waktu jam.
4. Skema database dan strategi implementasi tetap dibahas di dokumen arsitektur.
5. Tidak ada kewajiban migrasi data produksi; lihat `D-007`.

#### `D-004` — Scope QR Identity

| Atribut | Nilai |
|---|---|
| ID | `D-004` |
| Status | Disepakati `[A]` |
| Menyelesaikan | `OQ-032` |
| Keputusan | Satu peserta memiliki satu QR Identity per Tema Acara. Scope QR adalah Tema + Peserta. Peserta yang mengikuti beberapa Tema memiliki QR terpisah untuk setiap Tema. QR yang sama digunakan pada seluruh Aktivitas dan Sesi dalam Tema tersebut, tergantung entitlement. |
| Tanggal keputusan | 3 November 2026 |
| Pemilik keputusan | Product owner QRCek |

Konsekuensi:

1. QR tidak boleh dipakai lintas Tema.
2. Rotasi QR berlaku untuk Tema tersebut dan tidak mengubah riwayat transaksi.
3. Keputusan ini tidak boleh dibuka kembali.
4. Pemetaan teknis QR lama ke Tema mengikuti evaluasi implementasi, bukan kewajiban migrasi data produksi.

#### `D-005` — Prioritas dan pewarisan entitlement

| Atribut | Nilai |
|---|---|
| ID | `D-005` |
| Status | Disepakati `[A]` |
| Menyelesaikan | `OQ-005`, `OQ-006`, `OQ-007` |
| Keputusan | Entitlement memakai kategori dengan override individual. Prioritas: Individual–Session → Category–Session → Individual–Activity → Category–Activity → Theme default. Aktivitas baru wajib mengonfigurasi entitlement setiap kategori secara eksplisit dan tidak otomatis memakai Theme default sebagai konfigurasi final. Sesi mewarisi entitlement Aktivitas kecuali di-override; override Sesi hanya berlaku untuk Sesi tersebut. Perubahan entitlement hanya berlaku untuk transaksi berikutnya; transaksi sukses yang sudah ada tetap valid. |
| Tanggal keputusan | 3 November 2026 |
| Pemilik keputusan | Product owner QRCek |

Konsekuensi:

1. Tidak ada kategori yang otomatis memperoleh akses final ke Aktivitas baru.
2. Perubahan kategori tidak menghapus override individual.
3. Transaksi lama tidak boleh di-reversal otomatis karena perubahan entitlement.
4. Detail representasi data tetap dibahas di arsitektur.

#### `D-006` — Reversal dan Adjustment

| Atribut | Nilai |
|---|---|
| ID | `D-006` |
| Status | Disepakati `[A]` |
| Mengatur | `FR-076`–`FR-080`, `FR-201`, `FR-202`, `BR-036`–`BR-040`, `AC-022`, `AC-041`, `AC-045` |
| Keputusan | Hanya Admin Acara yang boleh melakukan Reversal atau Adjustment. Petugas tidak memiliki kewenangan koreksi, termasuk terhadap transaksi yang ia buat. Koreksi wajib memiliki alasan dan wajib tercatat di audit. Reversal membatalkan efek transaksi tanpa menghapus transaksi asli; transaksi kehadiran yang di-reversal tidak lagi menghalangi check-in baru yang valid. Adjustment mempertahankan transaksi asli dan mencatat perubahan before/after tanpa menimpa riwayat secara diam-diam. Duplikasi kehadiran dihitung dari transaksi efektif, bukan dari seluruh riwayat. Perilaku kuota Consumption setelah Reversal **tidak** termasuk keputusan ini dan tetap proposed pada `D-014` [A]. |
| Tanggal keputusan | 3 November 2026 |
| Pemilik keputusan | Product owner QRCek |

Konsekuensi:

1. Transaksi asli dan riwayat koreksi harus dipertahankan.
2. Reversal Attendance membebaskan slot duplikasi kehadiran.
3. Perilaku kuota Consumption setelah Reversal **belum diputuskan** di sini; rekomendasinya ada di `D-014` [A] dan menunggu review product owner.
4. Kewenangan Super Admin masih proposed (`D-024` [A]) dan belum menjadi bagian keputusan ini.

#### `D-007` — Data produksi dan kompatibilitas

| Atribut | Nilai |
|---|---|
| ID | `D-007` |
| Status | Disepakati `[A]` |
| Menyelesaikan | Bagian relevan dari `OQ-001`, `OQ-002`, `OQ-004` |
| Keputusan | Tidak ada kewajiban migrasi data produksi karena aplikasi belum digunakan di produksi. Struktur database boleh dirancang ulang untuk mendukung Tema → Aktivitas → Sesi. Kode dan fitur lama boleh dipakai ulang setelah evaluasi. Tidak ada kewajiban kompatibilitas database produksi, tetapi regression testing dan validasi tetap wajib. |
| Tanggal keputusan | 3 November 2026 |
| Pemilik keputusan | Product owner QRCek |

Konsekuensi:

1. Tidak ada kebutuhan backfill atau migrasi data produksi.
2. Fitur lama tidak otomatis dihapus; evaluasi reuse tetap dilakukan.
3. Regression test tetap wajib agar fitur yang dipakai ulang tidak rusak.
4. Dokumen arsitektur tetap harus menjelaskan desain baru dan dampaknya.

### 12.2 (dihapus — semua disetujui)

Semua keputusan produk D-001 s.d D-024 sudah disepakati product owner dan dicatat di §12.1. Tidak ada lagi rekomendasi proposed yang menunggu review.

### 12.3 Ringkasan decision register

| Kategori | Jumlah | ID |
|---|---|---|
| Keputusan disepakati | 24 | `D-001`–`D-024` |
| Rekomendasi proposed | 0 | — |
| Pertanyaan terbuka tanpa rekomendasi | 0 | — |

---

## 13. Traceability

### 13.1 Peta kebutuhan ke business rule, acceptance criteria, dan keputusan

| Kapabilitas | Functional requirements | Business rules | Acceptance criteria | Keputusan / OQ / NFR terkait |
|---|---|---|---|---|
| Tema, Aktivitas, Sesi | `FR-001`–`FR-012`, `FR-182` | `BR-001`–`BR-009`, `BR-070` | `AC-001`–`AC-005` | `D-003` [A], `D-007` [A], `D-009` [A] |
| Peserta dan custom field | `FR-013`–`FR-033` | `BR-010`–`BR-017` | `AC-006`–`AC-008`, `AC-042` | `D-003` [A], `D-008` [A] |
| Kategori dan entitlement | `FR-034`–`FR-045`, `FR-199` | `BR-018`–`BR-023`, `BR-075` | `AC-011`–`AC-014`, `AC-043` | `D-005` [A] |
| Impor CSV | `FR-046`–`FR-053`, `FR-197`, `FR-205` | `BR-061`–`BR-063`, `BR-076`, `BR-077` | `AC-009`, `AC-010`, `AC-042`, `AC-054` | `D-008` [A], `D-020` [A] |
| QR Identity dan ekspor | `FR-054`–`FR-065`, `FR-200` | `BR-024`–`BR-029` | `AC-015`–`AC-018` | `D-004` [A], `D-016` [A] |
| Attendance dan koreksi | `FR-066`–`FR-080`, `FR-201`–`FR-203` | `BR-030`–`BR-040`, `BR-072` | `AC-019`–`AC-023`, `AC-041`, `AC-045`, `AC-049` | `D-006` [A], `D-011` [A], `D-022` [A], `D-024` [A] |
| Distribusi konsumsi | `FR-081`–`FR-089` | `BR-041`–`BR-046`, `BR-073` | `AC-024`, `AC-025`, `AC-046` | `D-009` [A], `D-014` [A] |
| Lifecycle Aktivitas/Sesi | `FR-090`–`FR-096`, `FR-183`–`FR-188`, `FR-206` | `BR-047`–`BR-049`, `BR-071`, `BR-078` | `AC-004`, `AC-005`, `AC-044` | `D-010` [A], `OQ-033` [A] |
| Peran dan akses | `FR-097`–`FR-106`, `FR-194` | `BR-050`–`BR-053` | `AC-028`, `AC-031`, `AC-034`, `AC-049`, `AC-050`, `AC-055` | `D-018` [A], `D-022` [A], `D-024` [A], `OQ-034` [A] |
| Scanner/kiosk | `FR-107`–`FR-128`, `FR-189`–`FR-192` | `BR-054`–`BR-057`, `BR-072` | `AC-026`–`AC-028`, `AC-040`, `AC-048`, `AC-053` | `D-011` [A], `D-012` [A], `D-013` [A] |
| Dashboard dan navigasi | `FR-129`–`FR-134` | — | `AC-029`, `AC-030` | — |
| Audit | `FR-135`–`FR-140`, `FR-195`, `FR-207` | `BR-058`–`BR-060`, `BR-074`, `BR-079` | `AC-031`, `AC-047` | `D-023` [A], `NFR-023` [A], `FR-207` |
| Laporan dan ekspor | `FR-141`–`FR-149`, `FR-193` | `BR-059`, `BR-060` | `AC-032`, `AC-033`, `AC-051` | `D-015` [A], `D-017` [A] |
| UI dan desain | `FR-150`–`FR-161`, `FR-204` | — | `AC-039`, `AC-053` | `D-013` [A], `D-021` [A], `NFR-021` [A], `NFR-022` [A] |
| Integritas dan keamanan | `FR-162`–`FR-171` | `BR-064`–`BR-069` | `AC-034`–`AC-036`, `AC-047`, `AC-052` | `D-006` [A], `D-007` [A], `D-023` [A] |
| Kompatibilitas dan reuse | `FR-172`–`FR-178`, `FR-196`, `FR-198` | `BR-067`, `BR-068` | `AC-036`, `AC-037`, `AC-052` | `D-007` [A], `D-019` [A] |
| Dokumentasi | `FR-179`–`FR-181` | — | `AC-038` | `D-001` [A], `D-002` [A], `OQ-027` [A] |

### 13.2 Decision-to-OQ map

| Keputusan | Status | OQ terkait | Catatan |
|---|---|---|---|
| `D-001` | `[A]` | `OQ-023` | Ditutup |
| `D-002` | `[A]` | `OQ-024` | Ditutup |
| `D-003` | `[A]` | `OQ-001`–`OQ-004` | Ditutup |
| `D-004` | `[A]` | `OQ-032` | Ditutup |
| `D-005` | `[A]` | `OQ-005`–`OQ-007` | Ditutup |
| `D-006` | `[A]` | — | Perilaku koreksi; struktur data rinci diarahkan ke AQ-004 / ADR berikutnya |
| `D-007` | `[A]` | Bagian dari `OQ-001`, `OQ-002`, `OQ-004` | Tidak ada kewajiban migrasi data produksi |
| `D-008` | `[A]` | `OQ-008`, `OQ-009` | Ditutup |
| `D-009` | `[A]` | `OQ-010`, `OQ-013` | Ditutup |
| `D-010` | `[A]` | `OQ-011` | Ditutup |
| `D-011` | `[A]` | `OQ-012`, `OQ-013` | Ditutup; struktur data rinci diarahkan ke AQ-004 / ADR berikutnya |
| `D-012` | `[A]` | `OQ-014`, `OQ-016`, `OQ-018` | Ditutup |
| `D-013` | `[A]` | `OQ-015` | Ditutup |
| `D-014` | `[A]` | `OQ-017` | Ditutup |
| `D-015` | `[A]` | `OQ-019` | Ditutup |
| `D-016` | `[A]` | `OQ-020` | Ditutup |
| `D-017` | `[A]` | `OQ-021` | Ditutup |
| `D-018` | `[A]` | `OQ-022` | Ditutup |
| `D-019` | `[A]` | `OQ-026` | Ditutup |
| `D-020` | `[A]` | `OQ-028` | Ditutup |
| `D-021` | `[A]` | `OQ-029` | Ditutup |
| `D-022` | `[A]` | `OQ-030` | Ditutup |
| `D-023` | `[A]` | `OQ-031` | Ditutup |
| `D-024` | `[A]` | `OQ-025` | Ditutup |

### 13.3 Dokumen turunan dan status input

| Dokumen | Isi yang ditunggu | Status input |
|---|---|---|
| `docs/ARCHITECTURE.md` | Model domain, boundary, alur data, desain Tema → Aktivitas → Sesi | `D-003`–`D-007` [A] sudah tersedia; `D-009`–`D-017` [A] tersedia sebagai landasan desain; `OQ-027` [A] ditutup. |
| `docs/DECISIONS.md` + `docs/adr/` | Keputusan final atas semua pertanyaan produk | `D-001`–`D-024` [A] dapat dicatat; semua OQ produk ditutup. |
| `docs/IMPLEMENTATION_ROADMAP.md` | Urutan tahap dan gate, termasuk phasing CSV/XLSX | `D-015` [A] tersedia; fase lain mengikuti keputusan yang disetujui. |
| `.opencode/plans/` | Rencana eksekusi per tahap | Q1 tersedia dan sudah dieksekusi; Q2 menunggu pembukaan tahap di roadmap. |

---

## 14. Documentation Governance

1. Dokumen ini adalah sumber utama kebutuhan produk QRCek.
2. Kebutuhan target, baseline implementasi, dan delta harus tetap dipisahkan.
3. Dokumen ini tidak boleh diubah untuk menyesuaikan diri dengan implementasi tanpa keputusan product owner.
4. Setiap perubahan kebutuhan harus memperbarui ID terkait, acceptance criteria, dan traceability.
5. Keputusan arsitektur harus dicatat di `docs/DECISIONS.md` dan ADR individual, bukan di dokumen ini.
6. Rencana implementasi harus merujuk ke `FR-xxx`, `BR-xxx`, dan `AC-xxx`, bukan menyalin ulang isi dokumen ini.
7. Dokumen teknis lama yang masih relevan dipertahankan sebagai referensi dan tidak diduplikasi isinya.
8. Perubahan nama, lokasi, dan status dokumen harus dikoordinasikan dengan `AGENTS.md` (`D-001` [A]).
9. Dokumen ini tidak boleh mengklaim fitur selesai tanpa bukti implementasi dan pengujian.
10. Setiap tahap implementasi harus memiliki checkpoint review manusia sebelum tahap berikutnya.
11. Keputusan `[A]` tidak boleh dibuka kembali tanpa keputusan baru yang eksplisit.
12. Rekomendasi `[P]` tidak boleh diperlakukan sebagai keputusan final atau diimplementasikan sebagai requirement final sebelum disetujui product owner.
13. Pertanyaan `[O]` harus tetap terbuka sampai ada keputusan; implementasi tidak boleh memilih jawaban sendiri.
14. Tidak ada kewajiban migrasi data produksi; keputusan ini tidak mengurangi kewajiban regression testing dan validasi.
15. Baseline historis tidak boleh diubah untuk mencerminkan target baru; perubahan target dicatat di bagian delta dan decision register.

---

## 15. Change Log

| Versi | Tanggal | Perubahan |
|---|---|---|
| 0.1 | 3 November 2026 | Integrasi awal PRD QRCek ke `docs/REQUIREMENTS.md`; pemisahan target, baseline, delta, acceptance criteria, dan open questions; koreksi aturan koreksi transaksi menjadi Admin Acara saja. |
| 0.2 | 3 November 2026 | Revisi hasil review: menutup `OQ-023`/`OQ-024` sebagai `D-001`/`D-002`; memperbaiki diagram hierarki transaksi; menambah `OQ-032` tentang identitas QR; menyelaraskan lima keadaan hasil scanner untuk kehadiran dan konsumsi serta `AC-040`; mengoreksi referensi ADR historis; merekonsiliasi hitungan route (50 definisi, 87 pola efektif); menambah metadata jumlah baris. |
| 0.3 | 3 November 2026 | Revisi besar: menetapkan `D-003`–`D-007` (hierarki, QR scope, entitlement, Reversal/Adjustment, tanpa kewajiban migrasi data produksi); menambahkan `D-008`–`D-024` sebagai rekomendasi proposed yang belum disetujui; memisahkan Transaction Type, Transaction Source, dan Correction Operation; memperluas lifecycle, scanner, kuota konsumsi, audit, impor, laporan, QR PNG/ZIP, Google Sheets, registrasi Admin, identifier teknis, batas CSV, dan desain UI; memperbarui FR/BR/NFR/AC; menambah status `[A]`/`[P]`/`[O]`; mempertahankan `OQ-027` sebagai satu-satunya pertanyaan terbuka tanpa rekomendasi. |
| 0.3.1 | 3 November 2026 | Koreksi konsistensi: (1) pisahkan status operasional Sesi dari state arsip (FR-091, FR-093, FR-186, FR-206, BR-007, BR-071, BR-078, OQ-033); arsip Sesi menolak transaksi baru tetapi histori transaksi tetap utuh, dan kapan arsip boleh dilakukan belum ditetapkan; (2) audit field allowlist agar before/after tidak menyimpan PII dan kredensial (FR-136, FR-195, FR-207, BR-074, BR-079, NFR-006, AC-031, AC-047); (3) pisahkan prinsip Reversal/Adjustment yang disepakati (D-006 [A]) dari perilaku kuota Consumption yang proposed (D-014 [P], BR-073, AC-046); pemulihan kuota setelah Reversal Consumption tetap proposed; (4) selesaikan perilaku impor CSV tanpa External Reference (FR-052, D-008, BR-063, AC-009, AC-054): baris tanpa External Reference dianggap peserta baru dengan warning duplikat untuk review manual, tanpa merge otomatis; (5) izin Manual Check-in Super Admin tidak ditetapkan (FR-073, BR-034, AC-021, AC-049, AC-055, OQ-034); legacy permission `attendance:correct` tidak diinferensikan sebagai otorisasi target. |
| 0.3.2 | 4 November 2026 | Disetujui oleh product owner: semua keputusan proposed `D-008`–`D-024` diubah menjadi `[A]`; semua open question produk `OQ-008`–`OQ-034` ditutup; `D-024` dikoreksi dari `[P]` menjadi `[A]` (konsisten dengan `FR-077`, `FR-097`, dan §2.2); `OQ-027` ditutup (lokasi `COSTS_AND_LIMITS.md` tetap di root); `OQ-033` ditutup (arsip Sesi hanya dari Selesai/Dinonaktifkan, hanya Admin Acara); `OQ-034` ditutup (Super Admin tidak boleh Manual Check-in); NFR marker `NFR-021`/`NFR-022`/`NFR-023` diubah `[P]` → `[A]`. |
| 0.3.3 | 6 November 2026 | Penyelarasan fakta implementasi, tanpa perubahan kebutuhan maupun status keputusan: hitungan verifikasi menjadi 53 file test/525 tes, 61 definisi route/159 pola efektif (alias `/api/calendar` dan `/api/themes`), dan 7 migrasi (`0001`–`0007`); status dokumen turunan di §0.3 dan §13.3 diperbarui (Q1 selesai, rencana Q1 tersedia, ADR-0001–0015 tercatat). Kebutuhan produk, keputusan `D-xxx`, `OQ-xxx`, `FR`, `BR`, `NFR`, dan `AC` tidak diubah. |

