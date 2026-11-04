# ADR-0011 — Mekanisme allowlist audit field

| Atribut | Nilai |
|---|---|
| Status | **Diterima** — jawaban AQ-014, disetujui pemilik proyek 4 November 2026 |
| Terkait AQ | AQ-014 (`docs/ARCHITECTURE.md` §6) |
| Terkait kebutuhan | `FR-135`, `FR-207`, `D-023` [A], `NFR-006` |
| Dampak keputusan produk QRCek | Struktur audit sejak Q1 |

## Konteks

Audit log append-only (ADR-0008). Mutasi baru diperlukan sejak Q1 (Tema/Aktivitas/Sesi). Field allowlist menghindari penyimpanan PII/secrets. Audit baseline menyimpan snapshot before/after. Perlu menetapkan mana field yang boleh dicatat dan bagaimana menandai field sensitif.

## Opsi

1. **Allowlist konstanta di `packages/shared` per tipe objek.** Setiap entitas punya set field yang diizinkan; audit helper (`db/audit.ts`) menyaring before/after sesuai allowlist. Field sensitif dicatat "berubah" tanpa nilai (mecanisme placeholder `[REDACTED]`).
2. **Allowlist dinamis dari skema DB.** D1 `PRAGMA table_info` memutuskan field. Lebih fleksibel tapi rentan dan mahal (query ekstra).
3. **Snapshot lengkap (baseline aktual).** Tidak memenuhi `FR-207`.

## Rekomendasi (status usulan)

Opsi 1. Allowlist per tipe objek di `packages/shared/src/audit-allowlist.ts` (pure TS), diverifikasi oleh unit test, dipakai `db/audit.ts`. Field sensitif (token hash/ciphertext, password, PII dinamis) ditandai `REDACTED` di before/after, log hanya "berubah". Migrasi baseline audit tetap memakai helper baru; data lama tidak diubah.

## Konsekuensi (bila adopsi Opsi 1)

- Audit tetap append-only; before/after hanya menyimpan field allowlisted.
- Tes integritas audit (T-062…T-067) disesuaikan; UAT: token/secret/PII tidak muncul.
- Penambahan mutasi baru di Q2+ memerlukan update allowlist + review sebelum deploy.

## Catatan implementasi

ADR ini diterima. Implementasi Q1: `packages/shared/src/audit-allowlist.ts`, dipakai `routes/events.ts`, `routes/activities.ts`, dan `routes/activity-sessions.ts`.
