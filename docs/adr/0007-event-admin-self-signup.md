# ADR-0007 — Pendaftaran mandiri admin acara: akun ber-scope nol

| Atribut | Nilai |
|---|---|
| Status | **Diterima (baseline berjalan). Ditinjau ulang** oleh `D-018` [A], yang merekomendasikan menonaktifkan pendaftaran mandiri publik dan memakai undangan Super Admin. |
| Asal | `docs/ARSITEKTUR.md` ADR-007 (diekstrak 3 November 2026 tanpa perubahan keputusan) |
| Terkait kebutuhan | `FR-194`, `AC-050`, `OQ-022` di [`../REQUIREMENTS.md`](../REQUIREMENTS.md) |

> **Aturan untuk agent**: jangan menghapus atau menonaktifkan `POST /api/auth/register` sebelum product owner menyetujui `D-018`. Bila disetujui, tulis ADR baru yang **menggantikan** ADR ini; jangan mengedit keputusan di bawah.

## Konteks

Sampai Tahap 6 satu-satunya jalur membuat akun adalah undangan dari superadmin (ADR-0002), sehingga setiap pengguna baru bergantung pada satu operator. Sistem tidak punya verifikasi email, jadi identitas tidak bisa dibuktikan — yang bisa dijamin hanya **batas akses**.

## Opsi

1. **Superadmin tunggal + undangan** — aman, tetapi menjadi hambatan operasional.
2. **Pendaftaran bebas dengan peran penuh** — satu akun palsu bisa membaca semua acara. Ditolak.
3. **Pendaftaran bebas dengan cakupan nol** — akun baru berperan `event_admin` tanpa keanggotaan; hanya bisa membuat acara baru dan otomatis menjadi admin acara itu. **Dipilih.**

## Keputusan

- `POST /api/auth/register` publik, hanya butuh `displayName`. Peran **selalu** `event_admin`; field `role` dari klien ditolak skema `.strict()`.
- `event:create` boleh diberikan oleh `users.role` saja (`MIN_GLOBAL_ROLE`), tanpa keanggotaan. Aksi lain tetap mensyaratkan keanggotaan acara. `event:delete` tetap superadmin-only; penghapusan diganti status `archived`.
- Pembuatan acara menulis baris acara **dan** keanggotaan pemilik dalam satu `db.batch()`.
- Registrasi menerbitkan sesi dan kode pemulihan sekali tampil, sama seperti aktivasi.
- Dua gerbang penyalahgunaan server-side: rate limit D1 per IP-hash (5 pendaftaran/jam) dan Cloudflare Turnstile (gratis) bila `TURNSTILE_SECRET_KEY` diisi. Turnstile **fail-closed**; bila secret kosong, rate limit D1 tetap berjalan.
- `users.created_via` mencatat `seed` / `invite` / `self_signup` (`migrations/0006_self_signup.sql`).

## Konsekuensi

- Tidak perlu superadmin untuk operasi normal; superadmin tetap ada untuk break-glass dan tindakan lintas acara.
- Akun palsu hanya menghasilkan data miliknya sendiri, bukan kebocoran acara lain.
- Tidak ada verifikasi identitas; nama tampilan tidak unik.
- Kode pemulihan menjadi satu-satunya jalan masuk kembali.
