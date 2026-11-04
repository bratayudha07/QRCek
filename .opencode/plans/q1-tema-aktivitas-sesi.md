# Rencana Q1 — Fondasi Tema → Aktivitas → Sesi (Draf eksekusi)

> **Tahap:** Q1 di `docs/IMPLEMENTATION_ROADMAP.md` (saat ini "Belum dibuka").
> **Aturan:** Jangan eksekusi sampai semua gate Q0 terpenuhi dan ADR-0009/0010/0011 berstatus Diterima, serta roadmap diubah statusnya menjadi "Dibuka" oleh pemilik proyek.
> **PRD:** `docs/REQUIREMENTS.md`. Kebutuhan: `FR-001`..`FR-012`, `FR-090`..`FR-098`, `FR-182`, `FR-194`, `FR-206`; `BR-001`, `BR-003`..`BR-009`, `BR-047`..`BR-049`, `BR-070`, `BR-078`; acceptance: `AC-001`, `AC-004`, `AC-005`.

## Prasyarat (gate Q0) — yang harus selesai sebelum implementasi

1. **Product owner** setuju membuka Q1.
2. ADR-0009 (AQ-001), ADR-0010 (AQ-010), ADR-0011 (AQ-014) berstatus Diterima. Ringkasan pilihan:
   - ADR-0009: `events` = Tema Acara (Opsi 1), dengan 1 Aktivitas tanpa Sesi sebagai shim.
   - ADR-0010: migrasi additive `0007_*` dan seterusnya, tabel lama tetap.
   - ADR-011: allowlist konstanta di `packages/shared` per tipe objek.
3. Perbarui `docs/REQUIREMENTS.md` §0.3 dan §13.3 (status dokumen turunan sudah dibuat) — dilakukan product owner, bukan agent.
4. Tandai roadmap Q1 status "Dibuka", ubah `D-009` `[A]`, `D-018` `[A]`, `D-023` `[A]` sudah perlu (sudah).
5. Buat branch kerja: `git checkout -b q1-foundation`.

## Tujuan (target)

- Sistem mempresentasikan Tema dengan Aktivitas dan Sesi, beserta lifecycle terpisah.
- Tema → Aktivitas → Sesi enforceable (Sesi milik Aktivitas itu, Sesi tidak boleh beda Tema).
- Lifecycle (Draft, Aktif, Selesai, Diarsipkan untuk Aktivitas; Terjadwal, Berlangsung, Selesai, Dinonaktifkan untuk Sesi) divalidasi server-side.
- Audit mutasi Tema/Aktivitas/Sesi memakai allowlist field baru.
- Akses per Tema (`FR-097`, `FR-098`) + undangan (`FR-194`) bila `D-018` diterapkan.
- Regression: tes auth, dan isolasi acara Q0 yang perlu dipertahankan tetap lulus atau setara digantikan.

## Bukan cakupan (out of scope)

- Transaksi, entitlement, scanner (Q5–Q7), peserta/kategori (Q2), QR (Q4).
- Pengarsipan Sesi aktif di Q1 kecuali state arsip dan matriks reject-transaksi disiapkan (`BR-078`, `OQ-033` [A]).

## Desain skema (migrasi 0007)

Lokasi: `migrations/0007_q1_theme_activity_session.sql` (additive only):

- **Reuse `events` sebagai `themes` shim (ADR-0009).** Jangan buat tabel `themes` bila opsi 1; tambah kolom `theme_id` alias di Aktivitas yang merefer `events.id`.
- **`activities`**:
  - `id TEXT PRIMARY KEY`, `theme_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE`
  - `transaction_type TEXT NOT NULL CHECK (...)` (Attendance/Consumption)
  - `status TEXT NOT NULL CHECK (...)` (Draft, Aktif, Selesai, Diarsipkan)
  - `sort_order INTEGER NOT NULL DEFAULT 0`, `notes ...` opsional
  - timestamp `created_at`, `updated_at` (integer ms)
- **`sessions`**:
  - `id TEXT PRIMARY KEY`, `activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE`, `theme_id` denormalisasi opsional (atau join)
  - `name TEXT NOT NULL`, slot waktu (`starts_at`, `ends_at INTEGER`)
  - `status TEXT NOT NULL CHECK (...)` (Terjadwal, Berlangsung, Selesai, Dinonaktifkan), `archived_at INTEGER` nullable (state arsip vs status operasional)
- **Index** yang perlu: `idx_activities_theme_status`, `idx_sessions_activity_status`.
- **Trigger audit append-only** tetap (ADR-0008) untuk tabel baru bila mutasi dari Q1.
- Tidak pernah ubah `0001`–`0006`.

Catatan D1: `ALTER TABLE` terbatas; semua entitas baru via CREATE TABLE baku, tidak ada backfill wajib (`D-007`).

## Reuse yang dievaluasi

| Komponen baseline | Strategi Q1 |
|---|---|
| `routes/events.ts` | Alias ke Tema; tambah `/api/themes/:id/activities...`; jangan hapus route lama |
| `db/events.ts` | Tambah function akses Aktivitas/Sesi; pertahankan event helpers sebagai shim |
| `packages/shared/src/events.ts` | Tambah schema `Theme`, `Activity`, `Session` (zod) |
| `domain/permissions.ts` | Tambah kewenangan Admin Acara per Tema (Q15 + penugasan menyusul Q6) |
| `db/audit.ts` | Terapkan allowlist baru (AUD-011) untuk mutasi Tema/Aktivitas/Sesi |
| `lib/navigation.ts`, `lib/router.ts` | Pola rute diperluas, tidak dihapus |
| `tests/authz.events.test.ts` | Bertahap: ganti setara atau tangguhkan (regression gate) |

## Desain domain (pure TS, tanpa I/O)

- `packages/shared/src/hierarchy.ts` (atau `events.ts` diperluas): skema zod `Theme`, `Activity`, `Session`, `ActivityStatus`, `SessionStatus`.
- `apps/api/src/domain/lifecycle.ts`: fungsi murni yang memvalidasi transisi Aktivitas/Sesi (tabel lengkap `BR-047`..`BR-049`, `BR-071`). Tes `RENCANA_PENGUJIAN.md` T-001 (§9).
- `apps/api/src/db/activities.ts`, `db/sessions.ts`: query terindeks.
- `apps/api/src/routes/themes.ts` (atau tetap ganti `events.ts` dengan alias): parse→validasi→domain→respons `{ ok, data | error }`.
- Audit before/after: apply allowlist.

## Audit allowlist (ADR-0011)

Buat `packages/shared/src/audit-allowlist.ts` pure TS dengan:
- `ThemeAllowedFields`, `ActivityAllowedFields`, `SessionAllowedFields`.
- Field sensitif (token hash/ciphertext, PII) ditandai `REDACTED` tanpa nilai.

## Verifikasi / tes wajib (T-xxx)

`RENCANA_PENGUJIAN.md` §9.1:
- T-001 lifecycle (tabel lengkap transisi Aktivitas/Sesi) — murni.
- T-002 Sesi cross-Tema ditolak.
- T-003 duplikasi Sesi menyalin konfigurasi & status Terjadwal.
- T-004 akses lintas Tema → 404.
- T-005 anti-corruption alias route.
- Audit T-062/T-063 insert/update/mutasi Tema-Aktivitas-Sesi tercatat.

## Iterasi kerja

1. Buka ADR + ubah status roadmap Q1 "Dibuka".
2. Tulis migrasi `0007` dan catat di `docs/DESAIN_DATABASE.md`.
3. Domain lifecycle pure TS + unit test: `npm run test -- apps/api/src/domain/lifecycle.test.ts`.
4. `packages/shared` skema + allowlist; typecheck.
5. `db/activities`, `db/sessions`, audit allowlist; SQL batch for audit insert.
6. Routes: tambah endpoint Tema/Aktivitas/Sesi; pertahankan events alias.
7. Web: reusable component (UI deferred ke Q9? small navigation per `lib/navigation.ts` sebatas Q1).
8. typecheck → lint → test per modul; full suite di akhir.

## Perintah verifikasi

```sh
npm run db:migrate:local
npm run typecheck
npm run lint
npm run test -- apps/api/src/db apps/api/src/domain apps/api/src/routes
npm run test
```

## Gate akhir

- `AC-001`, `AC-004` (struktural), `AC-005`.
- Tujuh tes wajib §9.1 lulus, integritas anti-corruption.
- Audit insert lulus dan tidak memuat PII/secrets.
- Migrasi disimpan (tidak ada `0001`–`0006` yang diedit).
- Regression tes auth & isolasi tetap lulus atau diganti setara tercatat di OPERASIONAL.md.

## Risiko / catatan

- Web route legacy (`/events/:id`) perlu compatibility shim (alias) sampai Q8.
- Derivasi `events.status` ke lifecycle Tema/Aktivitas membutuhkan keringkasan pada mapping; jangan buat state machine di front-end.
- Waktu lokal 4GB: gunakan tes terfokus di iterasi; suite penuh di akhir.
- AQ-001 adopsi = opsi 1; jika product owner pilih opsi 2/3, nukleus filing perlu disesuaikan.