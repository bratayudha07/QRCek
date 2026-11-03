# ADR-0003 — QR peserta: token opaque, hash di server

| Atribut | Nilai |
|---|---|
| Status | **Diterima** untuk bentuk token. **Cakupan (scope) perlu diperbarui** mengikuti `D-004` [A] — lihat AQ-009 di [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §6. |
| Asal | `docs/ARSITEKTUR.md` ADR-003 (diekstrak 3 November 2026 tanpa perubahan keputusan) |
| Terkait kebutuhan | `FR-054`–`FR-062`, `FR-168`, `NFR-007`, `NG-06` di [`../REQUIREMENTS.md`](../REQUIREMENTS.md) |
| Menutup | Keputusan terbuka lama `AGENTS.md` #1 ("bentuk token QR") |

## Konteks

QR dicetak di kartu peserta dan dipindai kamera HP. QR bisa difoto orang lain, harus bisa dicabut/dirotasi tanpa mengubah data peserta, dan harus tetap terbaca saat dicetak kecil.

## Opsi

1. **Payload berisi data + HMAC/tanda tangan.** Bisa diverifikasi tanpa lookup, tetapi memuat data (risiko PII), sulit dicabut tanpa daftar hitam, dan QR lebih besar.
2. **Token acak opaque yang di-lookup di DB.**

## Keputusan

Opsi 2. QR berisi `absensi:v1:<base64url(256-bit random)>`. D1 menyimpan `HMAC-SHA256(QR_PEPPER, token)` dengan indeks unik. Penyimpanan ciphertext untuk cetak ulang diatur ADR-0006.

## Konsekuensi

- Tidak ada PII di QR; foto QR tidak membocorkan data.
- Rotasi/pencabutan cukup mengganti satu baris kredensial.
- QR tetap kecil sehingga mudah dipindai kamera HP murah.
- Pemindaian **butuh jaringan** (lookup DB). Tidak ada mode offline — selaras `NG-06` dan `FR-122`.

## Catatan terhadap target QRCek

- Baseline menerbitkan kredensial per baris `participants`, yang terikat satu `event_id`. Target `D-004` [A]: **satu QR Identity per Tema Acara + Peserta**, dipakai di semua Aktivitas/Sesi dalam Tema itu. Bentuk token (ADR ini) tetap; yang berubah adalah entitas pemilik kredensial — bergantung AQ-001 dan AQ-009.
- Prefix `absensi:v1:` dipertahankan menurut rekomendasi `D-019` [P]; QR yang sudah tercetak bergantung padanya.
- Rotasi token per peserta (token lama langsung tidak berlaku, `FR-059`/`AC-016`) belum ditemukan sebagai route di baseline; yang ada adalah rotasi kunci enkripsi (ADR-0006). Lihat roadmap Q4.
