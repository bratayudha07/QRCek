# ADR-0013 — Menonaktifkan pendaftaran Admin Acara mandiri

| Atribut | Nilai |
|---|---|
| Status | **Diterima** — disetujui pemilik proyek 4 November 2026 |
| Tanggal | 2026-11-04 |
| Menggantikan | [ADR-0007](./0007-event-admin-self-signup.md) |
| Terkait kebutuhan | `FR-194`, `AC-050`; `D-018` [A], `D-007` [A] |
| Dampak | Menghapus `POST /api/auth/register`, UI pendaftaran, integrasi Turnstile, dan secret/konfigurasi terkait |

## Konteks

Baseline mengizinkan pendaftaran Admin Acara secara mandiri lewat `POST /api/auth/register` (ADR-0007). Endpoint ini publik, membuat akun `event_admin` tanpa keanggotaan Tema, lalu mengembalikan cookie sesi dan kode pemulihan. Dua gerbang penyalahgunaan yang terpasang: rate limit D1 5 pendaftaran/jam per IP-hash dan Cloudflare Turnstile yang fail-closed bila `TURNSTILE_SECRET_KEY` diisi.

`D-018` [A] kemudian menetapkan bahwa pendaftaran Admin Acara hanya melalui undangan Super Admin dan pendaftaran mandiri publik harus dinonaktifkan. ADR-0007 sendiri mewajibkan ADR baru yang **menggantikan** ADR ini sebelum kode pendaftaran dihapus atau dinonaktifkan; ADR-0007 tidak boleh diedit.

Tidak ada data produksi yang perlu dimigrasikan (`D-007` [A]). Baris `users` historis dengan `created_via = 'self_signup'` tetap valid dan tidak diubah.

## Opsi

1. **Hapus endpoint dan seluruh jalur pendaftaran (rekomendasi).** `POST /api/auth/register` dihapus dari tabel route → 404. UI `/daftar`, `registerAccount`, widget Turnstile, integrasi server, dan secret terkait dihapus. Permukaan publik berkurang dan tidak ada kode mati.
2. **Pertahankan endpoint tetapi selalu tolak.** Endpoint tetap publik dan mengembalikan `403 REGISTRATION_CLOSED`, bisa dihidupkan lewat env flag. Mudah di-rollback, tetapi tetap ada permukaan publik, tes harus merawat jalur mati, dan rawan salah konfigurasi.
3. **Tunda.** Tidak menyentuh Q1. Melanggar `D-018` [A] dan cakupan `FR-194`; celah dibiarkan lebih lama.

## Keputusan

**Opsi 1.** Alasan: `D-018` sudah disepakati, tidak ada pengguna produksi, dan menghapus jalur lebih jujur daripada mempertahankan endpoint yang tidak boleh dipakai. Riwayat git tetap menyimpan implementasinya bila kelak dibutuhkan.

Rincian yang disetujui:

- `POST /api/auth/register` dihapus dari `authRoutes`; request menjadi **404**. Route publik yang tersisa tepat 4: `health`, `health/ready`, `auth/activate`, `auth/recover`.
- Handler `register` di `apps/api/src/routes/auth.ts` dihapus, termasuk pemakaian rate limit dan Turnstile khusus registrasi.
- `RegisterRequestSchema` dan `turnstileToken` dihapus dari `packages/shared`; `TURNSTILE_FAILED` dihapus dari result code.
- Integrasi Turnstile dihapus seluruhnya karena satu-satunya pemakainya adalah registrasi:
  - `apps/api/src/integrations/turnstile.ts` dan `turnstile.test.ts`;
  - `apps/web/src/components/turnstile-widget.tsx`;
  - `TURNSTILE_SECRET_KEY` dan `VITE_TURNSTILE_SITE_KEY` dari contoh env, README, `AGENTS.md`, `OPERASIONAL.md`, command deploy, dan agent `security-reviewer`.
- UI pendaftaran dihapus: `pages/register.tsx`, route `/daftar`, tautan di halaman login, dan `registerAccount` di `lib/auth.ts`.
- `created_via = 'self_signup'` tetap ada di skema dan data historis; migrasi `0006_self_signup.sql` tidak diedit dan tidak ada migrasi baru.
- Izin `event:create` untuk `event_admin` **tidak berubah**: Admin Acara yang masuk lewat undangan tetap boleh membuat Tema baru dan menjadi pemiliknya.
- Jalur masuk Admin Acara yang tersisa: Super Admin membuat undangan (`POST /api/events/:eventId/invites`) dan calon admin mengaktivasinya lewat `/aktivasi`.

## Konsekuensi

- `AC-050` menjadi dapat diuji: admin hanya lahir dari undangan; pencabutan akses mencabut sesi.
- `auth.register.test.ts` diganti tes “route 404 dan tidak menulis user”; `turnstile.test.ts` dihapus; `authz.unauthenticated.test.ts` diperbarui ke 4 route publik; fixture tes yang memakai registrasi diganti alur undangan.
- `RENCANA_PENGUJIAN.md` I-29…I-33 dihapus/diganti; daftar route publik diperbarui.
- `DESAIN_API.md` menghapus endpoint registrasi; `README.md` dan `OPERASIONAL.md` menghapus prosedur Turnstile dan mencatat `wrangler secret delete TURNSTILE_SECRET_KEY` saat deploy berikutnya.
- `REQUIREMENTS.md` §7.2.4 tetap baseline historis; perubahan target dicatat product owner di bagian delta.
- Endpoint `/api/auth/recover` dan `/api/auth/activate` tetap tanpa Turnstile; perlindungannya tetap rate limit D1 dan validasi token.
- Menghapus Turnstile berarti tidak ada perlindungan bot di endpoint publik yang tersisa. Untuk rilis awal ini diterima karena endpoint publik hanya aktivasi token dan pemulihan kode, keduanya berentropi tinggi dan dibatasi rate limit. Bila kelak ada formulir publik baru, Turnstile dapat ditambahkan kembali lewat ADR baru.

## Status penggantian

ADR ini **menggantikan** [ADR-0007](./0007-event-admin-self-signup.md). ADR-0007 ditandai **Digantikan oleh ADR-0013** dan tidak diedit lebih lanjut.
