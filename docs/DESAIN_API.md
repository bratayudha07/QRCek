# DESAIN API — Worker (`apps/api`)

Semua endpoint di bawah `/api`. Otentikasi memakai cookie sesi `HttpOnly` (same-origin, ADR-001/ADR-002).

Sumber kebenaran kontrak: skema zod di `packages/shared/src/schemas/`. Dokumen ini menjelaskan **perilaku**, bukan menggantikan skema.

---

## 1. Konvensi umum

### Format respons

```jsonc
// sukses
{ "ok": true, "data": { /* ... */ } }

// gagal
{ "ok": false, "error": { "code": "FORBIDDEN", "message": "Anda bukan admin acara ini", "details": {} } }
```

`message` berbahasa Indonesia (ditampilkan ke pengguna). `code` berbahasa Inggris (dipakai program).

### Kode error

| HTTP | `code` | Kapan |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body/query gagal validasi zod; `details.fieldErrors` berisi per-field |
| 401 | `UNAUTHENTICATED` | Tidak ada sesi / sesi kedaluwarsa / dicabut |
| 403 | `FORBIDDEN` | Terautentikasi tapi tidak berwenang |
| 403 | `CSRF_FAILED` | Header `X-Absensi-Csrf` hilang atau `Origin` tidak cocok |
| 404 | `NOT_FOUND` | Resource tidak ada **atau** bukan milik acara yang diakses |
| 409 | `CONFLICT` | Pelanggaran constraint yang bukan hasil bisnis normal |
| 413 | `PAYLOAD_TOO_LARGE` | Upload melebihi batas |
| 422 | `BUSINESS_RULE` | Aturan bisnis menolak (mis. acara sudah diarsipkan) |
| 429 | `RATE_LIMITED` | Kuota per-bucket habis; `Retry-After` disertakan |
| 500 | `INTERNAL` | Bug; tidak pernah membocorkan stack trace |
| 503 | `DB_UNAVAILABLE` | D1 mengembalikan error overload/kuota |

### Header wajib

| Header | Untuk | Nilai |
|---|---|---|
| `Cookie` | Otentikasi | `absensi_session=<token>` |
| `X-Absensi-Csrf` | Semua non-GET | `1` |
| `Origin` | Semua non-GET | Harus sama dengan `Host` |
| `Idempotency-Key` | Opsional, `POST /scan` | ULID dari klien untuk pengamatan/diagnostik |

### Paginasi

Kursor, bukan offset:

```
GET /api/events/:id/participants?limit=50&cursor=<opaque>
→ { ok: true, data: { items: [...], nextCursor: "..." | null } }
```

`limit` maksimum 100, default 50. Kursor = `base64url(created_at + ":" + id)`.

### Otorisasi

Dievaluasi di middleware, sebelum handler, untuk **setiap** route. Tidak ada route yang "sudah pasti aman".

| Peran | Cakupan |
|---|---|
| `superadmin` | Semua acara, semua operasi kecuali koreksi absensi (lihat catatan) |
| `event_admin` | Satu acara: kelola peserta, undangan, koreksi absensi, konfigurasi sync |
| `officer` | Satu acara: **hanya** scan dan melihat rekap ringkas miliknya |

Catatan: `superadmin` boleh melakukan koreksi absensi, tetapi tetap wajib mengisi `reason` dan tetap tercatat di audit.

**Aturan 403 vs 404 (diterapkan sejak Tahap 2).** Untuk resource milik acara:

| Kondisi | Respons |
|---|---|
| Pemanggil bukan anggota acara itu (dan bukan superadmin) | **404** — jangan mengonfirmasi bahwa acara milik orang lain ada |
| Pemanggil anggota, tetapi peran membership-nya kurang | **403** — jujur dan bisa ditindaklanjuti |
| Acara tidak ada | **404** |

`GET /api/auth/me` mengembalikan `memberships` = keanggotaan eksplisit saja. Superadmin
tidak punya baris membership untuk acara yang belum ia masuki; haknya berasal dari
`user.role`, bukan dari daftar itu.

---

## 2. Autentikasi

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `POST` | `/api/auth/activate` | publik | Tukar token undangan menjadi sesi |
| `POST` | `/api/auth/recover` | publik | Tukar kode pemulihan menjadi sesi baru |
| `GET` | `/api/auth/me` | semua | Profil + daftar acara yang boleh diakses |
| `POST` | `/api/auth/logout` | semua | Cabut sesi aktif |
| `GET` | `/api/auth/sessions` | semua | Daftar perangkat aktif |
| `POST` | `/api/auth/sessions/:id/revoke` | pemilik | Cabut satu sesi |
| `POST` | `/api/auth/recovery-code` | semua | Terbitkan kode pemulihan baru (kode lama hangus) |

### `POST /api/auth/activate`

```jsonc
// request
{ "token": "<128-bit base64url>", "label": "HP Android" }

// 200
{
  "ok": true,
  "data": {
    "user": { "id": "01J...", "displayName": "Budi", "role": "officer" },
    "memberships": [{ "eventId": "01J...", "eventName": "Wisuda 2026", "role": "officer" }],
    "recoveryCode": "ABCD-EFGH-IJKL-MNOP"   // ditampilkan SEKALI
  }
}
```

Perilaku:
- Token tidak valid/kedaluwarsa/sudah dipakai → `401 UNAUTHENTICATED` (pesan disamakan untuk ketiga kasus, agar tidak memberi tahu penyerang status token).
- Sukses → `Set-Cookie` sesi 30 hari + semua penulisan dalam satu `db.batch()`.
- Login tidak memicu pembuatan ulang kode pemulihan; hanya `POST /auth/recovery-code` yang melakukannya.

### `POST /api/auth/recover`

```jsonc
{ "recoveryCode": "ABCD-EFGH-IJKL-MNOP", "label": "HP baru" }
```

- Mencabut **semua** kredensial dan sesi lama milik user (perangkat hilang = perangkat tidak tepercaya lagi).
- Menerbitkan kode pemulihan baru, ditampilkan sekali.
- Rate limit ketat: 5 percobaan / 15 menit per IP-hash.

---

## 3. Acara

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/api/events` | semua | Hanya acara yang boleh diakses pemanggil |
| `POST` | `/api/events` | superadmin | Buat acara |
| `GET` | `/api/events/:id` | anggota acara | Detail |
| `PATCH` | `/api/events/:id` | event_admin, superadmin | Nama, jadwal, timezone, `allow_manual` |
| `POST` | `/api/events/:id/status` | event_admin, superadmin | `draft → active → closed → archived` |
| `GET` | `/api/events/:id/summary` | anggota acara | Angka ringkas untuk dashboard |

Transisi status yang sah (divalidasi di `domain/event-status.ts`):

```
draft    → active
active   → closed
closed   → active        (buka kembali, tercatat di audit)
closed   → archived
active   → archived      (harus ditutup dulu; API menolak langsung)
archived → (final, tidak ada transisi)
```

`archived` bersifat final karena dipakai sebagai penanda aman untuk pengarsipan data.

---

## 4. Anggota dan undangan

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/api/events/:id/members` | event_admin, superadmin | Daftar admin/petugas |
| `POST` | `/api/events/:id/invites` | event_admin, superadmin | Terbitkan undangan |
| `GET` | `/api/events/:id/invites` | event_admin, superadmin | Riwayat + status |
| `DELETE` | `/api/events/:id/invites/:inviteId` | event_admin, superadmin | Batalkan undangan yang belum dipakai |
| `POST` | `/api/events/:id/members/:userId/revoke` | event_admin, superadmin | Cabut akses (sesi + kredensial dicabut) |

### `POST /api/events/:id/invites`

```jsonc
// request
{ "role": "officer", "invitedName": "Budi", "expiresInHours": 72 }

// 201
{
  "ok": true,
  "data": {
    "inviteId": "01J...",
    "token": "<sekali tampil>",
    "activatePath": "/aktivasi#t=<token>",
    "expiresAt": 1730000000000
  }
}
```

- `expiresInHours` default 72, maksimum 168.
- `token` **tidak pernah** bisa diambil ulang; hanya hash yang tersimpan.
- Klien merender QR dari URL absolut yang disusun sendiri: `location.origin + activatePath`.
  Worker tidak mengembalikan URL absolut karena hostname publik di balik proxy/custom domain
  tidak dapat diketahui dengan andal dari request.
- Token berada di fragment (`#`) agar tidak masuk log akses.
- Batas: 50 undangan aktif per acara (mencegah penyalahgunaan).

---

## 5. Peserta

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/api/events/:id/participants` | anggota acara | Cari (`?query=`) + paginasi |
| `POST` | `/api/events/:id/participants` | event_admin | Tambah satu peserta |
| `PATCH` | `/api/participants/:id` | event_admin | Ubah data (tidak mengubah QR) |
| `POST` | `/api/participants/:id/qr/rotate` | event_admin | Terbitkan token QR baru |
| `DELETE` | `/api/participants/:id` | event_admin | Soft-delete (`status = 'inactive'`) |
| `POST` | `/api/events/:id/participants/import` | event_admin | Import CSV |
| `GET` | `/api/events/:id/qr-labels` | event_admin | Data untuk halaman cetak QR |

### `POST /api/events/:id/participants/import`

Content-Type: `text/csv` (body mentah) atau `application/json` dengan `{ "csv": "..." }`.

Query: `?dry_run=true|false` (default `false`).

Batas: **2 MB** dan **5.000 baris** per request.

```jsonc
// 200 (dry_run = true)
{
  "ok": true,
  "data": {
    "dryRun": true,
    "total": 120,
    "valid": 118,
    "created": 0,
    "updated": 0,
    "invalid": [
      { "line": 7, "reason": "full_name wajib diisi" },
      { "line": 44, "reason": "external_ref duplikat di dalam file" }
    ]
  }
}
```

Kolom CSV (header wajib, urutan bebas):

| Kolom | Wajib | Aturan |
|---|---|---|
| `full_name` | ya | 1–120 karakter |
| `external_ref` | tidak | Unik per acara; dipakai untuk idempotensi |
| `phone` | tidak | Dinormalisasi ke `+62...` |
| `email` | tidak | Validasi format sederhana |
| `category` | tidak | Maks 60 karakter |
| `note` | tidak | Maks 500 karakter |

Batasan yang disengaja: **tidak ada** kolom `qr_token` di CSV. QR selalu dibuat server, sehingga tidak mungkin ada dua peserta dengan token yang sama karena input.

Perilaku eksekusi:
- Baris valid ditulis dalam batch 200.
- `external_ref` yang sudah ada → `UPDATE` (idempoten), bukan error.
- Baris tidak valid tidak ditulis; pelaporan per nomor baris.
- Acara `archived` → `422 BUSINESS_RULE`.
- Lebih dari 5.000 baris → `413` dengan pesan yang meminta memecah file.

### `GET /api/events/:id/qr-labels`

```jsonc
// 200
{ "ok": true, "data": { "eventName": "...", "labels": [
  { "participantId": "01J...", "fullName": "Budi", "qr": "absensi:v1:<token>" }
] } }
```

Token di sini **adalah** token asli — endpoint ini hanya boleh diakses `event_admin`, dan setiap pemanggilan dicatat di audit (`qr.labels_exported`) karena ini satu-satunya jalur yang membocorkan token dalam jumlah banyak. Rendering QR di browser; cetak lewat `window.print()`.

---

## 6. Pemindaian dan absensi

### `POST /api/events/:id/scan`

Peran: `officer`, `event_admin`, `superadmin` (anggota acara).

```jsonc
// request
{ "qr": "absensi:v1:<token>", "deviceTs": 1730000000000 }

// 200 — selalu 200 untuk hasil bisnis
{
  "ok": true,
  "data": {
    "result": "present",            // present | duplicate | not_found | wrong_event
                                    // | event_closed | participant_inactive
    "participant": { "id": "01J...", "fullName": "Budi", "category": "Kelas 5A" },
    "attendance": { "status": "present", "checkedInAt": 1730000000123 }
  }
}
```

| `result` | Arti | Data yang dikembalikan |
|---|---|---|
| `present` | Absensi baru tercatat | `participant` + `attendance` |
| `duplicate` | Sudah pernah absen | `participant` + `attendance` **yang sudah ada** |
| `not_found` | Token tidak dikenal | tidak ada |
| `wrong_event` | Token milik acara lain | tidak ada; dicatat di audit |
| `event_closed` | Di luar jendela waktu / status bukan `active` | nama acara |
| `participant_inactive` | Peserta dinonaktifkan | `participant` |

`deviceTs` hanya **dicatat** untuk analisis selisih jam, **tidak dipakai** sebagai waktu absensi. Waktu resmi selalu dari server (UTC).

Batas laju: 120 scan/menit per sesi, 600/menit per acara. Kelebihan → `429` dengan `Retry-After`.

Biaya query: 1 (sesi+membership) + 1 (peserta) + 1 batch (insert/outbox/audit) + 1 (baca ulang absensi saat `duplicate`) = **≤ 4 statement**, jauh di bawah batas 50 per invokasi.

### `GET /api/events/:id/attendance`

Query: `?status=&query=&limit=&cursor=`

```jsonc
{ "ok": true, "data": { "items": [
  { "attendanceId": "01J...", "participantId": "01J...", "fullName": "Budi",
    "category": "Kelas 5A", "status": "present",
    "checkedInAt": 1730000000123, "method": "qr_scan", "recordedBy": "01J..." }
], "nextCursor": null } }
```

### `POST /api/attendance/:id/correction`

Peran: `event_admin`, `superadmin`. **`officer` selalu ditolak.**

```jsonc
// request
{ "status": "excused", "reason": "Surat izin dokter diterima panitia" }

// 200
{ "ok": true, "data": { "attendanceId": "01J...", "status": "excused", "updatedAt": 173... } }
```

- `reason` wajib, 10–500 karakter.
- Satu `db.batch()`: `UPDATE attendance`, `INSERT audit_log` (`attendance.corrected` dengan `before`/`after`), upsert `outbox`.
- Jika baris berubah bersamaan (optimistic check via `updated_at`), kembalikan `409 CONFLICT` agar admin memuat ulang — lebih baik gagal terang-terangan daripada menimpa koreksi orang lain.

### `POST /api/events/:id/attendance/manual`

Peran: `event_admin`. Hanya jika `events.allow_manual = 1`.

Dipakai sebagai fallback saat HP petugas tidak bisa memindai (mis. QR rusak). Tetap memakai constraint unik yang sama.

---

## 7. Audit

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/api/events/:id/audit` | event_admin, superadmin | Filter `action`, `actorId`, rentang waktu |
| `GET` | `/api/events/:id/audit/:auditId` | event_admin, superadmin | Detail `before`/`after` |

Tidak ada endpoint `PATCH`/`DELETE`. Permintaan semacam itu tidak didaftarkan sama sekali di router, sehingga dijawab `404` oleh router default.

---

## 8. Sinkronisasi Google Sheets

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/api/events/:id/sync` | event_admin | Konfigurasi + status |
| `PUT` | `/api/events/:id/sync` | event_admin | Set `spreadsheetId`, `sheetTab`, `syncEnabled` |
| `POST` | `/api/events/:id/sync/test` | event_admin | Uji kredensial & akses tulis (menulis 1 sel metadata) |
| `POST` | `/api/events/:id/sync/full` | event_admin | Full resync (bangun ulang `sheet_rows`) |
| `POST` | `/api/events/:id/sync/run` | event_admin | Dorong antrean sekarang (tanpa menunggu cron) |
| `GET` | `/api/events/:id/sync/outbox` | event_admin | Item `failed`/`dead` + error terakhir |
| `POST` | `/api/events/:id/sync/outbox/:outboxId/retry` | event_admin | Reset ke `pending` |

```jsonc
// GET /api/events/:id/sync → 200
{
  "ok": true,
  "data": {
    "spreadsheetId": "1AbC...",
    "sheetTab": "Kehadiran",
    "syncEnabled": true,
    "serviceAccountEmail": "absensi-sync@<project>.iam.gserviceaccount.com",
    "pending": 3,
    "failed": 0,
    "dead": 1,
    "lastFullSyncAt": 1729990000000,
    "lastError": null
  }
}
```

`serviceAccountEmail` ditampilkan di sini supaya admin bisa melakukan langkah manual (share spreadsheet sebagai Editor) tanpa membuka dokumentasi.

Batas laju: `POST /sync/run` 1×/menit per acara (mencegah admin menekan tombol berulang dan membakar kuota Sheets).

---

## 9. Kesehatan dan operasional

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/api/health` | publik | `{ ok: true }` — tidak menyentuh DB |
| `GET` | `/api/health/ready` | publik | Cek `SELECT 1` ke D1; dipakai monitoring eksternal |
| `GET` | `/api/admin/usage` | superadmin | Perkiraan pemakaian (baris baca/tulis) + ukuran DB |

`/api/admin/usage` tidak melakukan query mahal; ia memakai angka dari `meta` yang dikumpulkan pada request sebelumnya dan disimpan di `rate_limits`/tabel metrik ringan ⚠️ (desain detail ditunda ke Fase 6).

---

## 10. Rate limiting (tanpa layanan berbayar)

Berbasis tabel `rate_limits` dengan jendela tetap.

| Bucket | Batas |
|---|---|
| `auth:activate:<ipHash>` | 10 / 15 menit |
| `auth:recover:<ipHash>` | 5 / 15 menit |
| `scan:<sessionId>` | 120 / menit |
| `scan:<eventId>` | 600 / menit |
| `import:<eventId>` | 5 / jam |
| `sync:run:<eventId>` | 1 / menit |

Implementasi: satu `INSERT ... ON CONFLICT DO UPDATE SET counter = counter + 1 RETURNING counter`
(dukungan `RETURNING` pada D1 sudah dikonfirmasi di Fase 0: `spike.returning.test.ts`).

Batasan yang disadari: jendela tetap bisa memberi hingga 2× batas di perbatasan jendela
(klasik fixed window). Untuk melindungi endpoint auth dari tebakan token, itu cukup — yang
dilindungi adalah percobaan berulang dalam jumlah besar, bukan burst presisi.

Pembersihan baris `rate_limits` lama dilakukan oleh cron yang sama dengan sync (jendela lebih dari 1 jam dihapus).

---

## 11. Cron

```ts
export default {
  fetch(request, env, ctx) { /* router */ },
  async scheduled(controller, env, ctx) { /* lihat di bawah */ },
};
```

Satu cron (`*/5 * * * *`) menjalankan tiga tugas berurutan, masing-masing dibatasi:

1. **Sync outbox** — maksimum 5 item (lihat `DESAIN_DATABASE.md` §6).
2. **Reklaim item macet** — item `inflight` dengan `claimed_at` lebih dari 10 menit → `failed` + `attempts + 1`.
3. **Housekeeping** — hapus `outbox.done` > 7 hari, `sessions` kedaluwarsa, `rate_limits` > 1 jam. Dibatasi 500 baris per kategori per siklus ✅ (mematuhi batas 100k baris tulis/hari dengan margin lebar).

Cron harus **selalu selesai** walaupun salah satu tugas gagal; kegagalan dicatat, tidak melempar keluar dari handler.

---

## 12. Hal yang perlu diverifikasi

Status per akhir Tahap 2.

| ⚠️ | Yang perlu dibuktikan | Status |
|---|---|---|
| 1 | `RETURNING` didukung D1 untuk `INSERT ... ON CONFLICT` (dipakai di counter rate limit) | **TERVERIFIKASI** — `spike.returning.test.ts`, dipakai `db/rate-limit.ts` |
| 2 | Perilaku `Set-Cookie` pada respons Worker dengan Static Assets tidak terpotong | **TERVERIFIKASI LOKAL** — `wrangler dev` mengembalikan `Set-Cookie: absensi_session=…; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`. Belum diuji di deployment nyata |
| 3 | Middleware `Origin`/`Host` benar untuk request di balik custom domain | **BELUM** — butuh deployment. `ALLOWED_ORIGINS` disediakan sebagai jalan keluar bila origin browser ≠ URL Worker |
| 4 | Content-Type `text/csv` terbaca dengan benar oleh `request.text()` pada Worker | **BELUM** — Fase 2 |
| 5 | Token di fragment (`#`) tidak terkirim ke server pada navigasi pertama | **TERVERIFIKASI (sifat browser)** — halaman `/aktivasi` membaca `location.hash`, dan `readInviteToken` hanya menerima fragmen. Tidak ada request yang membawa token |
| 6 | Rate limit tidak memblokir pengguna sah di balik NAT bersama | **BELUM** — batas 10/15 menit per IP-hash; perlu diamati di produksi |
| 7 | Cookie `Secure` benar-benar dipasang di HTTPS | **BELUM** — kode menambahkan `Secure` saat `request.url` https; hanya teruji di `workerd` lokal |
