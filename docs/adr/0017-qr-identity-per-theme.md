# ADR-0017 — QR Identity per Tema: kepemilikan kredensial dan rotasi token

| Atribut | Nilai |
|---|---|
| Status | **Diterima** 9 November 2026 (pemilik proyek menyetujui Opsi A dan tujuh sub-keputusan) |
| Tanggal | 2026-11-09 |
| Menjawab | AQ-009 (`docs/ARCHITECTURE.md` §6) — **dijawab** |
| Terkait kebutuhan | `FR-004`, `FR-054`–`FR-065`, `FR-200`; `BR-002`, `BR-024`–`BR-029`; `AC-015`–`AC-018`; `D-004` [A], `D-016` [A], `D-019` [A] |
| Tetap berlaku | ADR-0003 (token opaque), ADR-0006 (hash + ciphertext), prefix `absensi:v1:` (`D-019` [A]), `NG-06` (tanpa mode offline) |
| Memblokir (sebelum diterima) | Q4 — dibuka 9 November 2026 setelah ADR ini diterima |
| Dampak | Migrasi `0010_*` (additive), tabel `qr_identities`, route rotasi, ekspor PNG/ZIP, audit `qr.*`, pemakaian ulang `domain/qr-token.ts` |

## Konteks

`D-004` [A] menetapkan **satu QR Identity per Tema + Peserta**: peserta yang mengikuti beberapa Tema memiliki QR terpisah untuk setiap Tema (`FR-054`, `BR-002`), dan QR itu berlaku untuk seluruh Aktivitas/Sesi dalam Tema tersebut sesuai entitlement (`FR-004`).

Baseline (commit acuan `157c330`, `migrations/0004_qr.sql`) menyimpan kredensial **langsung di baris `participants`**:

- `qr_token_hash` — `HMAC-SHA256(QR_PEPPER, token)`, 43 karakter, partial unique index `uq_participant_qr_hash`.
- `qr_token_ciphertext` + `qr_token_nonce` — AES-256-GCM untuk cetak ulang tanpa menyimpan plaintext (ADR-0006).
- `qr_key_version`, `qr_issued_at`.

Karena baseline `participants` sudah memiliki `event_id`, kredensial itu **secara efektif** sudah per-Tema + per-Peserta. Namun ada empat celah yang tidak diselesaikan baseline:

1. **QR Identity bukan entitas.** Tidak ada objek yang bisa dipakai untuk rotasi, pencabutan, atau riwayat; kredensial hanya kolom profil peserta.
2. **Rotasi token per peserta belum ada.** Yang ada adalah rotasi **kunci enkripsi** (`reencryptQrCredential`), bukan penggantian token (`FR-059`, `AC-016`, `BR-027`).
3. **Ekspor PNG/ZIP belum ada** (`FR-063`/`FR-064`, `AC-018`); baru ada preview dan cetak browser A4/stiker.
4. **`FR-061`/`AC-017`** (QR peserta nonaktif ditolak) belum pernah diuji sebagai aturan QR; status peserta belum dijadikan syarat pada lookup QR.

AQ-009 meminta keputusan: **di entitas mana kredensial melekat** dan **bagaimana rotasi dirancang**, tanpa melanggar `FR-055`–`FR-057` (tanpa PII, opaque, sulit ditebak), `FR-058`/`BR-026` (validasi backend tiap scan), `FR-060`/`BR-028` (riwayat transaksi tidak berubah), dan `FR-200` (token hanya untuk yang berwenang).

## Opsi

### Opsi A — Tabel `qr_identities`, satu baris aktif per `(theme_id, participant_id)` (dipilih)

```sql
CREATE TABLE qr_identities (
  id             TEXT PRIMARY KEY,
  theme_id       TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  token_hash     TEXT NOT NULL,
  ciphertext     TEXT NOT NULL,
  nonce          TEXT NOT NULL,
  key_version    INTEGER NOT NULL,
  issued_at      INTEGER NOT NULL,
  rotated_at     INTEGER,
  rotation_count INTEGER NOT NULL DEFAULT 0,
  CHECK (length(token_hash) = 43),
  CHECK (length(ciphertext) = 79),
  CHECK (length(nonce) = 16),
  CHECK (key_version >= 1),
  CHECK (issued_at > 0),
  CHECK (rotated_at IS NULL OR rotated_at >= issued_at),
  CHECK (rotation_count >= 0)
);
CREATE UNIQUE INDEX uq_qr_identity_participant ON qr_identities(theme_id, participant_id);
CREATE UNIQUE INDEX uq_qr_identity_hash ON qr_identities(token_hash);
```

- Rotasi = `UPDATE` baris yang sama: hash/ciphertext/nonce baru, `rotated_at`, `rotation_count + 1`. `id` tetap, sehingga referensi transaksi (Q5) tidak berubah dan `FR-060` terpenuhi secara konstruksi.
- Scan = satu lookup `WHERE token_hash = ?` pada `uq_qr_identity_hash`, lalu join `participants` untuk status aktif dan kategori (entitlement Q3). Tetap satu request, satu indeks, tanpa N+1.
- Riwayat rotasi hidup di **audit** (`FR-062`, `BR-029`), bukan baris data; ini konsisten `D-023` [A] dan ADR-0008.

### Opsi B — Pertahankan kolom QR di `participants`

- Tidak perlu migrasi data; route rotasi cukup `UPDATE participants SET qr_token_hash = ..., qr_token_ciphertext = ...`.
- Kekurangan: kredensial tetap bercampur profil; setiap operasi peserta menyentuh kolom kredensial; tidak ada entitas untuk kebijakan rotasi/revocation; sulit berevolusi bila target mengizinkan peserta lintas Tema.

### Opsi C — Tabel `qr_identities` dengan riwayat baris

- Setiap rotasi membuat baris baru; baris lama diberi `superseded_at`; transaksi bisa mereferensikan baris kredensial tertentu.
- Kekurangan: lookup scan harus menyaring `superseded_at IS NULL`; data tumbuh setiap rotasi; `FR-060` tetap terpenuhi tetapi dengan biaya baris dan kompleksitas yang tidak diminta `REQUIREMENTS.md`.

## Keputusan

**Opsi A.** Satu tabel `qr_identities` dengan satu baris aktif per `(theme_id, participant_id)`, memakai ulang `domain/qr-token.ts` (generate, hash, issue, reencrypt) dan dua secret yang sudah ada (`QR_PEPPER`, `QR_ENCRYPTION_KEY`, `QR_KEY_VERSION`).

Rancangan yang mengikuti opsi ini:

1. **Skema additive `0010_*`.** Tabel baru + dua unique index parsial. Backfill dari kolom `participants.qr_*` yang **sudah terisi** agar kartu yang sudah tercetak tetap sah; peserta tanpa kredensial tidak dibuatkan baris sampai QR pertama dibutuhkan.
2. **Kolom lama dipertahankan sampai Q4 stabil**, lalu dihapus lewat migrasi contract terpisah. Alasannya sama dengan pelajaran rilis Q2/`0008`: jangan mengubah dan menghapus dalam satu jendela.
3. **Trigger konteks**: `participant_id` wajib milik `theme_id` yang sama (pola Q2/Q3). Trigger menolak baris lintas Tema; route tetap memvalidasi agar pesan ke admin jelas.
4. **Rotasi**: `PUT /api/events/:eventId/participants/:participantId/qr/rotate` (nama final mengikuti `DESAIN_API.md` saat Q4 dibuka), hanya `event_admin` pada Tema itu atau Super Admin; **alasan wajib** (keputusan pemilik 9 November 2026); audit `qr.identity_rotated` di `db.batch()` yang sama. Token lama langsung tidak berlaku karena hash-nya diganti; ciphertext lama ikut diganti sehingga cetak ulang memakai token baru.
5. **Scan**: resolver QR berada di jalur scan Q5/Q6. Lookup hash **harus** memverifikasi `identity.theme_id` sama dengan Tema konteks scan; QR Tema A di konteks Tema B = tidak ditemukan (`AC-015`). Peserta `inactive` ditolak (`FR-061`/`AC-017`).
6. **Ekspor PNG/ZIP** (`D-016` [A]): backend mengotorisasi dan mengembalikan payload token (hasil dekripsi) per batch; browser merender PNG dan memaketkan ZIP. Batas batch mengikuti pengukuran baseline `QR_LABEL_BATCH_MAX = 50`. Audit `qr.labels_exported` menyimpan jumlah, bukan token.
7. **Audit**: `qr.identity_issued`, `qr.identity_rotated`, `qr.labels_exported`; allowlist hanya `themeId`, `participantId`, `keyVersion`, `rotationCount`, `count`. Tidak ada token, hash, ciphertext, nonce, nama, atau email (`FR-062`, `FR-207`).

## Konsekuensi

- Scope Tema + Peserta menjadi eksplisit di data, bukan kesimpulan dari `participants.event_id`.
- Rotasi token per peserta akhirnya punya jalur nyata dan bisa diuji: token lama ditolak, riwayat transaksi tidak berubah, audit tercatat.
- Scan tetap satu lookup terindeks; tidak ada layanan atau dependensi baru untuk verifikasi.
- Migrasi menambah satu tabel + dua index + trigger; biaya tulis backfill sebanding jumlah peserta yang **sudah** punya QR (bukan seluruh peserta).
- Kolom QR lama menjadi duplikasi sementara (delta yang harus ditutup pada migrasi contract). Selama transisi, kedua jalur harus membaca sumber yang sama agar cetak ulang tidak menghasilkan token berbeda.
- Ekspor ZIP di browser membutuhkan keputusan dependensi atau implementasi manual; ini masuk justifikasi dependency Q4, bukan ADR ini.
- Tidak ada perubahan pada `absensi:v1:` atau dua secret; QR yang sudah tercetak tetap sah setelah backfill.

## Sub-keputusan (diputuskan pemilik proyek, 9 November 2026)

| # | Pertanyaan | Keputusan |
|---|---|---|
| 1 | Kapan kredensial dibuat? | **Lazy** — dibuat saat cetak/unduh pertama; peserta tanpa kredensial tidak punya baris sampai QR dibutuhkan. Ditafsirkan konsisten dengan `FR-004`: satu QR per Tema + Peserta, dibuat saat pertama diperlukan. |
| 2 | Siapa yang boleh merotasi token? | **Admin Acara Tema itu + Super Admin.** |
| 3 | Apakah alasan rotasi wajib? | **Wajib**, karena rotasi membatalkan kartu fisik. |
| 4 | Bagaimana nasib kredensial lama saat migrasi? | **Backfill** `hash/ciphertext/nonce/key_version` yang sudah ada agar kartu tercetak tetap sah. |
| 5 | Kapan kolom QR lama di `participants` dihapus? | **Migrasi contract terpisah** setelah Q4 stabil. |
| 6 | QR peserta nonaktif ditolak di mana? | **Saat scan**, dengan join status peserta; tidak ada penulisan tambahan saat status berubah. |
| 7 | Ekspor ZIP: dependensi browser atau implementasi manual? | **Diputuskan di Q4** setelah ukuran dan CPU diukur; ADR ini tidak mengunci pilihan, tetapi setiap dependensi wajib justifikasi satu baris (`AGENTS.md`). |

## Keputusan pemilik proyek (9 November 2026)

1. **Opsi A disetujui** — tabel `qr_identities`, satu baris aktif per `(theme_id, participant_id)`.
2. **Sub-keputusan 1–7 disetujui** sesuai tabel di atas.
3. **Riwayat rotasi cukup di audit** (bukan baris kredensial historis), sesuai `D-023` [A].
4. **Q4 membuka kode + migrasi `0010`**; UI ekspor final masuk Q9, sedangkan backend + payload + batas batch tetap Q4.

Dengan keputusan ini AQ-009 ditutup di `docs/DECISIONS.md` dan `docs/ARCHITECTURE.md`, dan Q4 dibuka di `docs/IMPLEMENTATION_ROADMAP.md` pada 9 November 2026.

## Referensi

- `REQUIREMENTS.md` §4.1/§5 (`FR-004`, `FR-054`–`FR-065`, `BR-002`, `BR-024`–`BR-029`), §9 (`AC-015`–`AC-018`), `D-004` [A], `D-016` [A].
- `docs/ARCHITECTURE.md` §6 AQ-009; `docs/DECISIONS.md` §4.
- `docs/adr/0003-opaque-qr-token.md`, `docs/adr/0006-qr-credential-hash-ciphertext.md`.
- `migrations/0004_qr.sql`, `apps/api/src/domain/qr-token.ts`, `apps/api/src/routes/labels.ts`.
- `docs/IMPLEMENTATION_ROADMAP.md` Q4; `docs/OPERASIONAL.md` §7 (secret dan prosedur rotasi kunci).
