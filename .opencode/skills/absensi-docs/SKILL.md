---
name: absensi-docs
description: Mengelola dokumentasi QRCek (AGENTS.md, README.md, docs/REQUIREMENTS.md, DECISIONS.md, adr/, ARCHITECTURE.md, IMPLEMENTATION_ROADMAP.md, DESAIN_*, RENCANA_PENGUJIAN.md, OPERASIONAL.md, COSTS_AND_LIMITS.md). Pakai saat menambah/mengubah dokumen, mencatat keputusan atau ADR, membuka/menutup tahap roadmap, atau memperbarui dokumen setelah perubahan kode, endpoint, atau skema.
compatibility: opencode
metadata:
  product: qrcek
  language: id
---

# absensi-docs

Menjaga dokumentasi QRCek konsisten dengan `docs/REQUIREMENTS.md` sebagai sumber kebutuhan, tanpa duplikat dan tanpa klaim yang tidak terbukti.

## Hierarki sumber kebenaran

| Pertanyaan | Dokumen |
|---|---|
| Apa yang harus dibangun? | `docs/REQUIREMENTS.md` (Target §4–§6, §9) |
| Apa yang sudah ada? | `docs/REQUIREMENTS.md` §7 (Baseline) + kode |
| Apa selisihnya? | `docs/REQUIREMENTS.md` §8 (Delta) |
| Keputusan apa yang berlaku? | `docs/DECISIONS.md` → `REQUIREMENTS.md` §12 dan `docs/adr/` |
| Bagaimana sistemnya dirancang? | `docs/ARCHITECTURE.md` |
| Urutan kerja dan tahap yang dibuka? | `docs/IMPLEMENTATION_ROADMAP.md` |
| Kontrak/skema/tes/operasi aktual? | `docs/DESAIN_API.md`, `docs/DESAIN_DATABASE.md`, `docs/RENCANA_PENGUJIAN.md`, `docs/OPERASIONAL.md` |
| Batas free tier? | `COSTS_AND_LIMITS.md` (root; lokasi final `OQ-027` [O]) |

Arsip (riwayat saja): `IMPLEMENTATION_PLAN.md`, `PLAN_TAB_PESERTA.md`, `docs/RISET_KOMPONEN_UI_OPENCODE.md`.

## Aturan

1. `docs/REQUIREMENTS.md` hanya diubah product owner. Agent tidak mengubah kebutuhan, ID, atau status `[A]`/`[P]`/`[O]`.
2. `[P]` tidak ditulis sebagai keputusan final; `[O]` dan `AQ-xxx` tidak dijawab di dokumen tanpa keputusan pemilik proyek.
3. Pisahkan Target / Baseline / Delta. Endpoint yang ada ≠ fitur selesai (`FR-178`).
4. Rujuk ID (`FR-`, `BR-`, `AC-`, `D-`, `OQ-`, `AQ-`, `ADR-`); jangan menyalin isi `REQUIREMENTS.md`.
5. Tidak ada dokumen duplikat; nama kanonik ada di `AGENTS.md` §Dokumentasi.
6. Jangan menghapus file `.md` tanpa konfirmasi; jangan memindahkan `COSTS_AND_LIMITS.md`.

## Pemicu pembaruan

| Perubahan | Dokumen yang wajib diperbarui |
|---|---|
| Route ditambah/diubah | `docs/DESAIN_API.md` (+ `docs/ARCHITECTURE.md` bila boundary berubah) |
| Migrasi baru | `docs/DESAIN_DATABASE.md` (+ anggaran di `COSTS_AND_LIMITS.md` bila menambah indeks/tabel besar) |
| Tes wajib/aturan integritas berubah | `docs/RENCANA_PENGUJIAN.md` |
| Keputusan arsitektur baru | `docs/adr/NNNN-*.md` + `docs/DECISIONS.md` §3/§4 + `docs/ARCHITECTURE.md` §2/§6 |
| Product owner mengubah `REQUIREMENTS.md` | `docs/DECISIONS.md` §2 → gate di `docs/IMPLEMENTATION_ROADMAP.md` → ADR terdampak |
| Tahap dibuka/ditutup | `docs/IMPLEMENTATION_ROADMAP.md` + rencana di `.opencode/plans/` |
| Hasil ukur/deploy/prosedur | `docs/OPERASIONAL.md` |

## Langkah

1. Baca `AGENTS.md`, lalu bagian `REQUIREMENTS.md` yang relevan.
2. Tentukan dokumen terdampak dari tabel pemicu.
3. Perbarui dengan fakta yang bisa diverifikasi (kode, tes, perintah). Tandai yang belum terverifikasi.
4. Cek rujukan lama: `docs/ARSITEKTUR.md` → `docs/ARCHITECTURE.md`; "ADR-00N" → `docs/adr/000N-*.md`.
5. Laporkan file yang diubah, alasan per file, dan kontradiksi yang butuh keputusan.
