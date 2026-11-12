# ADR-0021 — Penugasan Petugas dan matriks izin transaksi

| Atribut | Nilai |
|---|---|
| Status | **Diterima** 9 November 2026 (pemilik proyek menyetujui seluruh butir dan memutuskan Super Admin tidak boleh QR scan transaksional) |
| Tanggal | 2026-11-09 |
| Menjawab | AQ-007 (`docs/ARCHITECTURE.md` §6) — **dijawab** |
| Terkait kebutuhan | `FR-073`, `FR-074`, `FR-097`–`FR-106`, `FR-169`, `FR-190`; `BR-034`, `BR-050`–`BR-053`; `AC-021`, `AC-049`, `AC-055`; `D-012`, `D-022`, `D-024` [A], `OQ-034` [A] |
| Tetap berlaku | `AGENTS.md` §Keamanan (otorisasi di Worker, cek penugasan eksplisit); `AC-055` (izin legacy `attendance:correct` tidak boleh dipakai ulang) |
| Bergantung pada | ADR-0018 (transaksi), ADR-0019 (konteks) |
| Memblokir (sebelum diterima) | Q5 (manual entry) dan Q7 — Q5 dibuka 9 November 2026 setelah ADR ini diterima |
| Dampak | Tabel `staff_assignments`, `domain/permissions.ts`, route scan/manual/koreksi, backfill dari membership, tes otorisasi |

## Konteks

Baseline hanya punya `event_memberships` (peran `event_admin`/`officer` per acara) dan matriks izin `apps/api/src/domain/permissions.ts`. Akibatnya:

- Petugas dapat memindai **seluruh** acara, bukan hanya Aktivitas/Sesi yang ditugaskan (`FR-099`, `FR-100`).
- Manual Entry memakai izin `attendance:correct` (`FR-073`, `AC-055`) — izin legacy yang dilarang dipakai ulang sebagai otorisasi Manual Check-in target.
- Super Admin lolos semua cek `isAllowed`, sehingga koreksi dan Manual Check-in ikut terbuka meskipun `D-024` [A] dan `OQ-034` [A] melarangnya.

Target membutuhkan penugasan per Aktivitas/Sesi, izin Manual Check-in yang dapat diaktifkan Admin Acara, dan pemisahan tegas antara:
- **Scan** (source QR) — Petugas yang ditugaskan pada konteks;
- **Manual Check-in** (source manual) — izin terpisah;
- **Reversal/Adjustment** — hanya Admin Acara (`D-006`, `D-024`).

`FR-190` menegaskan URL hanya preselect, bukan otorisasi: memilih `activityId`/`sessionId` di URL tidak boleh memberi akses.

## Opsi

### Opsi A — Tetap per-acara, tambah flag Manual Check-in di `event_memberships`

- Kelebihan: tanpa tabel baru.
- Kekurangan: tidak memenuhi `FR-099`/`FR-100` (penugasan per Aktivitas/Sesi) dan `D-012` [A] (konteks scanner berbasis penugasan); Petugas tetap bisa memindai semua Aktivitas.

### Opsi B — Tabel penugasan per Aktivitas dengan Sesi opsional (dipilih)

- Satu tabel `staff_assignments`; satu baris = satu penugasan pada Aktivitas, atau pada Sesi tertentu di bawah Aktivitas itu.
- Kelebihan: memenuhi `FR-099`/`FR-100`; mendukung flag Manual Check-in per Petugas; Q6 dapat menambah UI tanpa migrasi baru.
- Kekurangan: satu tabel + dua partial unique index + trigger konteks; backfill dari membership diperlukan agar operasi tidak berhenti.

### Opsi C — Dua tabel terpisah (penugasan Aktivitas dan penugasan Sesi)

- Kelebihan: bentuk paling eksplisit.
- Kekurangan: dua jalur query otorisasi, dua endpoint pengelolaan, dan logika "Aktivitas mencakup Sesi" tetap harus ditulis; tidak ada manfaat dibanding satu tabel ber-`session_id` nullable.

## Keputusan

**Opsi B.**

### Tabel `staff_assignments`

```sql
CREATE TABLE staff_assignments (
  id                    TEXT PRIMARY KEY,
  theme_id              TEXT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  activity_id           TEXT NOT NULL REFERENCES activities(id) ON DELETE RESTRICT,
  session_id            TEXT REFERENCES activity_sessions(id) ON DELETE RESTRICT,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  can_manual_check_in   INTEGER NOT NULL DEFAULT 0
                        CHECK (can_manual_check_in IN (0, 1)),
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','revoked')),
  created_at            INTEGER NOT NULL,
  created_by            TEXT REFERENCES users(id) ON DELETE RESTRICT,
  updated_at            INTEGER NOT NULL,
  updated_by            TEXT REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at            INTEGER,
  CHECK (created_at > 0),
  CHECK (updated_at >= created_at),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX uq_assignment_activity
  ON staff_assignments(theme_id, activity_id, user_id)
  WHERE session_id IS NULL AND status = 'active';

CREATE UNIQUE INDEX uq_assignment_session
  ON staff_assignments(theme_id, activity_id, session_id, user_id)
  WHERE session_id IS NOT NULL AND status = 'active';

CREATE INDEX idx_assignment_user_theme
  ON staff_assignments(user_id, theme_id, status);
CREATE INDEX idx_assignment_activity_status
  ON staff_assignments(activity_id, session_id, status);
```

Trigger konteks (pola Q2/Q3):

- `activity_id` harus milik `theme_id`;
- `session_id` harus milik `activity_id`;
- `user_id` harus punya `event_memberships` berstatus `active` pada `theme_id` (kecuali aturan Super Admin di bawah diputuskan lain);
- `activity_id` yang bertipe `consumption` tidak boleh dipakai untuk tugas Attendance; validasi ini boleh di route bila lebih jelas pesannya, tetapi trigger disarankan untuk integritas.

### Semantik penugasan

1. **Penugasan level Aktivitas** (`session_id IS NULL`) mencakup transaksi Aktivitas-tanpa-Sesi **dan** seluruh Sesi di bawah Aktivitas itu.
2. **Penugasan level Sesi** hanya mencakup Sesi tersebut; tidak memberi akses ke Sesi lain atau transaksi level Aktivitas.
3. Untuk Manual Check-in pada Sesi, izin efektif diambil dari penugasan **paling spesifik** yang aktif: penugasan Sesi bila ada, jika tidak penugasan Aktivitas.
4. Pencabutan tugas = `status = 'revoked'` + `revoked_at`; baris tidak dihapus. Pencabutan tidak mengubah transaksi historis (`FR-104`).
5. Satu perangkat boleh dipakai beberapa Petugas, tetapi tiap Petugas memakai akun sendiri (`FR-105`); tabel ini tidak mengubah aturan itu.

### Matriks izin target (diterima 9 November 2026)

| Aksi | Super Admin | Admin Acara (Tema itu) | Petugas |
|---|---|---|---|
| Scan QR (source `qr_scan`) | **Tidak** (diputuskan pemilik 9 November 2026: hanya baca transaksi/audit lintas Tema, `FR-097`) | Ya | Hanya bila punya penugasan aktif pada konteks Aktivitas/Sesi |
| Manual Check-in (source `manual`) | **Tidak** (`OQ-034` [A]) | Ya, bila `events.allow_manual = 1` | Hanya bila penugasan aktif pada konteks **dan** `can_manual_check_in = 1` **dan** `events.allow_manual = 1` |
| Reversal/Adjustment | **Tidak** (`D-024` [A]) | Ya | **Tidak** (`FR-106`) |
| Melihat transaksi/riwayat | Ya, lintas Tema (`FR-097`) | Ya | Ya, terbatas lingkup tugas (`recap:read`) |
| Mengelola penugasan | Ya (lintas Tema) | Ya | Tidak |

Aksi baru di `domain/permissions.ts`:

- `attendance:manual` — minimum `officer`; **selalu** ditambah cek penugasan + flag + `allow_manual` di route.
- `transaction:correct` — minimum `event_admin`; route tetap menolak Super Admin eksplisit.
- `attendance:correct` legacy **dihapus** setelah route koreksi lama diganti; tidak pernah dipakai sebagai izin Manual Check-in (`AC-055`).

`scan` tetap ada di matriks, tetapi **bukan** bukti otorisasi konteks: route wajib memeriksa penugasan pada Aktivitas/Sesi yang dipilih (`FR-100`, `FR-190`).

### Backfill agar operasi tidak berhenti

- Untuk setiap Tema, Petugas dengan `event_memberships.status = 'active'` dipetakan ke penugasan level Aktivitas pada setiap Aktivitas **Attendance** yang `status = 'active'` di Tema itu.
- Bila Tema belum punya Aktivitas, migrasi Q5 membuat Aktivitas default (arahan pemilik, ADR-0018) lalu menetapkan penugasan pada Aktivitas default itu.
- `can_manual_check_in = 0` untuk semua hasil backfill: Admin Acara harus mengaktifkannya secara eksplisit (`FR-073`), dan kemampuan itu baru punya endpoint/UI pada Q6.
- Jumlah baris backfill dicatat di `docs/DESAIN_DATABASE.md` dan `docs/OPERASIONAL.md`.

### Batas Q5 vs Q6

- **Q5:** tabel, trigger, backfill, penegakan otorisasi di route scan/manual. Tidak ada endpoint pengelolaan penugasan.
- **Q6:** endpoint/UI penugasan, pemilihan konteks di scanner, pesan feedback berbasis penugasan (`FR-099`–`FR-105`, `D-012`).

Konsekuensi jujur: sampai Q6 selesai, Petugas tidak dapat diaktifkan untuk Manual Check-in karena belum ada cara mengubah flag. Q5 hanya memastikan aturannya benar dan teruji.

## Konsekuensi

- Scan dan Manual Entry tidak lagi bergantung pada keanggotaan acara saja; URL tidak memberi akses.
- Dua aksi izin baru memisahkan source manual dari koreksi; `attendance:correct` tidak lagi dipakai sebagai jalan pintas.
- Satu tabel + dua index + trigger konteks menambah biaya tulis kecil saat pengelolaan penugasan (bukan jalur scan); lookup otorisasi scan menjadi satu query tambahan terindeks.
- Backfill membership → penugasan menjaga operasi tetap jalan, tetapi memberi Petugas lama akses ke seluruh Aktivitas Attendance yang aktif pada Temanya sampai Q6 mempersempit.
- Super Admin kehilangan akses transaksional yang sebelumnya dimiliki secara implisit; perubahan perilaku ini disetujui pemilik 9 November 2026.
- Pencabutan penugasan tidak menghapus akses historis; laporan tetap utuh.

## Butir yang disetujui pemilik

Disetujui seluruhnya 9 November 2026. Butir QR scan Super Admin diputuskan **tidak boleh** (hanya baca transaksi/audit lintas Tema).

- [x] Opsi B dan bentuk `staff_assignments`.
- [x] Semantik "Aktivitas mencakup semua Sesi"; izin manual mengikuti penugasan paling spesifik.
- [x] `OQ-034` [A] ditegakkan: Super Admin **tidak** boleh Manual Check-in.
- [x] Super Admin **tidak** boleh melakukan QR scan transaksional; hanya baca transaksi/audit lintas Tema (`FR-097`).
- [x] Backfill penugasan dari `event_memberships` dengan `can_manual_check_in = 0`.
- [x] `attendance:correct` dihapus setelah route lama diganti; tidak pernah dipakai untuk Manual Check-in.
- [x] Kemampuan Manual Check-in Petugas baru dapat diaktifkan pada Q6.

## Referensi

- `docs/REQUIREMENTS.md` §4.10 (`FR-073`, `FR-074`), §4.13 (`FR-097`–`FR-106`), §5 (`BR-034`, `BR-050`–`BR-053`), §9 (`AC-021`, `AC-049`, `AC-055`), §11 (`OQ-034`), §12 (`D-012`, `D-022`, `D-024`).
- `docs/ARCHITECTURE.md` §5.3, §6 AQ-007.
- `apps/api/src/domain/permissions.ts`, `apps/api/src/http/auth.ts`, `apps/api/src/routes/scan.ts`, `apps/api/src/routes/attendance.ts`.
- `migrations/0002_auth.sql` (`event_memberships`), `migrations/0007_q1_activities_sessions.sql`.
- ADR-0018, ADR-0019, ADR-0022.
