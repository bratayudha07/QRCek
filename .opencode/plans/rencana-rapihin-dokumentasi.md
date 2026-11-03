# Rencana Q0 — Penyelarasan dokumentasi dengan REQUIREMENTS.md

> Tahap: **Q0** di `docs/IMPLEMENTATION_ROADMAP.md`. Dasar: `docs/REQUIREMENTS.md` v0.3.1, `D-001` dan `D-002` [A].
> Rencana sebelumnya di file ini (1–2 November 2026: "dokumentasi tidak diubah") sudah tidak berlaku karena produk diarahkan ulang ke QRCek.

## Tujuan

Semua dokumen dan konfigurasi yang dibaca agent AI menunjuk struktur dokumen baru dan konsisten dengan `REQUIREMENTS.md`: target, baseline, dan delta terpisah; keputusan `[P]`/`[O]` tidak diperlakukan sebagai final.

## Yang dikerjakan (3 November 2026)

| # | Pekerjaan | Hasil |
|---|---|---|
| 1 | `docs/ARSITEKTUR.md` → `docs/ARCHITECTURE.md`, diselaraskan dengan model target dan AQ | Selesai |
| 2 | ADR-001…008 diekstrak ke `docs/adr/0001`–`0008` (keputusan tidak diubah; catatan dampak QRCek ditambahkan) | Selesai |
| 3 | `docs/DECISIONS.md` dibuat (indeks D-xxx, OQ `[O]`, ADR, AQ-001…014) | Selesai |
| 4 | `docs/IMPLEMENTATION_ROADMAP.md` dibuat (Q0–Q11 + evaluasi `PLAN_TAB_PESERTA.md`) | Selesai |
| 5 | `AGENTS.md` ditulis ulang: QRCek, urutan baca, status keputusan, model domain, aturan integritas per transaksi efektif, tabel dokumen kanonik | Selesai |
| 6 | `README.md`: nama QRCek, status baseline vs target, tabel dokumen | Selesai |
| 7 | `DESAIN_API.md`, `DESAIN_DATABASE.md`, `OPERASIONAL.md`, `COSTS_AND_LIMITS.md`: banner baseline/target, penanda Delta, rujukan ADR baru | Selesai |
| 8 | `RENCANA_PENGUJIAN.md` §9: tes wajib model target (T-001…T-144) | Selesai |
| 9 | `IMPLEMENTATION_PLAN.md` dan `PLAN_TAB_PESERTA.md` diberi banner arsip (isi tidak dihapus) | Selesai |
| 10 | `.opencode/` (agents, commands, skill, rencana ini) diselaraskan; frontmatter mengikuti format OpenCode | Selesai |

## Sengaja tidak dikerjakan

- `docs/REQUIREMENTS.md` tidak diubah (hanya product owner). §0.3 dan §13.3 di sana masih menyebut dokumen turunan "belum dibuat" — perlu diperbarui product owner.
- `COSTS_AND_LIMITS.md` tidak dipindah (`OQ-027` [O]).
- Tidak ada file `.md` yang dihapus. `docs/ARSITEKTUR.md` dipindah (rename) menjadi `docs/ARCHITECTURE.md` sesuai `FR-180`.
- Komentar di `migrations/0004_qr.sql` yang merujuk `docs/ARSITEKTUR.md` tidak diedit (migrasi yang sudah dijalankan tidak boleh diubah); pemetaan rujukan ada di `docs/DECISIONS.md` §5.
- Tidak ada perubahan kode atau skema.

## Gate menuju Q1 (menunggu pemilik proyek)

Lihat `docs/IMPLEMENTATION_ROADMAP.md` §4 Q0: review product owner, keputusan `D-009`/`D-023` (dan `D-018` bila masuk Q1), serta ADR untuk AQ-001, AQ-010, AQ-014.
