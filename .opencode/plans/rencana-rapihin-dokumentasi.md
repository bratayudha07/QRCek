# Rencana: Rapihin Dokumentasi Project Absensi

## Tujuan

Memastikan dokumentasi project sesuai struktur OpenCode dan aturan `AGENTS.md`, tanpa dokumen duplikat, dan semua file `.md` ada di tempat yang benar.

## Kondisi saat ini (terverifikasi)

File dokumentasi project yang ada:

**Root:**
- `AGENTS.md` — instruksi AI project (kanonik, tidak diubah)
- `IMPLEMENTATION_PLAN.md` — fase, kriteria penerimaan, status (kanonik, tidak diubah)
- `README.md` — panduan awal (kanonik, tidak diubah)
- `COSTS_AND_LIMITS.md` — batas free tier (kanonik, tidak diubah)
- `PLAN_TAB_PESERTA.md` — dokumen kerja Tahap 5.5 (dipertahankan)

**`docs/`:**
- `ARSITEKTUR.md` — arsitektur, ADR inline (kanonik, tidak diubah)
- `DESAIN_API.md` — desain API (kanonik, tidak diubah)
- `DESAIN_DATABASE.md` — desain database (kanonik, tidak diubah)
- `RENCANA_PENGUJIAN.md` — rencana pengujian (kanonik, tidak diubah)
- `OPERASIONAL.md` — operasional (kanonik, tidak diubah)
- `RISET_KOMPONEN_UI_OPENCODE.md` — riset komponen UI (kanonik, tidak diubah)

## Keputusan

Dokumentasi project **tidak diubah** — semua file sudah berada di lokasi yang benar sesuai `AGENTS.md` dan dokumentasi OpenCode.

Konfigurasi OpenCode (agent, skill, command, plan) dibuat di `.opencode/` untuk mendukung pekerjaan dokumentasi dan pengembangan project ini.

## Langkah selanjutnya (jika dibutuhkan di masa depan)

1. Jika pemilik proyek ingin memindahkan ADR dari `ARSITEKTUR.md` ke `docs/adr/` — buat rencana baru dan minta konfirmasi.
2. Jika pemilik proyek ingin menggabungkan `PLAN_TAB_PESERTA.md` ke `IMPLEMENTATION_PLAN.md` — buat rencana baru dan minta konfirmasi (menghapus file `.md` butuh konfirmasi).
3. Setiap perubahan skema = file migrasi baru + catatan di `docs/DESAIN_DATABASE.md`.

## Status

✅ Rencana disetujui — konfigurasi `.opencode/` telah dibuat. Dokumentasi project tidak diubah.
