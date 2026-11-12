# DECISIONS — Indeks Keputusan QRCek

> **Status:** v1 — dibuat 3 November 2026 berdasarkan [`REQUIREMENTS.md`](./REQUIREMENTS.md) v0.3.1.
> **Sifat dokumen:** **indeks**. Isi keputusan produk ada di `REQUIREMENTS.md` §11–§12; isi keputusan arsitektur ada di [`adr/`](./adr/); detail pertanyaan arsitektur terbuka ada di [`ARCHITECTURE.md`](./ARCHITECTURE.md) §6. Jangan menyalin isi keputusan ke sini — cukup ID, status, dan tautan.

---

## 1. Jenis keputusan dan sumber kebenarannya

| Jenis | ID | Sumber isi | Pemilik |
|---|---|---|---|
| Keputusan produk | `D-001`…`D-024` | `REQUIREMENTS.md` §12 | Product owner |
| Pertanyaan produk | `OQ-001`…`OQ-034` | `REQUIREMENTS.md` §11 | Product owner |
| Keputusan arsitektur | `ADR-0001`… | `docs/adr/NNNN-*.md` | Pemilik proyek (atas usulan agent/engineer) |
| Pertanyaan arsitektur | `AQ-001`… | `ARCHITECTURE.md` §6 | Pemilik proyek |

### Status

| Status produk | Arti | Boleh diimplementasikan? |
|---|---|---|
| `[A]` Disepakati | Disetujui product owner | Ya |
| `[P]` Proposed | Rekomendasi, menunggu review | **Tidak sebagai final.** Boleh menyiapkan fondasi yang tidak mengunci pilihan; tanyakan bila ragu |
| `[O]` Terbuka | Belum ada rekomendasi | **Tidak.** Implementasi tidak boleh memilih jawaban sendiri |

| Status ADR | Arti |
|---|---|
| Diusulkan | Draft, belum disetujui pemilik proyek |
| Diterima | Berlaku |
| Ditinjau ulang | Masih berlaku, tetapi ada keputusan produk `[P]` yang dapat menggantinya |
| Digantikan oleh ADR-NNNN | Tidak berlaku; dipertahankan sebagai riwayat |

---

## 2. Keputusan produk

| ID | Topik | Status | OQ | Dampak arsitektur | Fase roadmap |
|---|---|---|---|---|---|
| `D-001` | Pembaruan `AGENTS.md` setelah struktur dokumen disepakati | `[A]` | `OQ-023` | Struktur dokumen ini | Q0 |
| `D-002` | `IMPLEMENTATION_PLAN.md` = arsip; `PLAN_TAB_PESERTA.md` dievaluasi | `[A]` | `OQ-024` | — | Q0 |
| `D-003` | Hierarki Tema → Aktivitas → Sesi; konteks transaksi | `[A]` | `OQ-001`–`OQ-004` | AQ-001, AQ-010 | Q1 |
| `D-004` | Satu QR Identity per Tema + Peserta | `[A]` | `OQ-032` | ADR-0003, ADR-0006, AQ-009 | Q4 |
| `D-005` | Prioritas & pewarisan entitlement; future-only | `[A]` | `OQ-005`–`OQ-007` | AQ-005 | Q3 |
| `D-006` | Reversal/Adjustment hanya Admin Acara; transaksi efektif | `[A]` | — | AQ-003, AQ-004 | Q5 |
| `D-007` | Tanpa kewajiban migrasi data produksi; regression test tetap wajib | `[A]` | bagian `OQ-001/002/004` | AQ-010 | Q1 |
| `D-008` | Impor: External Reference, review duplikat, tanpa merge otomatis | `[A]` | `OQ-008`, `OQ-009` | AQ-006 | Q2 |
| `D-009` | Satu tipe transaksi utama per Aktivitas | `[A]` | `OQ-010`, `OQ-013` | AQ-002 | Q1, Q5, Q6 |
| `D-010` | Validasi lifecycle Aktivitas/Sesi | `[A]` | `OQ-011` | — | Q1 |
| `D-011` | Type/Source/Correction terpisah; result code stabil | `[A]` | `OQ-012`, `OQ-013` | AQ-002, AQ-004, AQ-008 | Q5 |
| `D-012` | Feedback & konteks scanner berbasis penugasan | `[A]` | `OQ-014`, `OQ-016`, `OQ-018` | AQ-007, AQ-012 | Q7 |
| `D-013` | Feedback audio/visual, mute lokal, tidak hanya warna | `[A]` | `OQ-015` | AQ-012 | Q7 |
| `D-014` | Kuota konsumsi dapat dikonfigurasi; pemulihan kuota setelah Reversal | `[A]` | `OQ-017` | AQ-003 | Q6 |
| `D-015` | CSV dulu, XLSX tahap berikutnya | `[A]` | `OQ-019` | AQ-013 | Q8 |
| `D-016` | PNG/ZIP QR dirakit di browser | `[A]` | `OQ-020` | ADR-0006 | Q4 |
| `D-017` | Google Sheets opsional per Tema | `[A]` | `OQ-021` | ADR-0004, ADR-0005, AQ-011 | Q10 |
| `D-018` | Admin Acara via undangan; self-registration nonaktif | `[A]` | `OQ-022` | ADR-0007 | Q1 |
| `D-019` | Pertahankan identifier teknis `absensi` | `[A]` | `OQ-026` | ADR-0002, ADR-0003 | Semua |
| `D-020` | Batas impor 2 MB / 1.000 baris | `[A]` | `OQ-028` | — | Q2 |
| `D-021` | Geist lokal, light/dark via token CSS | `[A]` | `OQ-029` | — | Q9 |
| `D-022` | Manual Check-in oleh Petugas berizin | `[A]` | `OQ-030` | AQ-007 | Q5, Q7 |
| `D-023` | Cakupan & privasi audit | `[A]` | `OQ-031` | ADR-0008, AQ-014 | Q1, Q8 |
| `D-024` | Super Admin tanpa kewenangan koreksi | `[A]` | `OQ-025` | AQ-007 | Q5 |

Semua pertanyaan produk `OQ-001` s.d `OQ-034` sudah ditutup oleh keputusan disepakati di §2. Tidak ada lagi pertanyaan produk `[O]`.

Pertanyaan arsitektur terbuka (`AQ`): `REQUIREMENTS.md` §13.2 / `ARCHITECTURE.md` §6.

---

## 3. Keputusan arsitektur (ADR)

| ADR | Judul | Status | Relasi dengan keputusan produk |
|---|---|---|---|
| [0001](./adr/0001-single-worker-same-origin.md) | Satu Worker same-origin | Diterima | Tidak terdampak |
| [0002](./adr/0002-passwordless-token-auth.md) | Auth passwordless berbasis token | Diterima | `D-019` [A] (nama cookie/header) |
| [0003](./adr/0003-opaque-qr-token.md) | QR token opaque | Diterima; scope diperbarui | `D-004` [A] → AQ-009 |
| [0004](./adr/0004-sheets-upsert-projection.md) | Sheets proyeksi/upsert per peserta | Ditinjau ulang | `D-017` [A] → AQ-011 |
| [0005](./adr/0005-d1-outbox-cron.md) | Outbox D1 + Cron | Diterima | `D-017` [A] |
| [0006](./adr/0006-qr-credential-hash-ciphertext.md) | Kredensial QR hash + ciphertext | Diterima | `D-004` [A], `D-016` [A] |
| [0007](./adr/0007-event-admin-self-signup.md) | Pendaftaran mandiri admin acara | Digantikan oleh ADR-0013 | `D-018` [A] |
| [0008](./adr/0008-audit-log-retention.md) | Retensi audit append-only | Diterima | `D-023` [A] (kebijakan retensi) |
| [0009](./adr/0009-events-baseline-hierarchy-mapping.md) | Peta `events` baseline ke Tema → Aktivitas → Sesi | Diterima (AQ-001) | `D-003` [A], `D-007` [A] |
| [0010](./adr/0010-schema-migration-strategy.md) | Strategi skema (additive) menuju model baru | Diterima (AQ-010) | `D-007` [A] |
| [0011](./adr/0011-audit-allowlist-mechanism.md) | Mekanisme allowlist audit | Diterima (AQ-014) | `FR-207`, `D-023` [A] |
| [0012](./adr/0012-activity-session-lifecycle.md) | Tabel transisi lifecycle Aktivitas dan Sesi | Diterima (detail `D-010`) | `D-010` [A], `OQ-033` [A] |
| [0013](./adr/0013-disable-public-self-signup.md) | Menonaktifkan pendaftaran Admin Acara mandiri | Diterima; menggantikan ADR-0007 | `D-018` [A], `FR-194`, `AC-050` |
| [0014](./adr/0014-categories-and-custom-fields.md) | Kategori dan custom field peserta | Diterima (AQ-006) | `FR-026`–`FR-036`, `D-008` [A] |
| [0015](./adr/0015-archived-theme-is-read-only.md) | Tema terarsip membuat resource anak read-only | Diterima (detail Q1) | `D-003` [A], `D-010` [A] |
| [0016](./adr/0016-entitlement-resolution.md) | Representasi dan resolusi entitlement | Diterima (AQ-005) | `D-005` [A], `FR-037`–`FR-045`, `FR-199` |
| [0017](./adr/0017-qr-identity-per-theme.md) | QR Identity per Tema dan rotasi token | **Diterima** (AQ-009, 9 November 2026) | `D-004` [A], `FR-054`–`FR-065`, `FR-200` |
| [0018](./adr/0018-transaction-table-shape.md) | Bentuk tabel transaksi Attendance dan Consumption | **Diterima** (AQ-002, 9 November 2026) | `D-009`, `D-011`, `D-022` [A]; `FR-066`–`FR-072`, `FR-088` |
| [0019](./adr/0019-effective-transaction-constraints.md) | Penegakan transaksi efektif dan konteks di database | **Diterima** (AQ-003, 9 November 2026) | `D-006`, `D-009`, `D-010` [A]; `FR-068`, `FR-075`, `FR-183`–`FR-188` |
| [0020](./adr/0020-reversal-adjustment-structure.md) | Struktur Reversal dan Adjustment | **Diterima** (AQ-004, 9 November 2026) | `D-006`, `D-011`, `D-024` [A]; `FR-076`–`FR-080`, `FR-207` |
| [0021](./adr/0021-staff-assignments-and-permissions.md) | Penugasan Petugas dan matriks izin transaksi | **Diterima** (AQ-007, 9 November 2026) | `D-012`, `D-022`, `D-024` [A], `OQ-034` [A]; `FR-073`, `FR-097`–`FR-106` |
| [0022](./adr/0022-scan-result-contract.md) | Kontrak hasil scan dan kode penolakan | **Diterima** (AQ-008, 9 November 2026) | `D-011`, `D-012` [A]; `FR-088`, `FR-119`, `FR-203` |

Nomor ADR berikutnya: **0023**.

---

## 4. Pertanyaan arsitektur terbuka (AQ)

Detail opsi: [`ARCHITECTURE.md`](./ARCHITECTURE.md) §6. Status: **AQ-001, AQ-002, AQ-003, AQ-004, AQ-005, AQ-006, AQ-007, AQ-008, AQ-009, AQ-010, dan AQ-014 dijawab** oleh ADR-0009/0018/0019/0020/0016/0021/0022/0017/0010/0011 (**Diterima**); AQ lainnya masih **Terbuka**. ADR-0012 tidak menjawab AQ; isinya menetapkan detail tabel transisi untuk `D-010` [A]. ADR-0015 juga tidak menjawab AQ; isinya menutup celah aturan arsip Tema. **AQ-002–AQ-004, AQ-007, dan AQ-008 dijawab ADR-0018–0022 (Diterima 9 November 2026):** satu tabel `transactions` + `transaction_corrections` dengan `slot_no` disiapkan untuk Q7; empat partial unique index efektif dan trigger konteks/lifecycle; Reversal menandai baris asli dan Adjustment menulis versi baru dengan field `occurred_at`/`note`/`status`; `staff_assignments` dengan izin `attendance:manual` dan `transaction:correct`, Super Admin tanpa scan maupun Manual Check-in; hasil bisnis HTTP 200 dengan `SYSTEM_ERROR` 5xx. **AQ-005 dijawab ADR-0016 (Diterima 8 November 2026):** satu tabel `entitlement_rules`, resolver murni, default deny, dan lima sub-keputusan `FR-040`/`FR-041` (draft→active gate, baris eksplisit per kategori, kategori baru fail-closed, backfill `allowed`, Theme default sebagai fallback). **AQ-009 dijawab ADR-0017 (Diterima 9 November 2026):** satu tabel `qr_identities` dengan satu baris aktif per `(theme_id, participant_id)`, penerbitan lazy saat cetak/unduh pertama, rotasi in-place oleh Admin Acara Tema itu atau Super Admin dengan alasan wajib, riwayat rotasi di audit append-only, backfill kredensial lama, dan QR peserta nonaktif ditolak saat scan.

| ID | Pertanyaan | Bergantung pada | Memblokir |
|---|---|---|---|
| AQ-001 | Posisi `events` dalam hierarki Tema → Aktivitas → Sesi | `D-003`, `D-007` | Q1 |
| AQ-002 | Satu tabel transaksi vs per tipe | `D-009` [A], `D-011` [A] | Q5, Q6 — **Dijawab** ADR-0018 (9 November 2026) |
| AQ-003 | Constraint DB untuk transaksi efektif & kuota | `D-006` [A], `D-014` [A] | Q5, Q6 — **Dijawab** ADR-0019 (9 November 2026) |
| AQ-004 | Struktur Reversal/Adjustment; field yang boleh di-Adjust | `D-006` [A], `D-011` [A] | Q5 — **Dijawab** ADR-0020 (9 November 2026) |
| AQ-005 | Representasi & resolver entitlement | `D-005` [A] | **Dijawab** ADR-0016 (8 November 2026) |
| AQ-006 | Kategori & custom field | `FR-026`–`FR-036` | Q2 |
| AQ-007 | Penugasan Petugas & matriks izin | `D-022` [A], `D-024` [A], `OQ-034` [A] | Q5, Q7 — **Dijawab** ADR-0021 (9 November 2026) |
| AQ-008 | Pemetaan penolakan ke result code & HTTP | `D-011` [A] | Q5, Q7 — **Dijawab** ADR-0022 (9 November 2026) |
| AQ-009 | Kepemilikan kredensial QR per Tema; rotasi token | `D-004` [A], AQ-001 | **Dijawab** ADR-0017 (9 November 2026) |
| AQ-010 | Strategi skema/migrasi menuju model baru | `D-007` [A] | Q1 |
| AQ-011 | Proyeksi Sheets untuk Sesi & Consumption | `D-017` [A] | Q10 |
| AQ-012 | Template pesan scanner per Tema | `D-012` [A], `D-013` [A] | Q7 |
| AQ-013 | Pembuatan laporan CSV/XLSX | `D-015` [A] | Q8 |
| AQ-014 | Mekanisme allowlist audit | `D-023` [A], `FR-207` | Q1 |

Dijawab: AQ-001 → ADR-0009; AQ-002 → ADR-0018; AQ-003 → ADR-0019; AQ-004 → ADR-0020; AQ-006 → ADR-0014; AQ-007 → ADR-0021; AQ-008 → ADR-0022; AQ-010 → ADR-0010; AQ-014 → ADR-0011.

ADR-0018–0022 diterima pemilik proyek 9 November 2026; Q5 dibuka pada tanggal yang sama.

Nomor AQ berikutnya: **AQ-015**.

---

## 5. Keputusan lama yang sudah ditutup atau digantikan

| Sumber lama | Isi | Status sekarang |
|---|---|---|
| `AGENTS.md` (versi sebelum 3 Nov 2026) "Keputusan terbuka" #1 — bentuk token QR | — | Ditutup oleh ADR-0003 |
| `AGENTS.md` "Keputusan terbuka" #2 — mode sinkronisasi Sheets | — | Ditutup oleh ADR-0004 untuk baseline; ditinjau ulang lewat AQ-011 |
| `AGENTS.md` "Keputusan terbuka" #3 — audit jangka panjang | — | Ditutup oleh ADR-0008; kebijakan retensi final menunggu `D-023` [A] |
| `IMPLEMENTATION_PLAN.md` "Hal yang menunggu keputusan" #7 | Superadmin boleh mengoreksi absensi | **Digantikan** oleh `D-006` [A] (hanya Admin Acara). Kewenangan Super Admin menunggu `D-024` [A]. Kode baseline masih mengizinkan superadmin — delta Q5 |
| `PLAN_TAB_PESERTA.md` §3 "ADR-008" (D1–D8) | Desain tab Peserta | **Tidak pernah diadopsi**; nomor bentrok dengan ADR-0008. Dipakai hanya sebagai masukan AQ-006 dan Q2/Q4 |
| ADR-0006 & ADR-0017 §Konsekuensi — batch label 50 | Batas `QR_LABEL_BATCH_MAX = 50` dari pengukuran baseline | **Angka operasional digantikan** setelah `qr_identities` menambah satu insert per peserta: terukur **47 statement** untuk 38 label, reprint 8, jalur lost-race 48, jadi batas final **38** (`docs/OPERASIONAL.md` §6.2, `docs/DESAIN_API.md` §5). ADR yang sudah diterima **tidak diedit**; baris ini mencatat angka pengganti |
| Roadmap Fase 0–6 di `AGENTS.md` lama | Urutan fase | **Digantikan** oleh [`IMPLEMENTATION_ROADMAP.md`](./IMPLEMENTATION_ROADMAP.md); riwayatnya di `IMPLEMENTATION_PLAN.md` |

### Pemetaan rujukan lama

| Rujukan lama | Rujukan sekarang |
|---|---|
| `docs/ARSITEKTUR.md` | `docs/ARCHITECTURE.md` |
| `docs/ARSITEKTUR.md` ADR-00N | `docs/adr/000N-*.md` (nomor sama, empat digit) |
| `IMPLEMENTATION_PLAN.md` sebagai rencana aktif | `docs/IMPLEMENTATION_ROADMAP.md` |

Rujukan lama di file yang tidak boleh diedit (mis. komentar di `migrations/0004_qr.sql`) dibaca memakai tabel ini.

---

## 6. Proses

### Menambah atau mengubah keputusan

1. **Keputusan produk** hanya diubah oleh product owner di `REQUIREMENTS.md` (§11, §12, Change Log). Agent tidak mengubah status `[P]` → `[A]`.
2. Setelah `REQUIREMENTS.md` berubah: perbarui tabel §2 di sini, lalu gate di `IMPLEMENTATION_ROADMAP.md`, lalu ADR yang terdampak.
3. **Keputusan arsitektur** ditulis sebagai `docs/adr/NNNN-judul-inggris.md` dengan status `Diusulkan`, lalu `Diterima` setelah pemilik proyek setuju. Tambahkan barisnya di §3 dan, bila menjawab AQ, tandai AQ itu `Dijawab oleh ADR-NNNN` di §4 dan di `ARCHITECTURE.md` §6.
4. ADR yang diterima **tidak diedit isinya**. Perubahan = ADR baru yang menggantikan; ADR lama diberi status `Digantikan oleh ADR-NNNN`.

### Template ADR

```markdown
# ADR-NNNN — Judul

| Atribut | Nilai |
|---|---|
| Status | Diusulkan |
| Tanggal | YYYY-MM-DD |
| Menjawab | AQ-xxx |
| Terkait kebutuhan | FR-xxx, BR-xxx, NFR-xxx, D-xxx |

## Konteks
## Opsi
## Keputusan
## Konsekuensi
```
