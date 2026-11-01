-- ADR-007 — pendaftaran mandiri untuk admin acara.
--
-- Satu-satunya perubahan skema: asal-usul akun dicatat supaya audit dan
-- operasional bisa membedakan akun hasil seed, undangan, dan daftar sendiri.
-- Tidak ada kolom identitas baru: email tetap opsional dan tidak pernah
-- dipercaya sebagai bukti identitas (tidak ada verifikasi email di sistem ini).
--
-- Migrasi ini aditif: `ALTER TABLE ... ADD COLUMN` dengan DEFAULT, sehingga
-- baris lama otomatis menjadi 'invite' tanpa penulisan ulang tabel.

ALTER TABLE users ADD COLUMN created_via TEXT NOT NULL DEFAULT 'invite'
  CHECK (created_via IN ('seed', 'invite', 'self_signup'));

-- Membaca "berapa akun mendaftar sendiri minggu ini" tidak boleh memindai
-- seluruh tabel users.
CREATE INDEX idx_users_created_via ON users(created_via, created_at);

-- ───────────────────────────────────────────── housekeeping marker
UPDATE app_meta
   SET value = '6',
       updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
 WHERE key = 'schema_version';
