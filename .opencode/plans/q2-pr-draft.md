# Q2 PR / review notes

Dokumen kerja untuk pemilik proyek. Bukan pengganti `docs/REQUIREMENTS.md` atau roadmap.

## Ringkasan

- **Branch:** `q1-foundation`
- **Head Q2:** `b18989c` — `feat(q2): add categories, custom fields, and participant attributes`
- **Base:** `main` (`ae5737b`)
- **Isi PR:** Q1, Q2 (`b18989c`), dokumentasi deploy Workers Builds, dan draf ADR-0016. `main` belum memiliki Q1.
- **Sifat Q2:** API-only. Tidak ada UI kategori/custom field/atribut; web tetap kompilasi.

Kalau Q1 dan Q2 ingin direview terpisah, merge Q1 lebih dulu (branch ini sudah berisi Q1), lalu buka PR Q2 dari commit setelahnya. Kalau tidak, satu PR mencakup keduanya dan reviewer perlu melihat dua tahap roadmap.

## Yang berubah di Q2

### Skema

`migrations/0008_q2_categories_custom_fields.sql` (additive; `0001`–`0007` tidak diedit):

- `categories`: entitas per Tema, nama unik `COLLATE NOCASE`, status `active`/`archived`.
- `custom_fields`: katalog per Tema, 9 tipe, `scope` `participant`/`activity`, `options_json`, status arsip.
- `participants.category_id` + `participants.attributes_json`; `category_id` wajib ditegakkan trigger, bukan hanya kode.
- `participants.category` lama dipertahankan sebagai mirror tampilan yang dijaga trigger; sumber kebenaran adalah `category_id`.
- Backfill kategori dari teks lama dan bucket `Tanpa Kategori` untuk baris lama tanpa kategori.
- Trigger konteks: kategori wajib, kategori harus satu Tema, mirror nama kategori, rename kategori memperbarui mirror.

### API

- `GET/POST /api/events/:eventId/categories`
- `GET/PATCH /api/events/:eventId/categories/:categoryId`
- `POST /api/events/:eventId/categories/:categoryId/status`
- `GET/POST /api/events/:eventId/custom-fields`
- `GET/PATCH /api/events/:eventId/custom-fields/:fieldId`
- `POST /api/events/:eventId/custom-fields/:fieldId/status`
- `POST /api/events/:eventId/custom-fields/:fieldId/type`
- Peserta: create/update menerima `categoryId` kanonik, `attributes` tervalidasi tipe; input nama `category` lama masih diterima (deprecated).
- Impor CSV: header + nilai kategori wajib; nama kategori tak dikenal ditolak per baris, **tidak** auto-create.

Semua route Tema juga mendapat alias `/api/calendar` dan `/api/themes` yang sudah ada.

### Logika murni dan validasi

- `packages/shared/src/participant-attributes.ts`: validasi tipe, merge parsial, ubah tipe, koersi CSV, aturan tanggal `YYYY-MM-DD`.
- `packages/shared/src/schemas/{categories,custom-fields,participants}.ts`: skema runtime boundary.
- Batas bisnis: 50 field aktif per Tema, 100 opsi per field `select`/`multi_select`; pelanggaran → `422 BUSINESS_RULE`.
- Field `archived` tidak menerima nilai baru; nilai lama tetap terbaca.
- `required` ditegakkan saat create dan saat nilai dikirim; update parsial tidak memaksa field required lama diisi ulang.

### Audit

- `category.*`, `custom_field.*`, `participant.*` ditulis dalam `db.batch()` yang sama dengan mutasi.
- Snapshot hanya field allowlist + daftar key atribut yang berubah; tidak ada nilai atribut, `options_json`, nama/email/telepon, atau token.
- Guard `updated_at` mencegah audit ditulis bila mutasi kalah balapan.

## Bukti verifikasi Q2

Dijalankan di `b18989c`, diulang setelah perubahan dokumentasi deploy:

| Perintah | Hasil |
|---|---|
| `npm run typecheck` | lulus |
| `npm run lint` | lulus |
| `npm run test` | 587 tes / 57 file lulus |
| `npm run build` | lulus |

Tes baru/berubah:

- `packages/shared/src/participant-attributes.test.ts`
- `apps/api/src/test/categories.api.test.ts`
- `apps/api/src/test/custom-fields.api.test.ts`
- `apps/api/src/test/participant-attributes.api.test.ts`
- `apps/api/src/test/participants.import.test.ts`
- `apps/api/src/test/audit.guarded-write.test.ts`

Uji mutasi Q2 (enam guard inti) semuanya tertangkap; detail di `.opencode/plans/q2-peserta-kategori-impor.md` §16.

## Checklist review

### Integritas dan keamanan

- [ ] `category_id` wajib dan tidak bisa lintas Tema; trigger menolak, bukan hanya validator.
- [ ] Impor tanpa header/nilai kategori ditolak seluruhnya; kategori tak dikenal tidak dibuat otomatis.
- [ ] `PATCH` peserta tidak bisa mengosongkan kategori (`category: null` diabaikan).
- [ ] Client tidak bisa mengirim `id` peserta; ID dibuat server.
- [ ] Nilai custom field `archived` ditolak pada create dan patch; nilai lama tidak dihapus.
- [ ] Perubahan tipe field yang tidak kompatibel ditolak `422`, bukan memotong data.
- [ ] Tidak ada PII/nilai atribut/`options_json` di audit atau log.
- [ ] Semua route memakai otorisasi Tema yang sama dengan route Q1; bukan hanya "sudah login".

### Perilaku

- [ ] Rename/nonaktif/arsip kategori tidak menghapus peserta atau transaksi.
- [ ] Rename kategori memperbarui mirror `participants.category` tanpa write kedua dari aplikasi.
- [ ] `required` tidak memblokir update parsial peserta lama.
- [ ] CSV kosong tidak menghapus nilai lama (`BR-077`).
- [ ] Batas 50 field/100 opsi menghasilkan pesan actionable.
- [ ] Tanggal non-ISO ditolak; tanggal ISO disimpan sebagai ms epoch UTC.

### Dokumen

- [ ] `docs/DESAIN_DATABASE.md` memuat `0008`, indeks, trigger, dan status `schema_version`.
- [ ] `docs/DESAIN_API.md` memuat route kategori/custom field dan kontrak peserta baru.
- [ ] `docs/RENCANA_PENGUJIAN.md` memuat tes wajib Q2 dan snapshot 587 tes.
- [ ] `docs/IMPLEMENTATION_ROADMAP.md` Q2 mencatat "kode selesai, migrasi remote belum".
- [ ] Tidak ada klaim UI Q2 selesai; UI masuk Q9.

## Urutan rilis (wajib)

`0008` **tidak boleh** diterapkan ke remote sendirian. Setelah migrasi aktif, trigger menolak `INSERT` peserta tanpa `category_id`, sedangkan Worker Q1 yang masih live menulis peserta tanpa kolom itu.

1. Pastikan Q2 sudah direview dan siap merge.
2. Verifikasi lokal hijau. Workers Builds hanya build + deploy, bukan test suite.
3. Pastikan Workers Builds diarahkan ke repo, branch `main`, build command `npm ci && npm run build`, dan deploy command `npx wrangler deploy --config apps/api/wrangler.jsonc` (lihat README).
4. Ambil backup remote dari `apps/api`:
   ```bash
   npx wrangler d1 export absensi-db --remote \
     --output /tmp/opencode/qrcek-backup-<tanggal>.sql
   ```
5. Merge Q2 ke `main`. Workers Builds mulai build Q2.
6. Segera setelah merge, terapkan migrasi dari `apps/api` sambil build berjalan:
   ```bash
   npx wrangler d1 migrations apply absensi-db --remote
   npx wrangler deploy
   ```
   Rilis `0008` ini adalah **satu-satunya** rilis manual yang disengaja: migrasi dan kode harus
   berdekatan. `wrangler deploy` lokal yang selesai lebih dulu aman karena kodenya sama dengan
   yang sedang dibuild Workers Builds.
7. Tunggu build Workers Builds hijau dan verifikasi `/api/health`, `/api/health/ready`, dan security headers.

Catatan: setelah skema `0008` aktif dan kode Q2 live, rilis berikutnya cukup lewat Workers Builds otomatis. Migrasi D1 tetap manual dan tidak ikut build.

## Bukan cakupan Q2

- UI kategori, custom field, dan atribut peserta (Q9).
- Nilai custom field per Aktivitas/Sesi (Q3).
- Entitlement dan resolver (Q3; menunggu AQ-005).
- Perubahan pada `attendance`/scan (Q5).
- Migrasi remote `0008` tanpa persetujuan pemilik.

## Risiko yang perlu diputuskan reviewer

1. **Mirror `participants.category`** tetap ada. Ini kompatibilitas, bukan model target. Menghapusnya perlu migrasi dan penyesuaian UI Q1.
2. **Nama kategori deprecated pada single create/update** membuat kategori baru secara implisit, sedangkan impor CSV tidak. Ini disengaja: admin mengetik nama secara eksplisit di form, sedangkan CSV tidak boleh menulis data yang tidak diminta. Reviewer perlu memastikan perbedaan ini dapat diterima.
3. **Batas 50/100 ditegakkan di Worker**, bukan database. Perubahan batas nanti tidak perlu migrasi, tetapi dua jalur tulis (single dan impor) harus memakai validator yang sama.
4. **`0008` mengubah kontrak tulis peserta.** Rollback kode saja tidak cukup setelah migrasi; rollback skema memerlukan restore backup karena migrasi D1 tidak otomatis reversible.
