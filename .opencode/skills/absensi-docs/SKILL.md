# absensi-docs

Skill untuk mengelola dokumentasi project Absensi Acara sesuai struktur OpenCode dan aturan `AGENTS.md`.

## Tujuan

Memastikan dokumentasi project (root `.md` dan `docs/*`) konsisten, tidak ada duplikat, dan selalu diperbarui saat ada perubahan kode/skema/endpoint.

## File yang dikelola

| Lokasi | Tujuan |
|--------|--------|
| `AGENTS.md` | Instruksi AI project (kanonik) |
| `IMPLEMENTATION_PLAN.md` | Fase, kriteria penerimaan, status |
| `README.md` | Panduan awal (apa ini, cara jalan lokal, cara deploy) |
| `COSTS_AND_LIMITS.md` | Batas free tier terverifikasi |
| `docs/ARSITEKTUR.md` | Diagram alur, boundary, model data, keputusan arsitektur |
| `docs/DESAIN_API.md` | Tabel endpoint (method, path, peran, ringkas) |
| `docs/DESAIN_DATABASE.md` | Skema, indeks, strategi migrasi, kebijakan retensi |
| `docs/RENCANA_PENGUJIAN.md` | Daftar tes wajib dan gerbang kualitas |
| `docs/OPERASIONAL.md` | Hasil spike, quirk lingkungan, item belum terverifikasi |

## Aturan yang wajib dipatuh

1. **Tidak ada dokumen duplikat** — jangan buat `architecture.md`, `api.md`, dll. Gunakan nama kanonik di atas.
2. **Setiap perubahan skema** = file migrasi baru di `migrations/` + catatan di `docs/DESAIN_DATABASE.md`. Jangan pernah edit migrasi yang sudah dijalankan.
3. **Setiap perubahan boundary/endpoint** = perbarui `docs/ARSITEKTUR.md` dan `docs/DESAIN_API.md`.
4. **Setiap fase dibuka/ditutup** = perbarui `IMPLEMENTATION_PLAN.md`.
5. **Setiap angka platform berubah** = perbarui `COSTS_AND_LIMITS.md`.
6. **Jangan menghapus file `.md`** tanpa konfirmasi pemilik proyek.

## Langkah penggunaan

1. Baca `AGENTS.md` sampai habis sebelum menyentuh dokumentasi.
2. Identifikasi file `.md` mana yang terpengaruh oleh perubahan.
3. Perbarui file tersebut dengan informasi yang akurat.
4. Verifikasi tidak ada duplikat nama dokumen.
5. Laporkan file yang diubah ke pengguna.
