# DESAIN API — Worker (`apps/api`)

Semua endpoint di bawah `/api`. Otentikasi memakai cookie sesi `HttpOnly` (same-origin, [ADR-0001](./adr/0001-single-worker-same-origin.md)/[ADR-0002](./adr/0002-passwordless-token-auth.md)).

Sumber kebenaran kontrak: skema zod di `packages/shared/src/schemas/`. Dokumen ini menjelaskan **perilaku**, bukan menggantikan skema.

> **Status dokumen (9 November 2026).** Dokumen ini mencatat **API aktual**: baseline `157c330` ditambah Q1 (Aktivitas/Sesi), Q2 (kategori, custom field, atribut peserta, impor ber-kategori), Q3 (konfigurasi entitlement), dan Q4 (QR Identity per Tema: lookup scan, rotasi, metadata), semuanya API-only; registrasi publik dihapus. Jumlahnya **85 definisi route** dan **231 pola efektif** setelah alias `/api/calendar` dan `/api/themes` (`73` definisi ber-prefix `/api/events` × 3). Rendering PNG/ZIP untuk unduh berada di Q9, bukan di Q4. API target untuk konsumsi, koreksi Reversal/Adjustment, dan scanner berkonteks **belum ada**; bentuk payload-nya diputuskan lewat AQ di [`ARCHITECTURE.md`](./ARCHITECTURE.md) §6 dan ditambahkan ke dokumen ini bersama route-nya. Endpoint yang tercantum di sini bukan bukti bahwa kebutuhan produk terpenuhi (`FR-178`). Bagian yang bertentangan dengan keputusan produk `[A]` ditandai **Delta**.

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
GET /api/calendar/:eventId/participants?limit=25&cursor=<opaque>
→ { ok: true, data: { items: [...], nextCursor: "..." | null } }
```

`limit` maksimum 100, default 25. Kursor = `base64url(created_at + ":" + id)`.

### Otorisasi

Dievaluasi di middleware, sebelum handler, untuk **setiap** route. Tidak ada route yang "sudah pasti aman".

| Peran | Cakupan |
|---|---|
| `superadmin` | Semua acara dan semua operasi, termasuk koreksi absensi (lihat catatan) |
| `event_admin` | Satu acara: kelola peserta, undangan, koreksi absensi, konfigurasi sync |
| `officer` | Satu acara: **hanya** scan dan melihat rekap ringkas miliknya |

Catatan baseline: `superadmin` lolos semua pemeriksaan izin di `domain/permissions.ts`, sehingga ia dapat melakukan koreksi absensi (wajib `reason`, tercatat di audit).

> **Delta:** `D-006` [A] menetapkan Reversal/Adjustment **hanya** oleh Admin Acara; Super Admin tidak termasuk koreksi (`D-024` [A]; rekomendasi: Super Admin hanya melihat). Jangan memperluas perilaku baseline ini; perubahan dilakukan di roadmap Q5 setelah `D-024` diputuskan.

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

### `POST /api/auth/register` — dihapus

Tidak ada lagi pendaftaran mandiri. Route ini **tidak terdaftar**, sehingga permintaan ke
`/api/auth/register` menghasilkan `404 NOT_FOUND` dari router API — bukan `403`, bukan
endpoint di balik flag, dan tidak ada baris `users`/`sessions`/`recovery_codes` yang dibuat
(ADR-0013, `D-018` [A], `AC-050`). Akun Admin Acara hanya lahir dari aktivasi undangan
Super Admin (`POST /api/auth/activate`). Turnstile ikut dihapus dari Worker, skema, dan CSP;
tidak ada `TURNSTILE_SECRET_KEY`.

---

## 3. Acara

Untuk request dari browser, gunakan prefix `/api/calendar` (mis. `GET /api/calendar`). Worker mengarahkannya ke handler acara yang sama. Mulai Q1, `/api/themes` juga tersedia sebagai alias eksplisit nama model target (ADR-0009). Prefix lama `/api/events` tetap kanonik dan tetap berfungsi. Ketiga prefix memakai route, handler, skema, dan guard yang sama; alias hanya dihasilkan dari tabel route di `app.ts`. Penggantian nama path browser menghindari filter content blocker yang pada browser pengguna memblokir `/api/events` (terlihat sebagai “Blocked By uBlock Origin” di Network), sehingga kegagalan tersebut tidak menghasilkan request di Worker tail.

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/api/calendar` | semua | Hanya acara yang boleh diakses pemanggil |
| `POST` | `/api/calendar` | event_admin, superadmin | Buat acara (status awal `draft`); pembuat otomatis jadi `event_admin` acara itu |
| `GET` | `/api/calendar/:eventId` | anggota acara | Detail |
| `PATCH` | `/api/calendar/:eventId` | event_admin, superadmin | Nama, deskripsi, jadwal, timezone, `allow_manual` |
| `POST` | `/api/calendar/:eventId/status` | event_admin, superadmin | Transisi lifecycle |
| `GET` | `/api/calendar/:eventId/summary` | anggota acara | Hitungan peserta total/aktif/nonaktif |
| `DELETE` | `/api/calendar/:eventId` | superadmin | **Hanya** draf tanpa peserta dan tanpa Aktivitas; selain itu `422` |

`DELETE` sengaja sempit: hard delete hanya untuk draf kosong. Draf yang sudah punya peserta
atau Aktivitas, acara aktif, tertutup, dan terarsip ditolak dengan pesan yang mengarahkan ke
arsip. Kondisi diperiksa di SQL yang sama dengan `DELETE`, sehingga peserta/Aktivitas yang
masuk bersamaan tidak ikut terhapus.

Transisi status yang sah (satu sumber di `packages/shared`, ditegakkan Worker di
`domain/event-status.ts`):

```
draft    → active
active   → closed
closed   → active        (buka kembali)
closed   → archived
active   → archived      (harus ditutup dulu; API menolak langsung)
archived → (final, tidak ada transisi)
```

`archived` bersifat final karena dipakai sebagai penanda aman untuk pengarsipan data. Acara
`archived` menolak seluruh `PATCH`, perubahan status, dan mutasi peserta (`422 BUSINESS_RULE`).

Slug dibuat server: `slugify(name)` + 6 karakter terakhir id, sehingga unik tanpa retry loop.

---

## 4. Anggota dan undangan

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/api/calendar/:id/members` | event_admin, superadmin | Daftar admin/petugas |
| `POST` | `/api/calendar/:id/invites` | event_admin, superadmin | Terbitkan undangan |
| `GET` | `/api/calendar/:id/invites` | event_admin, superadmin | Riwayat + status |
| `DELETE` | `/api/calendar/:id/invites/:inviteId` | event_admin, superadmin | Batalkan undangan yang belum dipakai |
| `POST` | `/api/calendar/:id/members/:userId/revoke` | event_admin, superadmin | Cabut akses (sesi + kredensial dicabut) |

### `POST /api/calendar/:id/invites`

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

Semua endpoint peserta **event-scoped**. Tidak ada `/api/participants/:id` global: id acara
selalu ikut di URL, dan lookup di database menyertakan `event_id`, sehingga peserta acara B
yang dipakai lewat acara A menjadi `404 NOT_FOUND` (bukan `403`, agar keberadaan baris tidak
bocor).

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/api/calendar/:eventId/participants` | officer, event_admin, superadmin | Cari + filter + paginasi kursor |
| `POST` | `/api/calendar/:eventId/participants` | event_admin, superadmin | Tambah satu peserta |
| `GET` | `/api/calendar/:eventId/participants/:participantId` | officer+ | Detail |
| `PATCH` | `/api/calendar/:eventId/participants/:participantId` | event_admin, superadmin | Ubah data, termasuk mengaktifkan kembali |
| `DELETE` | `/api/calendar/:eventId/participants/:participantId` | event_admin, superadmin | Soft-delete, wajib `{ "confirm": true }` |
| `POST` | `/api/calendar/:eventId/participants/import` | event_admin, superadmin | Import CSV (pratinjau + konfirmasi) |
| `GET` | `/api/calendar/:eventId/participants/export` | event_admin, superadmin | Unduh CSV (PII) |
| `GET` | `/api/calendar/:eventId/participants/template` | event_admin, superadmin | Template header-only |
| `POST` | `/api/events/:eventId/participants/qr-labels` | event_admin, superadmin | Terbitkan/baca kredensial QR untuk label (POST karena bisa menulis) |
| `GET` | `/api/events/:eventId/participants/:participantId/qr` | event_admin, superadmin | Metadata identitas QR (tanpa token) |
| `PUT` | `/api/events/:eventId/participants/:participantId/qr/rotate` | event_admin, superadmin | Rotasi token QR; alasan wajib |
| `GET` | `/api/events/:eventId/label-config` | officer+ | Konfigurasi field label acara |
| `PUT` | `/api/events/:eventId/label-config` | event_admin, superadmin | Simpan field + urutan + nama acara |

### Daftar, pencarian, dan paginasi

```
GET /api/calendar/:eventId/participants?query=budi&status=active&limit=25&cursor=<opaque>
```

- `query` dicocokkan ke nama, `external_ref`, telepon, email, dan kategori (case-insensitive,
  wildcard di-escape).
- `status`: `active` (default) | `inactive` | `all`.
- `limit`: 1–100, default 25.
- `cursor` opaque (`base64url(created_at:id)`); cursor rusak → `400 VALIDATION_ERROR`.
- Respons: `{ items: ParticipantSummary[], nextCursor: string | null }`.
- Urutan stabil: `created_at DESC, id DESC` (id sebagai tie-breaker karena impor bisa menulis
  banyak baris dalam milidetik yang sama).
- `ParticipantSummary` memuat `categoryId` (otoritas), `category` (nama hasil join, mirror
  lama untuk klien Q1), dan `attributes` (nilai custom field per peserta). Nilai mentah;
  pemformatan tanggal/angka dilakukan UI.

### Create dan update

`POST` mewajibkan `categoryId`. `PATCH` boleh mengubah `categoryId` dan mengirim `attributes`
secara parsial (merge). `attributes: { "key": null }` menghapus nilai hanya bila field tidak
`required`; menghapus field wajib → `422 BUSINESS_RULE`.

```jsonc
// POST request
{ "fullName": "Budi", "categoryId": "01J...", "attributes": { "nisn": "12345" } }
```

- Kategori dari Tema lain → `404 NOT_FOUND`; kategori `archived` → `422 BUSINESS_RULE`.
- Key yang tidak ada di katalog `scope='participant'` **dibuang**, bukan disimpan. Key milik
  field `scope='activity'` juga tidak diterima di profil peserta (`FR-033`).
- Nilai yang tipenya salah → `422 BUSINESS_RULE` dengan `details.fieldErrors` per key.
- Untuk kompatibilitas UI Q1, `category` (nama) masih diterima sebagai input alternatif:
  nama yang cocok memakai kategori yang ada; nama baru **membuat kategori** secara eksplisit
  dalam batch yang sama. Jalur ini tidak dipakai impor CSV (lihat §5). Klien baru wajib
  memakai `categoryId`.
- Semua perubahan menulis audit di batch yang sama; snapshot peserta hanya memuat
  `categoryId`, `status`, dan daftar `attributesChanged` (nama key), tidak pernah nilai PII.

### `DELETE` peserta

Body wajib `{ "confirm": true }`. Baris **tidak** dihapus fisik: `status` menjadi `inactive`,
`updated_at` diperbarui. Peserta dapat diaktifkan kembali dengan
`PATCH { "status": "active" }`. Respons: `{ "deleted": true, "status": "inactive" }`.

### `POST /api/calendar/:eventId/participants/import`

Content-Type: `text/csv` (body mentah) atau `application/json` dengan `{ "csv": "..." }`.

Query: `?dry_run=true|false` — **default `true`**. Menulis hanya bila klien mengirim
`dry_run=false` setelah pratinjau.

Batas: **2 MB** dan **1.000 baris** per request. Keduanya menghasilkan `413`.

```jsonc
// 200 (dry_run = true, default)
{
  "ok": true,
  "data": {
    "dryRun": true,
    "total": 120,
    "valid": 118,
    "created": 30,
    "updated": 88,
    "invalid": [
      { "line": 7, "reason": "full_name wajib diisi" },
      { "line": 44, "reason": "external_ref duplikat di dalam file" }
    ],
    "sample": [{ "line": 2, "externalRef": "NIS-1", "fullName": "Budi", "phone": "+62…", "category": "Kelas 5A", "action": "create" }]
  }
}
```

```jsonc
// 200 (dry_run = false)
{
  "ok": true,
  "data": {
    "dryRun": false,
    "total": 120, "valid": 118, "created": 30, "updated": 88, "skipped": 2,
    "invalid": [ /* sama seperti pratinjau */ ]
  }
}
```

Kolom CSV (urutan bebas, header wajib):

| Kolom | Wajib | Aturan |
|---|---|---|
| `full_name` | ya | 1–120 karakter |
| `external_ref` | tidak | Unik per acara; kunci idempotensi |
| `phone` | tidak | Dinormalisasi ke `+62…`; 8–15 digit |
| `email` | tidak | Huruf kecil, format sederhana |
| `category` | **ya (header dan nilai)** | Nama kategori **aktif** yang sudah ada di Tema; maks 60 karakter |
| `note` | tidak | Maks 500 karakter |

- CSV tanpa header `category` → seluruh impor `400 VALIDATION_ERROR` sebelum baris diproses.
- Nama kategori tidak dikenal atau `archived` → baris dilaporkan `invalid` dengan alasan
  `kategori "X" tidak ditemukan`; **tidak ada pembuatan kategori otomatis**. Baris valid lain
  tetap diproses (partial import).
- Sel `category` kosong → baris `invalid` (`category wajib diisi`).
- Kolom custom field **belum** didukung di CSV Q2; header asing tetap ditolak. Nilai custom
  field diisi lewat API peserta.
- `sample` pratinjau memuat `categoryId` di samping `category`.

Batasan yang disengaja: **tidak ada** kolom `qr_token` di CSV. QR selalu dibuat server pada
fase QR, sehingga tidak mungkin ada dua peserta dengan token yang sama karena input.

Perilaku eksekusi:

- Baris valid ditulis dalam **satu** `db.batch()` (atomik).
- `(event_id, external_ref)` yang sudah ada → `UPDATE` lewat `ON CONFLICT` (idempoten), bukan
  error. Baris tanpa `external_ref` selalu `INSERT`.
- Duplikasi di dalam file: `external_ref` sama, atau nama + kontak (telepon/email) sama →
  baris kedua dilaporkan dan dilewati.
- Baris tidak valid lain dilewati, baris valid tetap disimpan (partial import); pelaporan per
  nomor baris fisik.
- Konfirmasi (`dry_run=false`) dibatasi **10 per jam per acara** dari tabel D1 → `429` dengan
  `Retry-After`. Pratinjau tidak dibatasi.
- Acara `archived` → `422 BUSINESS_RULE`.
- Lebih dari 1.000 baris atau 2 MB → `413` dengan pesan yang menyebut batasnya.

### Ekspor dan template

`export` mengembalikan `text/csv` dengan header kolom yang sama seperti impor, sehingga hasil
ekspor dapat diimpor ulang (idempoten lewat `external_ref`). `template` mengembalikan file
header-only untuk diisi pengguna. Keduanya `event_admin+` karena berisi PII, memakai BOM +
CRLF agar aman dibuka di Excel, dan menetralkan formula injection (`=`, `@`).

`Content-Disposition`:
- ekspor: `attachment; filename="peserta-<slug-acara>.csv"`
- template: `attachment; filename="template-peserta.csv"`

### Label QR

```
POST /api/events/:eventId/participants/qr-labels
```

Memakai **POST**, bukan GET, karena panggilan pertama menerbitkan kredensial (efek samping).
Otorisasi `qr:print` (event_admin/superadmin) + scope `event_id`; acara `archived` tetap boleh
dicetak karena penerbitan kredensial bukan perubahan data bisnis dan acara `archived` tidak
menerima absensi (`isEventOpenForAttendance` hanya untuk `active`), sehingga kredensial baru
tidak dapat menghasilkan transaksi. Ini carve-out sadar dari ADR-0015; rotasi pada acara
`archived` tetap ditolak.

Sumber kebenaran kredensial adalah `qr_identities` (`0010`, ADR-0017): satu baris aktif per
Tema + Peserta. Kredensial yang ditulis deployment lama pada `participants.qr_*`
dipromosikan saat pertama kali dibaca **tanpa mengganti token**, sehingga kartu yang sudah
tercetak tetap sah selama jendela deploy.

```jsonc
// request
{
  "format": "a4" | "sticker",        // default "a4"
  "participantIds": ["01J…"],        // opsional, maks 38, tanpa duplikat
  "fields": ["fullName", "category"], // opsional; default = konfigurasi acara
  "showEventName": true,              // opsional; default = konfigurasi acara
  "limit": 38,                        // 1–38, default 38 (hanya mode kursor)
  "cursor": "<opaque>"                // hanya mode "semua peserta aktif"
}
```

Dua mode:

| Mode | Kapan | Urutan | `nextCursor` |
|---|---|---|---|
| Pilihan eksplisit | `participantIds` diisi | `created_at DESC, id DESC` | selalu `null` |
| Semua peserta aktif | `participantIds` tidak diisi | `created_at DESC, id DESC` | kursor halaman berikutnya |

`participantIds` dan `cursor` tidak boleh dikirim bersamaan (`400`). `limit` > 38, lebih dari
38 id, id duplikat, atau cursor rusak → `400 VALIDATION_ERROR`.

```jsonc
// 200
{
  "ok": true,
  "data": {
    "event": { "id": "01J…", "name": "Wisuda 2026" },
    "format": "a4",
    "fields": ["fullName", "category"],
    "showEventName": true,
    "labels": [
      {
        "participantId": "01J…",
        "qr": "absensi:v1:<43 karakter base64url>",
        "values": { "fullName": "Siti", "category": "Kelas 7" }
      }
    ],
    "nextCursor": null
  }
}
```

- Hanya peserta `status = 'active'`; id nonaktif atau milik acara lain diabaikan (tidak ada
  kebocoran lintas acara).
- `values` hanya berisi field terpilih yang **tidak kosong**, mengikuti urutan `fields`.
- Respons **tidak pernah** memuat `qr_token_hash`, ciphertext, nonce, `qr_key_version`, atau
  kunci. `qr` adalah payload scan, bukan token mentah tersendiri.
- Cetak ulang selalu menghasilkan `qr` yang sama; kredensial tidak pernah dirotasi oleh cetak.
- Kegagalan konfigurasi secret atau dekripsi → `500 INTERNAL` dengan pesan yang menyuruh
  memeriksa konfigurasi server (tidak ada fallback plaintext).
- Setiap respons sukses non-kosong menulis satu baris `audit_log` `qr.labels_exported`
  (jumlah, terbit/daur ulang/dipromosikan, format, pilihan field; tanpa token atau PII).
- Penerbitan lazy menulis **satu** baris `qr.identity_issued` per request berisi `count`,
  bukan satu baris per peserta. Ini penyimpangan sadar dari rencana Q4 demi anggaran 50
  statement/invokasi (lihat `.opencode/plans/q4-qr-identity.md` §16).
- Anggaran terukur: satu halaman 38 label = **47 statement** saat terbit, **8** saat cetak
  ulang, dan **48** pada jalur lost-race (`qr-labels.statements.test.ts`). Karena itu batas
  batch diturunkan dari 50 ke 38: jalur lost-race menambah satu query baca ulang, jadi 38
  menyisakan dua statement headroom di bawah batas 50.

Konfigurasi label:

```
GET /api/events/:eventId/label-config
PUT /api/events/:eventId/label-config   body: { fields: [...], showEventName: boolean }
```

- Field yang diizinkan hanya kolom peserta yang sudah ada: `fullName`, `externalRef`,
  `category`, `phone`, `email`, `note`; maksimal 4, tidak boleh duplikat, minimal 1.
- Default bila belum pernah disimpan: `["fullName", "externalRef", "category"]`,
  `showEventName: true`.
- `PUT` ditolak `422 BUSINESS_RULE` untuk acara `archived`; `officer` boleh `GET` tetapi
  `403` untuk `PUT`.
- QR selalu dicetak; konfigurasi tidak pernah memengaruhi penerbitan kredensial.

### Rotasi dan metadata QR Identity

```
GET /api/events/:eventId/participants/:participantId/qr
PUT /api/events/:eventId/participants/:participantId/qr/rotate
```

ADR-0017: rotasi mengganti kredensial **di baris yang sama**, sehingga `id` identitas stabil
untuk referensi transaksi Q5 dan token lama langsung tidak ditemukan oleh lookup scan.

| Method | Izin | Perilaku |
|---|---|---|
| `GET` | `qr:print` (event_admin/superadmin) | Metadata identitas; `identity: null` bila belum pernah diterbitkan; kredensial legacy dilaporkan tanpa dipromosikan |
| `PUT` | `qr:rotate` (event_admin/superadmin) | Rotasi; body `{ "reason": "…", "expectedRotationCount"?: number }`; alasan wajib 3–500 karakter setelah trim |

```jsonc
// 200 GET sebelum terbit
{ "ok": true, "data": { "participantId": "01J…", "identity": null } }

// 200 GET setelah terbit
{
  "ok": true,
  "data": {
    "participantId": "01J…",
    "identity": {
      "participantId": "01J…",
      "issuedAt": 1760000000000,
      "rotatedAt": null,
      "rotationCount": 0,
      "keyVersion": 1
    }
  }
}

// 200 PUT
{
  "ok": true,
  "data": {
    "participantId": "01J…",
    "issuedAt": 1760000000000,
    "rotatedAt": 1760000500000,
    "rotationCount": 1,
    "keyVersion": 1,
    "qr": "absensi:v1:<token baru>"
  }
}
```

- `qr` hanya muncul pada respons rotasi agar admin bisa langsung mencetak ulang. Metadata
  **tidak pernah** memuat token, hash, ciphertext, nonce, atau PII.
- Belum pernah diterbitkan → `404 NOT_FOUND` dengan pesan "Cetak QR terlebih dahulu"; rotasi
  **tidak** menerbitkan identitas baru.
- Kredensial lama pada `participants.qr_*` dipromosikan dulu lalu langsung dirotasi.
- Rotasi juga menyalin kredensial baru ke kolom legacy `participants.qr_*` dalam batch yang
  sama, dengan guard `token_hash`. Tanpa mirror ini, rollback Worker ke versi pra-`0010` akan
  menghidupkan kembali token yang baru dicabut (`FR-059`, `AC-016`).
- `expectedRotationCount` opsional: bila dikirim dan tidak sama dengan `rotationCount` saat
  dibaca, route mengembalikan `409 CONFLICT` sebelum membuat token baru. Ini mencegah retry
  setelah sukses mencabut token yang mungkin sudah diterima klien. Tanpa field ini, perilaku
  lama (rotasi berikutnya) tetap berlaku.
- Dua rotasi paralel: satu `200`, satu `409 CONFLICT`; hanya pemenang menulis audit.
- Setiap rotasi menulis `audit_log` `qr.identity_rotated` (`entity_type = qr_identity`) dengan
  `rotationCount`, `keyVersion`, dan `reason`; snapshot memakai allowlist tanpa materi kredensial.
- Acara `archived` → `422 BUSINESS_RULE`; petugas (`officer`) → `403`; Tema lain → `404`.
- `GET` untuk kredensial legacy mengembalikan metadata turunan (`issuedAt`, `keyVersion`,
  `rotationCount: 0`) tanpa menulis apa pun; GET tidak boleh mempromosikan.
- Jumlah statement rotasi (auth + baca + promosi opsional + 1 update identitas + 1 mirror
  legacy + 1 audit) tetap di bawah batas 50/invokasi; tidak ada batch per peserta.

---

## 6. Aktivitas dan Sesi

Q1 menambahkan fondasi Tema → Aktivitas → Sesi (`FR-002`, `FR-005`–`FR-012`, `FR-182`).
Cakupan Q1 **API-only**: belum ada halaman web untuk mengelola Aktivitas/Sesi (UI menyusul
di Q6/Q8/Q9). Semua path memakai prefix kanonik `/api/events`; alias `/api/calendar` dan
`/api/themes` berlaku sama karena dihasilkan dari tabel route yang sama.

Otorisasi: `event_admin` dan `superadmin` untuk mutasi; `officer` hanya `GET` (anggota
Tema). Non-anggota mendapat `404`, anggota dengan peran kurang mendapat `403`. Tema
`archived` menolak seluruh mutasi anak dengan `422 BUSINESS_RULE` (`requireMutableEvent`).

### Aktivitas

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/api/events/:eventId/activities` | anggota Tema | Urut `sort_order`, lalu `created_at`, lalu `id` |
| `POST` | `/api/events/:eventId/activities` | event_admin, superadmin | Buat Aktivitas; status awal `draft` |
| `GET` | `/api/events/:eventId/activities/:activityId` | anggota Tema | Detail |
| `PATCH` | `/api/events/:eventId/activities/:activityId` | event_admin, superadmin | Nama, deskripsi, lokasi, `sortOrder` |
| `POST` | `/api/events/:eventId/activities/:activityId/status` | event_admin, superadmin | Transisi lifecycle |

```jsonc
// POST request
{
  "name": "Kehadiran Hari 1",
  "description": "Presensi gerbang utama",
  "transactionType": "attendance",   // attendance | consumption
  "location": "Aula",
  "sortOrder": 0
}

// 201
{ "ok": true, "data": { "activity": {
  "id": "01J...", "themeId": "01J...", "name": "Kehadiran Hari 1",
  "description": "Presensi gerbang utama", "transactionType": "attendance",
  "status": "draft", "location": "Aula", "sortOrder": 0,
  "createdAt": 173..., "updatedAt": 173..., "archivedAt": null
} } }
```

- `transactionType` **tidak dapat diubah** setelah dibuat; `PATCH` yang memuatnya ditolak
  `400 VALIDATION_ERROR`. Tipe yang salah dikoreksi dengan membuat Aktivitas baru, bukan
  dengan mengubah tipe yang sudah punya riwayat.
- Semua query di-scope `theme_id = ?`; id Aktivitas milik Tema lain → `404`.
- Transisi sah (ADR-0012, satu sumber di `packages/shared/src/lifecycle.ts`):

```
draft     → active | archived
active    → completed
completed → archived
archived  → (final, tidak ada transisi)
```

  `active → archived` sengaja tidak ada: Aktivitas harus diselesaikan dulu. Tidak ada reopen
  (`completed → active`, `archived → draft`). Melanggar tabel → `422 BUSINESS_RULE`.
- **Gate `draft → active` (`FR-040`, `FR-041`).** Transisi ke `active` hanya diterima bila
  setiap kategori **aktif** di Tema sudah punya baris `category_activity`. Bila belum,
  Worker membalas `422 BUSINESS_RULE` dengan pesan Indonesia dan
  `details.missingCategoryIds`; tidak ada aturan yang ditulis otomatis. `POST` tetap membuat
  Aktivitas `draft`. Kategori baru pada Aktivitas yang sudah `active` tidak mematikan
  Aktivitas itu — kategori tersebut fail-closed (deny) sampai barisnya dibuat.
- PATCH memakai pemeriksaan optimistis `updated_at`; kalah balapan → `409 CONFLICT`.

### Sesi

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/api/events/:eventId/activities/:activityId/sessions` | anggota Tema | Urut `starts_at` (null terakhir), lalu `created_at`, lalu `id` |
| `POST` | `/api/events/:eventId/activities/:activityId/sessions` | event_admin, superadmin | Buat Sesi; status awal `scheduled` |
| `GET` | `/api/events/:eventId/activities/:activityId/sessions/:sessionId` | anggota Tema | Detail |
| `PATCH` | `/api/events/:eventId/activities/:activityId/sessions/:sessionId` | event_admin, superadmin | Nama, lokasi, `startsAt`, `endsAt` |
| `POST` | `/api/events/:eventId/activities/:activityId/sessions/:sessionId/status` | event_admin, superadmin | Transisi lifecycle |
| `POST` | `/api/events/:eventId/activities/:activityId/sessions/:sessionId/archive` | event_admin, superadmin | Arsipkan Sesi |
| `POST` | `/api/events/:eventId/activities/:activityId/sessions/:sessionId/duplicate` | event_admin, superadmin | Salin konfigurasi sebagai Sesi baru |

```jsonc
// POST request
{ "name": "Gelombang 1", "location": "Gerbang", "startsAt": 173..., "endsAt": 173... }

// 201
{ "ok": true, "data": { "session": {
  "id": "01J...", "activityId": "01J...", "name": "Gelombang 1",
  "location": "Gerbang", "startsAt": 173..., "endsAt": 173...,
  "status": "scheduled", "archivedAt": null,
  "createdAt": 173..., "updatedAt": 173...
} } }
```

- Sesi selalu diselesaikan lewat Aktivitas: `findActivitySession` di-scope `activity_id = ?`,
  dan Aktivitas di-scope `theme_id = ?`. Id dari Aktivitas/Tema lain → `404`.
- `endsAt` sebelum `startsAt` ditolak `400 VALIDATION_ERROR`, baik saat create maupun patch
  gabungan. `startsAt`/`endsAt` boleh `null`; status **tidak pernah** disimpulkan dari jam.
- Transisi status sah:

```
scheduled   → in_progress | disabled
in_progress → completed  | disabled
completed   → (final)
disabled    → (final)
```

  Tidak ada reopen. Arsip bukan nilai status: `archivedAt` diisi hanya dari `completed` atau
  `disabled` (`OQ-033` [A]), dan status operasional tetap apa adanya. Sesi terarsip menjadi
  read-only dan tidak dapat diarsipkan dua kali (`422 BUSINESS_RULE`).
- `duplicate` menyalin nama, lokasi, dan jam saja; salinan selalu `scheduled`, tanpa
  `archivedAt`, dengan id baru. Tidak ada transaksi yang ikut tersalin (`BR-048`).
- PATCH/status/arsip memakai pemeriksaan optimistis `updated_at`; kalah balapan →
  `409 CONFLICT`.

### Kategori

Q2 menambahkan entitas kategori per Tema (ADR-0014). Kategori tidak pernah dihapus permanen;
hanya `active` ⇄ `archived`.

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/api/events/:eventId/categories` | anggota Tema | Query `status=active\|archived\|all` (default `active`); menyertakan `participantCount` |
| `POST` | `/api/events/:eventId/categories` | event_admin, superadmin | Buat; nama unik per Tema (case-insensitive) |
| `GET` | `/api/events/:eventId/categories/:categoryId` | anggota Tema | Detail; id Tema lain → `404` |
| `PATCH` | `/api/events/:eventId/categories/:categoryId` | event_admin, superadmin | Nama, deskripsi, `sortOrder`; guard `updatedAt` |
| `POST` | `/api/events/:eventId/categories/:categoryId/status` | event_admin, superadmin | `active` ⇄ `archived`; arsip mengisi `archivedAt` |

```jsonc
// POST request
{ "name": "Kelas 7A", "description": "Rombel pagi", "sortOrder": 0 }

// 201
{ "ok": true, "data": { "category": {
  "id": "01J...", "themeId": "01J...", "name": "Kelas 7A",
  "description": "Rombel pagi", "sortOrder": 0, "status": "active",
  "createdAt": 173..., "updatedAt": 173..., "archivedAt": null
} } }
```

- Nama duplikat di Tema yang sama (beda kapitalisasi sekalipun) → `409 CONFLICT`.
- Nama sama di Tema lain boleh.
- Kategori `archived` tetap terbaca dan peserta lama tetap valid; penugasan baru ditolak
  `422 BUSINESS_RULE`.
- Rename memperbarui mirror `participants.category` lewat trigger; `category_id` tidak
  berubah sehingga riwayat aman (`AC-008`).
- Tidak ada route `DELETE`.
- Semua mutasi menulis audit (`category.created`, `category.updated`, `category.archived`,
  `category.activated`) di batch yang sama; snapshot tidak memuat PII.

### Custom field

Katalog custom field per Tema. `key` imutabel (dipakai sebagai kunci JSON), `label` boleh
di-rename. Sembilan tipe: `text`, `number`, `email`, `phone`, `select`, `multi_select`,
`date`, `textarea`, `checkbox`.

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/api/events/:eventId/custom-fields` | anggota Tema | Query `scope=participant\|activity`, `status=active\|archived\|all` |
| `POST` | `/api/events/:eventId/custom-fields` | event_admin, superadmin | Buat; batas 50 aktif / 100 opsi |
| `GET` | `/api/events/:eventId/custom-fields/:fieldId` | anggota Tema | Detail; id Tema lain → `404` |
| `PATCH` | `/api/events/:eventId/custom-fields/:fieldId` | event_admin, superadmin | `label`, `description`, `required`, `options`, `sortOrder`; **bukan** `key`/`type` |
| `POST` | `/api/events/:eventId/custom-fields/:fieldId/status` | event_admin, superadmin | `active` ⇄ `archived` |
| `POST` | `/api/events/:eventId/custom-fields/:fieldId/type` | event_admin, superadmin | Ubah tipe dengan validasi kompatibilitas nilai tersimpan |

```jsonc
// POST request
{ "key": "golongan", "label": "Golongan", "type": "select",
  "required": false, "options": ["A", "B"], "scope": "participant", "sortOrder": 0 }

// 201
{ "ok": true, "data": { "field": {
  "id": "01J...", "themeId": "01J...", "key": "golongan", "label": "Golongan",
  "description": null, "type": "select", "required": false, "options": ["A", "B"],
  "scope": "participant", "sortOrder": 0, "status": "active",
  "createdAt": 173..., "updatedAt": 173..., "archivedAt": null
} } }
```

- `key` harus cocok `[a-z][a-z0-9_]*`, maks 40 karakter, unik per Tema termasuk baris
  terarsip. `PATCH` yang memuat `key`/`type` → `400 VALIDATION_ERROR`.
- `select`/`multi_select` wajib punya opsi; tipe lain tidak boleh punya opsi.
- Opsi > 100, field aktif ke-51, atau aktivasi field ke-51 → `422 BUSINESS_RULE`.
- Menghapus opsi yang masih dipakai peserta → `422 BUSINESS_RULE`; menambah opsi boleh.
- Ubah tipe mengikuti matriks ADR-0014; bila ada nilai lama yang tidak kompatibel →
  `422 BUSINESS_RULE` dengan jumlah nilai gagal. Tidak ada pemotongan data.
- Rename label, ubah `required`, arsip, dan ubah urutan **tidak** menyentuh
  `participants.attributes_json` (`AC-008`).
- Field `scope='activity'` boleh dibuat, tetapi nilainya tidak diterima di profil peserta;
  nilai per Aktivitas/Sesi adalah Q3.
- Audit: `custom_field.created`, `custom_field.updated`, `custom_field.type_changed`,
  `custom_field.archived`, `custom_field.activated`. `options` tidak masuk snapshot karena
  berisi teks bebas.

### Entitlement

Q3 menambahkan konfigurasi entitlement per Tema (ADR-0016, `D-005` [A]). Cakupan **API-only**:
belum ada UI (Q9) dan belum ada penegakan di jalur scan (Q5). Semua path memakai prefix kanonik
`/api/events`; alias `/api/calendar` dan `/api/themes` berlaku sama.

Model aturan: satu baris `entitlement_rules` per sel. Tingkat dibaca dari kombinasi kolom, bukan
kolom enum. Prioritas tetap, dari tertinggi ke terendah:

```
Individual–Session → Category–Session → Individual–Activity → Category–Activity → Theme default
```

`inherit` melanjutkan ke tingkat berikutnya; `allowed`/`denied` pertama yang menentukan langsung
menjadi hasil, sehingga `denied` di tingkat lebih tinggi tidak dapat ditimpa tingkat lebih rendah
(`BR-018`–`BR-023`). Tanpa aturan yang menentukan, hasilnya **deny** dengan `decidedBy: null`
(fail-closed). Sesi hanya dibaca bila konteks memuat `sessionId`; Sesi tidak pernah disimpulkan
dari jam. Perubahan aturan hanya berlaku untuk transaksi berikutnya (`FR-199`, `BR-075`).

Otorisasi:

| Aksi | Membership minimum | Catatan |
|---|---|---|
| `entitlement:read` | `officer` | Petugas boleh membaca matriks/preview |
| `entitlement:write` | `event_admin` | Petugas tidak pernah menulis, termasuk atas dirinya sendiri |

Superadmin lolos lewat aturan global. Non-anggota Tema → `404`; anggota dengan peran kurang →
`403`. Tema `archived` menolak seluruh mutasi aturan (`422 BUSINESS_RULE`, ADR-0015).

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/api/events/:eventId/entitlements/default` | `entitlement:read` | Baca Theme default |
| `PUT` | `/api/events/:eventId/entitlements/default` | `entitlement:write` | Upsert Theme default (`allowed`/`denied` saja) |
| `DELETE` | `/api/events/:eventId/entitlements/default` | `entitlement:write` | Hapus Theme default |
| `GET` | `/api/events/:eventId/activities/:activityId/entitlements` | `entitlement:read` | Matriks Aktivitas + kelengkapan |
| `PUT` | `/api/events/:eventId/activities/:activityId/entitlements/categories` | `entitlement:write` | Batch `category_activity`, maks. 15 baris |
| `PUT` | `/api/events/:eventId/activities/:activityId/sessions/:sessionId/entitlements/categories` | `entitlement:write` | Batch `category_session`, maks. 15 baris |
| `PUT` | `/api/events/:eventId/activities/:activityId/entitlements/participants/:participantId` | `entitlement:write` | Upsert override individual Aktivitas |
| `DELETE` | `/api/events/:eventId/activities/:activityId/entitlements/participants/:participantId` | `entitlement:write` | Hapus override individual Aktivitas |
| `PUT` | `/api/events/:eventId/activities/:activityId/sessions/:sessionId/entitlements/participants/:participantId` | `entitlement:write` | Upsert override individual Sesi |
| `DELETE` | `/api/events/:eventId/activities/:activityId/sessions/:sessionId/entitlements/participants/:participantId` | `entitlement:write` | Hapus override individual Sesi |
| `GET` | `/api/events/:eventId/activities/:activityId/entitlements/resolve?participantId=&sessionId=` | `entitlement:read` | Preview hasil resolver |

Theme default:

```jsonc
// PUT request
{ "status": "allowed" }        // allowed | denied

// 200
{ "ok": true, "data": { "themeDefault": { "status": "allowed" } } }
```

- `inherit` di Theme default **ditolak** `422 BUSINESS_RULE`: tidak ada tingkat di bawahnya, jadi
  nilainya sama dengan deny tetapi membingungkan admin.
- `DELETE` yang tidak menemukan baris → `404 NOT_FOUND`. Setelah dihapus, resolver kembali deny.
- Theme default hanya **fallback lewat `inherit`**; ia bukan konfigurasi final per kategori dan
  tidak menggantikan baris `category_activity` (`BR-019`, `AC-012`).

Batch kategori:

```jsonc
// PUT .../entitlements/categories
{ "rules": [{ "categoryId": "01J...", "status": "allowed" }] }

// 200
{
  "ok": true,
  "data": {
    "activityId": "01J...",
    "sessionId": null,
    "rules": [{ "categoryId": "01J...", "status": "allowed" }],
    "entitlementComplete": false,
    "missingCategoryIds": ["01J..."]
  }
}
```

- `rules` wajib 1–15 baris dan `categoryId` unik dalam satu request. Batas 15 berasal dari
  anggaran **50 statement/invokasi D1**: satu baris butuh upsert + audit, ditambah query
  kelengkapan dan pembacaan konteks. Matriks 20 kategori dikirim dalam dua request. Lebih dari
  15, `categoryId` ganda, atau status invalid → `422 BUSINESS_RULE` tanpa penulisan.
- Kategori wajib milik Tema (`404`) dan **aktif** untuk penulisan baru; kategori `archived`
  ditolak `422`. Baris lama untuk kategori arsip tetap dibaca resolver dan tetap muncul di
  matriks.
- Sesi wajib milik Aktivitas dan Tema yang sama (`404`); peserta wajib milik Tema yang sama.
- Upsert memakai baca-lalu-insert/update dengan guard `updated_at`; balapan unique index →
  `409 CONFLICT`, bukan `500`.
- Respons mengembalikan aturan tersimpan dan kelengkapan **setelah** batch.

Override individual:

```jsonc
// PUT .../entitlements/participants/:participantId
{ "status": "denied" }         // inherit | allowed | denied

// 200
{ "ok": true, "data": { "participantOverride": {
  "participantId": "01J...", "sessionId": null, "status": "denied"
} } }
```

- `DELETE` menulis audit `entitlement_rule.deleted`; override yang tidak ada → `404`.
- Override individual tidak dihapus atau diubah saat kategori peserta berubah (`FR-042`,
  `AC-014`). Resolver membaca `category_id` peserta terkini, bukan snapshot kategori.
- Override Sesi hanya berlaku untuk Sesi itu; Sesi lain memakai aturan Aktivitas.

Matriks Aktivitas mengembalikan Theme default, satu sel per kategori, sel per Sesi, override
individual (maksimum 200 baris per query), `entitlementComplete`, dan `missingCategoryIds`:

```jsonc
{
  "ok": true,
  "data": {
    "activityId": "01J...",
    "entitlementComplete": true,
    "missingCategoryIds": [],
    "themeDefault": { "status": "denied" },
    "categories": [{ "categoryId": "01J...", "name": "Kelas 7A", "status": "allowed" }],
    "sessions": [{
      "sessionId": "01J...",
      "categories": [{ "categoryId": "01J...", "name": "Kelas 7A", "status": "inherit" }],
      "participants": [{ "participantId": "01J...", "status": "denied" }]
    }],
    "participants": [{ "participantId": "01J...", "status": "allowed" }]
  }
}
```

`name` kategori boleh ada (bukan PII); nama/email peserta tidak dimasukkan, hanya
`participantId`.

Preview resolver:

```
GET /api/events/:eventId/activities/:activityId/entitlements/resolve?participantId=01J...&sessionId=01J...
→ { "ok": true, "data": { "allowed": false, "status": "denied", "decidedBy": "category_activity" } }
```

- `sessionId` opsional. Bila diisi, Sesi wajib milik Aktivitas itu (`404`).
- Peserta dari Tema lain → `404`. Respons tidak memuat PII dan tidak ditulis ke log.
- Hasil preview memakai fungsi murni yang sama dengan jalur baca Q5, bukan implementasi kedua.

Gate `draft → active` Aktivitas dijelaskan di §6 (Aktivitas).

Biaya query: satu resolve = **1 statement**, paling banyak **5 baris**. Satu batch kategori 15
baris = 30 statement upsert+audit + 1 kelengkapan + pembacaan konteks (±4), di bawah 50. Angka
dan query plan dicatat di [`OPERASIONAL.md`](./OPERASIONAL.md) §6.1.

### Paginasi dan batas

Q1 **belum** memaginasi daftar Aktivitas/Sesi: kedua endpoint mengembalikan seluruh baris milik Tema/Aktivitas dengan urutan deterministik (`sort_order`, `created_at`, `id` untuk Aktivitas; `starts_at` null-akhir, `created_at`, `id` untuk Sesi). Alasannya:

- Belum ada konsumen UI (Q1 API-only). Menambah parameter yang tidak dipakai berarti kontrak yang tidak teruji.
- Penambahan paginasi **additive**: klien tanpa `limit`/`cursor` tetap menerima respons yang sama, jadi tidak ada breaking change saat UI Q6/Q8 membutuhkannya.
- Ukuran realistis satu Tema kecil (puluhan Aktivitas/Sesi). Batas praktis diukur di Q11 bersama anggaran CPU/baris (`OPERASIONAL.md`).

Pemicu untuk menambahkan paginasi kursor (pola yang sama dengan daftar peserta): begitu UI Aktivitas/Sesi dibuka, atau bila satu Tema melewati ±200 Sesi. Sampai saat itu, angka ini dicatat sebagai risiko, bukan diasumsikan aman.

### Audit

Setiap mutasi menulis `audit_log` di `db.batch()` yang sama, dengan `before`/`after`
disaring allowlist ADR-0011 (`packages/shared/src/audit-allowlist.ts`):

| Aksi | Entitas |
|---|---|
| `theme.created`, `theme.updated`, `theme.status_changed`, `theme.deleted` | Tema (`events`) |
| `activity.created`, `activity.updated`, `activity.status_changed` | Aktivitas |
| `session.created`, `session.updated`, `session.status_changed`, `session.archived`, `session.duplicated` | Sesi |
| `category.created`, `category.updated`, `category.archived`, `category.activated` | Kategori |
| `custom_field.created`, `custom_field.updated`, `custom_field.type_changed`, `custom_field.archived`, `custom_field.activated` | Custom field |
| `entitlement_rule.created`, `entitlement_rule.updated`, `entitlement_rule.deleted` | Aturan entitlement |
| `participant.created`, `participant.updated`, `participant.deactivated`, `participant.imported` | Peserta |
| `qr.identity_issued` (per request, berisi `count`) | `qr_identities` (penerbitan lazy) |
| `qr.identity_rotated` | `qr_identities` (rotasi in-place) |
| `qr.labels_exported` | `events` (metadata ekspor label) |

Baris audit hanya ditulis bila mutasi di batch yang sama benar-benar berhasil: helper audit
memeriksa `updated_at` (Aktivitas/Sesi/aturan entitlement), `status`/keberadaan baris (Tema),
atau `token_hash` hasil rotasi. Karena itu "audit tertulis" berarti "mutasi mendarat".
Snapshot `entitlement_rule` hanya memuat `themeId`, `activityId`, `sessionId`,
`participantId`, `categoryId`, dan `status`; snapshot `qr_identity` memuat `themeId`,
`participantId`, `keyVersion`, `rotationCount`, `issuedAt`, dan `rotatedAt` — tidak pernah
token, hash, ciphertext, nonce, atau PII (`FR-207`).

---

## 7. Pemindaian dan absensi

> **Target (belum ada):** transaksi berkonteks Aktivitas/Sesi dengan result code `SUCCESS`, `DUPLICATE`, `NOT_ENTITLED`, `INVALID_QR`, `SYSTEM_ERROR` (`FR-088`, `D-011` [A]); pemetaan dari hasil baseline di bawah adalah AQ-008. Halaman scan petugas baseline (`StaffScanPage` di `apps/web/src/pages/staff.tsx`, rute `/staff/scan`) sudah memanggil endpoint ini; `apps/web/src/pages/staff-scan.tsx` adalah file lama yang tidak diimpor di mana pun.

### `POST /api/calendar/:id/scan`

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

Sejak Q4 lookup token memakai satu `SEARCH` pada `qr_identities.token_hash`
(`uq_qr_identity_hash`) lalu join primary-key ke `participants`; scope Tema diperiksa dari
`qr_identities.theme_id`, bukan dari `participants.event_id`. Rotasi membuat hash lama tidak
ditemukan (`not_found`) tanpa mengubah baris `attendance`. Token dari Tema lain tetap
`wrong_event`, dan status peserta diperiksa setelah scope Tema agar token lintas Tema tidak
membocorkan status peserta lain. Audit `attendance.wrong_event` memakai
`entity_type = scan_attempt`, `entity_id = null`, dan snapshot `{ outcome: "wrong_theme" }`;
ID peserta dan ID Tema asal tidak disimpan karena Admin Acara yang melakukan scan dapat
membaca audit tersebut.

`deviceTs` hanya **dicatat** untuk analisis selisih jam, **tidak dipakai** sebagai waktu absensi. Waktu resmi selalu dari server (UTC).

Batas laju: 120 scan/menit per sesi, 600/menit per acara. Kelebihan → `429` dengan `Retry-After`.

Biaya query: 1 (sesi+membership) + 1 (peserta) + 1 batch (insert/outbox/audit) + 1 (baca ulang absensi saat `duplicate`) = **≤ 4 statement**, jauh di bawah batas 50 per invokasi.

### `GET /api/calendar/:id/attendance`

Query: `?status=&query=&limit=&cursor=`

```jsonc
{ "ok": true, "data": { "items": [
  { "id": "01J...", "eventId": "01J...", "eventName": "Wisuda",
    "participantId": "01J...", "participantName": "Budi",
    "participantExternalRef": "P-001", "category": "Kelas 5A",
    "status": "present", "checkedInAt": 1730000000123,
    "recordedBy": "01J...", "recordedByName": "Petugas",
    "method": "qr_scan", "note": null, "updatedAt": 1730000000123 }
], "nextCursor": null } }
```

### Rekap dashboard

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/api/dashboard` | semua pengguna terautentikasi | Ringkasan acara yang dapat diakses pengguna |
| `GET` | `/api/calendar/:eventId/dashboard` | anggota acara | Hitungan peserta, kehadiran per status, persentase, kehadiran terbaru |
| `GET` | `/api/staff/attendance` | petugas/admin | Riwayat scan milik pengguna, opsional difilter per acara |

Endpoint data rekap dipakai oleh dashboard dan halaman Laporan. Riwayat petugas hanya memuat
scan yang dicatat oleh pengguna tersebut.

### Ekspor kehadiran CSV

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/api/events/:eventId/attendance/export` | event_admin, superadmin | Unduh CSV; menerima filter `status` dan `query`; maksimum 5.000 baris per unduhan |

Kolom CSV: nama peserta, referensi, kategori, status, waktu UTC, metode, petugas, dan catatan.
Nilai CSV diloloskan dengan helper CSV bersama. Jika hasil lebih dari 5.000 baris, Worker
meminta pengguna mempersempit filter.

### `POST /api/calendar/:eventId/attendance/:attendanceId/correction`

Peran: `event_admin`, `superadmin`. **`officer` selalu ditolak.**

> **Delta (`D-006` [A]):** endpoint ini menimpa baris `attendance` dengan `UPDATE`. Target mewajibkan Reversal (transaksi asli tetap ada, efek dibatalkan) dan Adjustment (before/after field allowlist) tanpa menimpa riwayat, oleh Admin Acara saja. Jangan meniru pola ini untuk endpoint baru; jalur ini diganti di roadmap Q5.

```jsonc
// request
{ "status": "excused", "reason": "Surat izin dokter diterima panitia" }

// 200
{ "ok": true, "data": { "attendanceId": "01J...", "status": "excused", "updatedAt": 173... } }
```

- `reason` wajib, 10–500 karakter.
- Satu `db.batch()`: `UPDATE attendance`, `INSERT audit_log` (`attendance.corrected` dengan `before`/`after`), upsert `outbox`.
- Jika baris berubah bersamaan (optimistic check via `updated_at`), kembalikan `409 CONFLICT` agar admin memuat ulang — lebih baik gagal terang-terangan daripada menimpa koreksi orang lain.

### `POST /api/calendar/:id/attendance/manual`

Peran: `event_admin`, `superadmin`. Hanya jika `events.allow_manual = 1`.

Dipakai sebagai fallback saat HP petugas tidak bisa memindai (mis. QR rusak). Tetap memakai constraint unik yang sama.

> **Delta:** otorisasi baseline memakai aksi `attendance:correct`. Pada model target, izin ini **tidak boleh** dianggap sebagai otorisasi Manual Check-in (`AC-055`). Manual Entry target adalah Transaction Source, bukan koreksi; Petugas berizin disetujui `D-022` [A]; izin Super Admin tidak diizinkan (`OQ-034` [A]).

---

## 8. Audit

Worker menulis audit untuk pemindaian, koreksi, dan pencetakan label. Tabel `audit_log`
append-only dan dilindungi trigger database.

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/api/events/:eventId/audit` | event_admin, superadmin | Daftar audit per acara, filter `action`, cursor dan limit |

Respons tidak menyertakan hash IP atau token. Endpoint selalu dibatasi ke acara yang diminta
dan memerlukan akses baca audit. Aktivitas web menggabungkan daftar audit dari acara yang
dapat diakses pengguna.

---

## 9. Sinkronisasi Google Sheets

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/api/calendar/:id/sync` | event_admin | Konfigurasi + status |
| `PUT` | `/api/calendar/:id/sync` | event_admin | Set `spreadsheetId`, `sheetTab`, `syncEnabled` |
| `POST` | `/api/calendar/:id/sync/test` | event_admin | Uji kredensial & akses tulis (menulis 1 sel metadata) |
| `POST` | `/api/calendar/:id/sync/full` | event_admin | Full resync (bangun ulang `sheet_rows`) |
| `POST` | `/api/calendar/:id/sync/run` | event_admin | Dorong antrean sekarang (tanpa menunggu cron) |
| `GET` | `/api/calendar/:id/sync/outbox` | event_admin | Item `failed`/`dead` + error terakhir |
| `POST` | `/api/calendar/:id/sync/outbox/:outboxId/retry` | event_admin | Reset ke `pending` |

```jsonc
// GET /api/calendar/:id/sync → 200
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

## 10. Kesehatan dan operasional

| Method | Path | Peran | Keterangan |
|---|---|---|---|
| `GET` | `/api/health` | publik | `{ ok: true }` — tidak menyentuh DB |
| `GET` | `/api/health/ready` | publik | `SELECT 1` ke D1; `503 DB_UNAVAILABLE` bila binding gagal |
| `GET` | `/api/admin/usage` | superadmin | Hitungan baris per tabel, sesi aktif, antrean outbox, umur audit log |

`/api/health/ready` sengaja terpisah dari `/api/health`: probe liveness tidak boleh ikut
gagal ketika D1 sedang bermasalah, sedangkan monitoring eksternal butuh sinyal yang
berbeda untuk "Worker hidup" dan "DB bisa dipakai".

`GET /api/admin/usage` melakukan **satu** `db.batch` berisi sembilan `COUNT(*)`
(`users`, `events`, `participants`, `attendance`, `audit_log`, sesi aktif, `rate_limits`,
`outbox` per status, plus `MIN/MAX(created_at)` audit). Setiap `COUNT` membaca tabel, jadi
endpoint ini untuk pemanggilan manual/insidental, **bukan cron**. Tidak ada PII di respons.

```json
{
  "ok": true,
  "data": {
    "generatedAt": 1760000000000,
    "counts": {
      "users": 12,
      "events": 3,
      "participants": 540,
      "attendance": 488,
      "auditEntries": 2140,
      "activeSessions": 7,
      "rateLimitBuckets": 4,
      "outbox": { "queued": 12, "failed": 0, "dead": 1 }
    },
    "auditLog": { "oldestAt": 1758000000000, "newestAt": 1760000000000 }
  }
}
```

Retensi audit log **tidak** otomatis: tabel bersifat append-only dan trigger database
menolak `DELETE`. Prosedur arsip manual ada di `docs/OPERASIONAL.md` §9.3 dan
keputusannya dicatat di [ADR-0008](./adr/0008-audit-log-retention.md).

---

## 11. Rate limiting (tanpa layanan berbayar)

Berbasis tabel `rate_limits` dengan jendela tetap.

| Bucket | Batas |
|---|---|
| `auth:activate:<ipHash>` | 10 / 15 menit |
| `auth:recover:<ipHash>` | 5 / 15 menit |
| `scan:<sessionId>` | 120 / menit |
| `scan:<eventId>` | 600 / menit |
| `import:<eventId>` | 10 / jam (hanya konfirmasi `dry_run=false`) |
| `sync:run:<eventId>` | 1 / menit |

Implementasi: satu `INSERT ... ON CONFLICT DO UPDATE SET counter = counter + 1 RETURNING counter`
(dukungan `RETURNING` pada D1 sudah dikonfirmasi di Fase 0: `spike.returning.test.ts`).

Batasan yang disadari: jendela tetap bisa memberi hingga 2× batas di perbatasan jendela
(klasik fixed window). Untuk melindungi endpoint auth dari tebakan token, itu cukup — yang
dilindungi adalah percobaan berulang dalam jumlah besar, bukan burst presisi.

`POST /api/events/:eventId/sync/run` juga membatasi `limit` maksimum `SYNC_RUN_MAX` (10 item
per request). Setiap item memakai ~2 query D1 (proyeksi + reservasi baris), sementara free
tier hanya mengizinkan 50 query per invocation; `limit` lebih besar bisa gagal di tengah jalan.
Sisa antrean dihabiskan cron.

Pembersihan baris `rate_limits` lama dilakukan oleh cron yang sama dengan sync: jendela yang
berakhir lebih dari 1 jam dihapus, maksimum 500 baris per siklus.

---

## 12. Cron

```ts
export default {
  fetch(request, env, ctx) { /* router */ },
  async scheduled(controller, env, ctx) { /* lihat di bawah */ },
};
```

Satu cron (`*/5 * * * *`) menjalankan tiga tugas berurutan, masing-masing dibatasi:

1. **Sync outbox** — maksimum 5 item (lihat `DESAIN_DATABASE.md` §6).
2. **Reklaim item macet** — item `inflight` dengan `claimed_at` lebih dari 10 menit → `failed` + `attempts + 1`.
3. **Housekeeping** — hapus `outbox.done` > 7 hari (di dalam `processOutbox`), `sessions` yang
   `expires_at`-nya lewat, dan `rate_limits` yang jendelanya berakhir > 1 jam lalu. Sesi dan
   rate limit masing-masing dibatasi 500 baris per kategori per siklus ✅ (mematuhi batas
   100k baris tulis/hari dengan margin lebar).

Tugas outbox dan housekeeping berjalan independen di dalam `ctx.waitUntil`; kegagalan salah
satu dicatat (`cron_job_failed`) dan tidak membatalkan yang lain.

---

## 13. Hal yang perlu diverifikasi

Status verifikasi diperbarui 1 November 2026; item manual dan deployment dicatat terpisah.

| ⚠️ | Yang perlu dibuktikan | Status |
|---|---|---|
| 1 | `RETURNING` didukung D1 untuk `INSERT ... ON CONFLICT` (dipakai di counter rate limit) | **TERVERIFIKASI** — `spike.returning.test.ts`, dipakai `db/rate-limit.ts` |
| 2 | Perilaku `Set-Cookie` pada respons Worker dengan Static Assets tidak terpotong | **TERVERIFIKASI** — alur login produksi telah digunakan; atribut cookie dan perilaku proxy perlu dipantau saat perubahan deployment |
| 3 | Middleware `Origin`/`Host` benar untuk request di balik custom domain | **TERVERIFIKASI SEBAGIAN** — request same-origin produksi berhasil; konfigurasi custom domain tambahan belum diuji |
| 4 | Content-Type `text/csv` terbaca dengan benar oleh `request.text()` pada Worker | **TERVERIFIKASI** — `participants.import.test.ts` mengirim body `text/csv` mentah di `workerd` dan baris tersimpan |
| 5 | Token di fragment (`#`) tidak terkirim ke server pada navigasi pertama | **TERVERIFIKASI (sifat browser)** — halaman `/aktivasi` membaca `location.hash`, dan `readInviteToken` hanya menerima fragmen. Tidak ada request yang membawa token |
| 6 | Rate limit tidak memblokir pengguna sah di balik NAT bersama | **BELUM** — batas 10/15 menit per IP-hash; perlu diamati di produksi |
| 7 | Cookie `Secure` benar-benar dipasang di HTTPS | **TERVERIFIKASI SEBAGIAN** — situs produksi HTTPS dan sesi berfungsi; audit atribut cookie khusus belum dicatat |
