# Delta UI Q4 — Rotasi QR

Tanggal: 14 November 2026
Status: siap dieksekusi (UI-only; API Q4 sudah live dan teruji).
Prasyarat: halaman detail peserta (Q2) dan metadata QR (`0010`) sudah ada.

## Tujuan

Admin Acara dapat mengganti QR peserta yang hilang/rusak tanpa SQL atau DevTools. Rotasi
membuat kartu lama langsung tidak berlaku, menaikkan `rotationCount`, dan tercatat di audit
(`ADR-0017`, `FR-054`–`FR-065`). Ekspor PNG/ZIP massal tetap Q9 dan bukan cakupan delta ini.

## Keputusan UI

- **Lokasi:** halaman detail peserta, bagian **“Kartu QR”** di bawah data peserta.
- Menampilkan metadata aman: waktu terbit, waktu rotasi terakhir, jumlah rotasi, versi kunci.
  Token/hash/ciphertext tidak pernah ditampilkan.
- Tombol **“Rotasi QR”** hanya untuk Admin Acara/Super Admin pada Tema yang tidak arsip.
- Dialog rotasi mewajibkan alasan (3–500 karakter) dan mengirim `expectedRotationCount` dari
  metadata yang sedang ditampilkan. `409` berarti data sudah berubah → muat ulang, jangan ulangi
  otomatis.
- Setelah sukses, tampilkan **payload QR baru satu kali** memakai komponen `QrCode` yang sudah
  ada, plus peringatan bahwa kartu lama langsung tidak berlaku dan QR baru harus dicetak
  sebelum panel ditutup.
- Tidak ada optimistic success; panel baru muncul setelah Worker menjawab `ok`.

## Cakupan

### 1. `apps/web/src/lib/qr-identities.ts` (baru)

Binding:

- `GET  /api/events/:eventId/participants/:participantId/qr`
- `PUT  /api/events/:eventId/participants/:participantId/qr/rotate`

Helper murni (diuji):

- `qrIdentityPath`, `qrRotatePath` (encoding).
- `canRotateQr(accessRole, eventStatus)` → `event_admin`/`superadmin`, Tema tidak arsip.
- `rotationReasonError(reason)` → pesan Indonesia bila < 3 atau > 500 karakter, selain itu
  `null` (selaras `RotateQrRequestSchema`).
- `rotationSummary(identity)` → teks ringkas untuk kartu (`Belum pernah diterbitkan`,
  `Diterbitkan …`, `Dirotasi …`), tanpa PII/token.
- `nextRotationRequest(identity, reason)` → `{ reason: trimmed, expectedRotationCount }`.

Tes: `apps/web/src/lib/qr-identities.test.ts`.

### 2. `apps/web/src/components/qr-identity-card.tsx` (baru)

- Menerima `eventId`, `participantId`, `canRotate`, `timeZone`.
- Memuat metadata saat mount; `loading | ready | error` jelas, dengan tombol coba lagi.
- Kartu ringkasan + tombol **Rotasi QR** (disabled saat `canRotate = false`).
- Dialog: alasan (textarea), error validasi klien, error API apa adanya, tombol batal/rotasi.
- Sukses: tampilkan `QrCode value={payload.qr}` (ukuran wajar, mis. 45 mm), waktu rotasi,
  `rotationCount`, dan tombol **Tutup**. Setelah ditutup, payload tidak disimpan di state.
- `409`: tampilkan pesan Worker dan tombol **Muat ulang metadata**.

### 3. `apps/web/src/pages/participant-detail.tsx`

- Render `QrIdentityCard` setelah form/detail peserta, dengan `canRotate` dari
  `canRotateQr(state.event.accessRole, state.event.status)` dan `timeZone` dari Tema.
- Tidak mengubah alur edit/nonaktifkan peserta.

## File yang disentuh

- `apps/web/src/lib/qr-identities.ts` (baru) + tes
- `apps/web/src/components/qr-identity-card.tsx` (baru)
- `apps/web/src/pages/participant-detail.tsx`

Tidak menyentuh Worker, migrasi, atau `packages/shared`.

## Acceptance

- [ ] Detail peserta menampilkan metadata QR; peserta yang belum punya QR menampilkan
      “Belum pernah diterbitkan” tanpa error.
- [ ] Rotasi dengan alasan valid berhasil, `rotationCount` naik, dan QR baru tampil.
- [ ] Alasan < 3 karakter ditolak di klien dan Worker (pesan jelas).
- [ ] Setelah rotasi, scan kartu lama gagal (diverifikasi manual dengan dua QR).
- [ ] `409` karena data usang menampilkan pesan muat ulang, bukan rotasi kedua diam-diam.
- [ ] Petugas tidak melihat tombol rotasi; Tema arsip baca-saja.
- [ ] Tidak ada token/hash yang masuk log; payload QR hanya ada di state selama panel sukses
      terbuka dan tidak disimpan ke `localStorage`.
- [ ] Tidak ada dependency atau migrasi baru.

## Verifikasi

```bash
npm run typecheck
npm run lint
npm run test -- apps/web/src/lib/qr-identities.test.ts
npm run test
npm run build
```

Manual: buka detail peserta → rotasi dengan alasan → cetak QR baru → scan QR baru `SUCCESS`,
scan QR lama `INVALID_QR`/tidak dikenali. Catat di `docs/OPERASIONAL.md` §12 dan
`docs/RENCANA_PENGUJIAN.md`.

## Out of scope

- Ekspor PNG/ZIP massal dan desain kartu (Q9; `NG-01`–`NG-06`).
- Rotasi massal per Tema.
- Menampilkan riwayat audit rotasi di halaman ini (Q8).
- Polish visual/design system (Q9).
