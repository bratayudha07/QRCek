# ADR-0002 — Autentikasi passwordless berbasis token

| Atribut | Nilai |
|---|---|
| Status | **Diterima** — diterapkan sejak Tahap 2; menggantikan aturan PBKDF2 lama di `AGENTS.md` |
| Asal | `docs/ARSITEKTUR.md` ADR-002 (diekstrak 3 November 2026 tanpa perubahan keputusan) |
| Terkait kebutuhan | `NFR-002`, `NFR-003`, `NFR-004`, `NFR-010` di [`../REQUIREMENTS.md`](../REQUIREMENTS.md) |
| Dampak keputusan produk QRCek | Nama cookie `absensi_session` dan header `X-Absensi-Csrf` dipertahankan menurut rekomendasi `D-019` [P]. Alur pendaftaran Admin Acara ditinjau oleh `D-018` [P] (lihat ADR-0007), bukan oleh ADR ini. |

## Konteks

Workers Free memberi **10 ms CPU per request**. PBKDF2-SHA256 pada jumlah iterasi yang layak (ratusan ribu) memakan CPU puluhan hingga ratusan milidetik, sehingga login akan gagal dengan error 1102. Menurunkan iterasi sampai muat 10 ms membuat hash praktis tidak berguna. Sistem sudah memiliki kanal undangan QR untuk petugas, sehingga password tidak diperlukan.

## Opsi

| Opsi | Masalah |
|---|---|
| Password + KDF dengan iterasi rendah | Hash cepat ditebak; keamanan hilang |
| Workers Paid | Melanggar aturan "tidak ada layanan berbayar" |
| SaaS auth / OAuth Google | Layanan pihak ketiga; petugas lapangan sering tanpa akun Google |
| **Passwordless berbasis token berentropi tinggi** | Tidak ada "lupa password" via email |

## Keputusan

Passwordless. Semua kredensial dibuat dari `crypto.getRandomValues`, dan D1 hanya menyimpan `HMAC-SHA256(SESSION_PEPPER, token)`.

| Kredensial | Entropi | Penyimpanan |
|---|---|---|
| Token aktivasi (QR undangan) | 128-bit acak, sekali pakai, kedaluwarsa | `HMAC-SHA256(pepper, token)` |
| Kredensial perangkat | 256-bit acak, per perangkat | `HMAC-SHA256(pepper, token)` |
| Kode pemulihan | **100-bit** acak (5×4 Crockford), sekali pakai, ditampilkan sekali | `HMAC-SHA256(pepper, kode normalized)` |
| Sesi | 256-bit acak, cookie `HttpOnly` | `HMAC-SHA256(pepper, token)` |

> **Koreksi angka historis**: dokumen awal mengklaim kode pemulihan 128-bit. Format yang dipilih (5 grup × 4 simbol Crockford = 20 simbol = 100 bit) tidak mencapai itu. 100 bit tetap jauh di atas ambang praktis untuk kode sekali pakai yang dibatasi 5 percobaan per 15 menit.

Karena entropi sumbernya tinggi, hash cepat (HMAC) sudah memadai; serangan kamus tidak berlaku. Tidak ada KDF mahal dan tidak ada CPU spike.

Aturan turunan (mengikat, tercantum juga di `AGENTS.md`):

- Cookie `absensi_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` 30 hari (sliding), `Secure` saat HTTPS.
- Semua request non-GET wajib `X-Absensi-Csrf: 1` **dan** `Origin` cocok dengan host; dicek sebelum routing.
- Rate limit login/aktivasi/pemulihan dari tabel D1 per IP-hash.

Implementasi: `apps/api/src/domain/token.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/http/cookies.ts`, `apps/api/src/http/security.ts`.

## Konsekuensi

- Tidak ada "lupa password" mandiri via email (email transaksional = layanan pihak ketiga). Pemulihan memakai kode pemulihan atau undangan baru dari admin.
- Superadmin yang kehilangan akses memakai prosedur break-glass (`docs/OPERASIONAL.md`).
- Perubahan arah auth (menurunkan entropi, memperpanjang masa berlaku, menonaktifkan CSRF, kembali ke password) wajib lewat ADR baru, bukan edit diam-diam.
