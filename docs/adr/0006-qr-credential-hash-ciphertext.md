# ADR-0006 — Kredensial QR: hash untuk lookup + ciphertext untuk cetak ulang

| Atribut | Nilai |
|---|---|
| Status | **Diterima** — diterapkan di Tahap 4 (`migrations/0004_qr.sql`, `apps/api/src/domain/qr-token.ts`). Cakupan pemilik kredensial mengikuti `D-004` [A] (lihat ADR-0003). |
| Asal | `docs/ARSITEKTUR.md` ADR-006 (diekstrak 3 November 2026 tanpa perubahan keputusan) |
| Terkait kebutuhan | `NFR-008`, `FR-063`–`FR-065`, `FR-200` di [`../REQUIREMENTS.md`](../REQUIREMENTS.md) |

## Konteks

Hash (ADR-0003) tidak bisa dibalik. Tanpa penyimpanan lain, setiap cetak ulang terpaksa merotasi token dan membatalkan kartu yang sudah tercetak. Plaintext token tidak boleh disimpan di D1.

## Opsi

1. Rotasi token setiap cetak ulang — membatalkan kartu tercetak.
2. Simpan token plaintext — dilarang.
3. **Hash untuk lookup + ciphertext AES-256-GCM untuk memulihkan token yang sama.**

## Keputusan

Opsi 3. Token peserta 32 byte acak (256 bit). Dua secret dengan tugas terpisah:

| Secret | Fungsi | Efek jika berubah |
|---|---|---|
| `QR_PEPPER` | `HMAC-SHA256` → `qr_token_hash` (43 karakter), yang dicari saat scan | Semua QR tercetak berhenti valid |
| `QR_ENCRYPTION_KEY` | AES-256-GCM → `qr_token_ciphertext` (79 karakter) + `qr_token_nonce` (16 karakter) | Cetak ulang gagal sampai kunci versi itu tersedia |

- **Kenapa dua secret**: memisahkan pepper dari kunci enkripsi berarti merotasi salah satunya tidak memaksa merotasi yang lain.
- **Kenapa bukan payload bertanda tangan**: sama seperti ADR-0003 — QR tanpa PII, lookup tetap satu indeks unik, dan penerbitan terjadi di server yang sama dengan verifikasi.
- **Versi kunci**: `qr_key_version` disimpan per baris. Dekripsi dengan versi berbeda **gagal keras** (tidak ada fallback plaintext). Rotasi kunci = dekripsi dengan kunci lama, enkripsi ulang dengan kunci baru; hash dan token tidak berubah sehingga QR tercetak tetap sah. Prosedur: `docs/OPERASIONAL.md` §7.5.
- **Cetak ulang**: kredensial dibuat hanya saat `qr_token_hash IS NULL`; `UPDATE ... WHERE qr_token_hash IS NULL` membuat dua permintaan yang balapan menghasilkan satu pemenang. Mencetak ulang **tidak pernah** merotasi token.

## Konsekuensi

- Setiap cetak ulang melakukan dekripsi AES-GCM per label. Batch dibatasi 50 label/request (`QR_LABEL_BATCH_MAX`) setelah pengukuran menunjukkan 100 label melewati budget CPU ±10 ms.
- Ekspor PNG/ZIP target (`FR-063`/`FR-064`, rekomendasi `D-016` [P]) dapat memakai jalur dekripsi yang sama: backend mengotorisasi dan mengembalikan payload; browser merender. Batas batch ini tetap berlaku.
- Rotasi kunci enkripsi berbeda dari rotasi token per peserta (`FR-059`); yang kedua mengganti hash dan ciphertext sekaligus dan harus tercatat di audit (`FR-062`).
