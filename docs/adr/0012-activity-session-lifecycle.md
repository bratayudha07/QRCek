# ADR-0012 — Tabel transisi lifecycle Aktivitas dan Sesi

| Atribut | Nilai |
|---|---|
| Status | **Diterima** — menetapkan detail `D-010` [A] untuk Q1 |
| Tanggal | 2026-11-04 |
| Menjawab | Tidak menjawab AQ. Menetapkan tabel edge yang tidak dirinci `REQUIREMENTS.md` untuk `FR-090`–`FR-096` |
| Terkait kebutuhan | `FR-090`–`FR-096`, `FR-183`–`FR-188`, `FR-206`; `BR-047`–`BR-049`, `BR-071`, `BR-078`; `D-010` [A], `OQ-033` [A] |
| Dampak | Menjadi sumber tunggal `packages/shared/src/lifecycle.ts` dan validasi `apps/api/src/domain/lifecycle.ts` di Q1 |

## Konteks

`REQUIREMENTS.md` menetapkan dua state machine yang terpisah (`FR-092`, `BR-047`) dan daftar status:

- Aktivitas: Draft, Aktif, Selesai, Diarsipkan (`FR-090`).
- Sesi: Terjadwal, Berlangsung, Selesai, Dinonaktifkan (`FR-091`), dengan arsip sebagai state administratif terpisah (`FR-206`, `BR-078`).

Dokumen juga menetapkan kombinasi yang harus ditolak (`BR-071`) dan syarat arsip Sesi (`OQ-033` [A]: hanya dari Selesai/Dinonaktifkan, hanya Admin Acara). Yang **belum** ditetapkan adalah edge transisi yang sah: apakah Draft boleh langsung diarsipkan, apakah status final boleh dibuka kembali, dan dari status mana Sesi boleh dinonaktifkan. Tanpa tabel ini, `domain/lifecycle.ts` tidak punya sumber dan implementasi akan memilih sendiri.

Baseline hanya memiliki lifecycle acara (`draft → active → closed → active|archived`, `packages/shared/src/events.ts`); lifecycle Aktivitas/Sesi adalah model baru.

## Opsi

1. **Linear ketat tanpa pembatalan.** `draft → active → completed → archived`; Sesi `scheduled → in_progress → completed → archived`. Sederhana, tetapi Aktivitas/Sesi yang dibuat salah tidak bisa dibuang dan tidak ada cara membatalkan Sesi.
2. **Linear + pembatalan eksplisit (rekomendasi).** Sama seperti opsi 1, ditambah `draft → archived` untuk Aktivitas dan `scheduled/in_progress → disabled` untuk Sesi. Tidak ada reopen; koreksi dilakukan dengan membuat atau menduplikasi entitas baru.
3. **Longgar dengan reopen.** Mengizinkan `completed → active` dan `disabled → scheduled`. Fleksibel, tetapi menyulitkan audit, membuat status historis berubah-ubah, dan tidak diminta `REQUIREMENTS.md`.

## Keputusan

**Opsi 2.** Alasan: menutup kesalahan input tanpa membuka kembali status yang sudah final; sesuai `OQ-033` [A]; audit tetap bermakna karena setiap perubahan status adalah edge eksplisit, bukan koreksi diam-diam.

### Transisi Aktivitas

| Dari | Ke | Syarat / efek samping |
|---|---|---|
| `draft` | `active` | Semua field wajib valid; `archived_at` tetap `NULL` |
| `draft` | `archived` | Membuang Aktivitas yang dibuat salah; `archived_at` diisi |
| `active` | `completed` | `archived_at` tetap `NULL` |
| `completed` | `archived` | `archived_at` diisi |
| `archived` | — | Final; tidak ada transisi keluar |

`active → archived` langsung **ditolak**; Aktivitas harus `completed` lebih dulu. `completed → active` (reopen) **ditolak**. `archived_at` dan status `archived` harus konsisten (ditegakkan CHECK database).

### Transisi Sesi

| Dari | Ke | Syarat / efek samping |
|---|---|---|
| `scheduled` | `in_progress` | Hanya lewat endpoint eksplisit; tidak pernah disimpulkan dari jam |
| `scheduled` | `disabled` | Membatalkan Sesi sebelum berjalan |
| `in_progress` | `completed` | `archived_at` tetap `NULL` |
| `in_progress` | `disabled` | Menghentikan Sesi yang sedang berjalan |
| `completed` | `archived` | `archived_at` diisi; hanya Admin Acara (`OQ-033` [A]) |
| `disabled` | `archived` | `archived_at` diisi; hanya Admin Acara (`OQ-033` [A]) |

Aturan tambahan:

- Status operasional Sesi **tidak** memiliki nilai `archived`; arsip adalah `archived_at` (`FR-091`, `FR-206`, `BR-078`).
- Setelah `archived_at` terisi, status operasional dan `archived_at` tidak boleh berubah (final). Tidak ada unarchive.
- `scheduled → completed` dan `in_progress → scheduled` ditolak.
- `completed → in_progress` dan `disabled → scheduled` ditolak (tidak ada reopen).
- Arsip Sesi tidak menghapus, membalik, atau menyembunyikan transaksi historis (`BR-007`, `BR-049`, `BR-078`).
- Transaksi hanya diterima pada Aktivitas `active` dan Sesi `in_progress` (`FR-183`, `FR-184`, `FR-186`); penegakan endpoint transaksi ada di Q5.
- Perubahan status memakai optimistic guard: `UPDATE ... WHERE id = ? AND status = ?`, sehingga dua perubahan paralel tidak saling menimpa. Audit hanya ditulis bila `changes = 1`.

### Duplikasi Sesi

Duplikasi (`FR-094`, `FR-095`, `BR-048`) membuat baris baru dengan:

- `id` baru, `activity_id` sama;
- nama, lokasi, `starts_at`, `ends_at` disalin;
- `status = 'scheduled'`, `archived_at = NULL`;
- tanpa transaksi dan tanpa riwayat audit lama.

## Konsekuensi

- `packages/shared/src/lifecycle.ts` memuat `ACTIVITY_TRANSITIONS` dan `SESSION_TRANSITIONS` sebagai konstanta beku; `apps/api/src/domain/lifecycle.ts` memvalidasi transisi dan konteks (Aktivitas milik Tema, Sesi milik Aktivitas).
- Tes `T-005` mengiterasi seluruh pasangan status (sah dan terlarang), bukan sampel. Menghapus satu edge dari tabel harus membuat tes gagal.
- Frontend kelak memakai tabel yang sama untuk menampilkan aksi yang tersedia; Worker tetap otoritatif.
- `archived_at` Aktivitas dan status `archived` konsisten lewat CHECK; Sesi memakai CHECK `archived_at IS NULL OR status IN ('completed','disabled')`.
- Tidak ada endpoint delete untuk Aktivitas/Sesi.

## Catatan implementasi

Tabel di atas adalah sumber tunggal untuk `packages/shared/src/lifecycle.ts`. Shim "satu Aktivitas default" **tidak** dibuat otomatis di Q1; penundaan ke Q5 dicatat di roadmap dan di ADR-0009.
