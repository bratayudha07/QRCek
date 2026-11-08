# ADR-0015 — Tema terarsip membuat seluruh resource anak read-only

| Atribut | Nilai |
|---|---|
| Status | **Diterima** — keputusan pemilik proyek 6 November 2026 |
| Tanggal | 2026-11-06 |
| Menjawab | Tidak menjawab AQ. Menutup celah aturan yang tidak ditetapkan `REQUIREMENTS.md` |
| Terkait | `D-003` [A] (hierarki), `D-010` [A] (lifecycle); ADR-0009 (Tema = `events`), ADR-0012 (lifecycle Aktivitas/Sesi) |
| Dampak | `requireMutableEvent` di `apps/api/src/http/auth.ts`; 4 route mutasi Aktivitas/Sesi; kontrak error `422 BUSINESS_RULE` |

## Konteks

Q1 menambahkan Aktivitas dan Sesi di bawah Tema. Saat implementasi, guard `requireMutableEvent` ditambahkan agar Tema berstatus `archived` menolak semua mutasi anak. Guard itu **tidak** ada di rencana Q1 dan tidak diperintahkan `REQUIREMENTS.md`; ia muncul karena:

- Aktivitas `archived` sudah read-only dan Sesi terarsip juga read-only (`ADR-0012`), sehingga Tema terarsip yang masih bisa ditambahi Aktivitas membuat "arsip" tidak konsisten.
- Transisi Tema `archived` bersifat **final** (`EVENT_TRANSITIONS.archived = []` di `packages/shared/src/events.ts`). Tema yang sudah diarsipkan tidak bisa dibuka kembali, sehingga Aktivitas/Sesi yang dibuat setelahnya tidak akan pernah bisa dipakai untuk transaksi — hanya menjadi data mati.

Tanpa keputusan tertulis, guard ini adalah "aturan siluman": perilaku yang diuji tetapi tidak pernah disetujui, dan bisa dihapus orang lain tanpa terlihat sebagai perubahan kontrak.

## Opsi

1. **Tanpa guard.** Tema terarsip tetap menerima Aktivitas/Sesi baru. Paling sedikit kode, tetapi arsip kehilangan makna dan Aktivitas yang dibuat di sana tidak akan pernah bisa bertransaksi (`FR-183` menolak transaksi pada Aktivitas Draft/Diarsipkan, dan Tema tidak bisa dibuka lagi).
2. **Guard penuh (dipilih).** Semua mutasi anak ditolak `422 BUSINESS_RULE` selama Tema `archived`; pembacaan tetap berjalan.
3. **Guard sebagian.** Hanya pembuatan yang diblokir, penyuntingan diizinkan untuk "merapikan". Tidak konsisten: menyunting Aktivitas di Tema yang tidak akan pernah aktif lagi sama tidak bergunanya dengan membuatnya, dan menambah cabang logika yang tidak diminta.

## Keputusan

**Opsi 2.** Tema `archived` menolak seluruh mutasi resource anak.

- Ditegakkan satu tempat: `requireMutableEvent(env, auth, eventId)` di `apps/api/src/http/auth.ts`, yang memanggil `requireEventAccess(..., "event:update")` lalu memeriksa `events.status`. Route baru wajib memakainya alih-alih menulis ulang aturan.
- Route yang memakainya di Q1: `POST /activities`, `PATCH /activities/:id`, `POST /activities/:id/status`, `POST .../sessions`.
- Error: `422 BUSINESS_RULE` dengan pesan "Acara yang sudah diarsipkan tidak dapat diubah". Bukan `403` (bukan soal peran) dan bukan `404` (pemanggil memang anggota dan resource-nya ada).
- Pembacaan tidak terpengaruh: daftar dan detail Aktivitas/Sesi pada Tema terarsip tetap `200`.
- Data lama tidak dihapus, tidak di-reversal, dan tidak disembunyikan.
- Super Admin **tidak** mendapat pengecualian. Tidak ada alasan operasional yang membutuhkannya, dan pengecualian diam-diam akan membuat `archived` tidak final.

## Konsekuensi

- Kontrak API menyebut aturan ini (`DESAIN_API.md` §6) dan tesnya ada di `activities.api.test.ts` ("refuses to add an activity to an archived Tema"). Menghapus guard harus membuat tes gagal.
- UI kelak (Q6/Q8/Q9) menyembunyikan tombol mutasi pada Tema terarsip. Ini hanya UX; Worker tetap otoritatif.
- Bila kelak produk butuh "buka kembali Tema terarsip", itu perubahan keputusan: `EVENT_TRANSITIONS` harus diubah lebih dulu, dan guard ini otomatis mengikuti status, bukan dihapus.
- Tidak ada endpoint untuk mengubah status Tema anak dari sini; keputusan ini tidak menambah route baru.
