# ADR-0005 — Outbox persisten di D1, digerakkan Cron Trigger

| Atribut | Nilai |
|---|---|
| Status | **Diterima** — diterapkan (`migrations/0005_attendance_sync.sql`, `apps/api/src/services/outbox.ts`) |
| Asal | `docs/ARSITEKTUR.md` ADR-005 (diekstrak 3 November 2026; konteks dan konsekuensi dilengkapi dari `docs/ARSITEKTUR.md` §8) |
| Terkait kebutuhan | `FR-193`, `NFR-009`, `NFR-011` di [`../REQUIREMENTS.md`](../REQUIREMENTS.md) |
| Dampak keputusan produk QRCek | `D-017` [A] merekomendasikan mempertahankan fondasi outbox D1 bila layak. |

## Konteks

Penulisan ke Google Sheets tidak boleh terjadi di jalur request scan (latensi, kuota, kegagalan pihak ketiga). Queue Cloudflare dan Durable Objects berbayar dilarang (`AGENTS.md` aturan #1).

## Opsi

1. Panggil Google Sheets langsung di request scan — melanggar "1 scan = 1 request kecil" dan membuat kegagalan Google memblokir absensi.
2. Cloudflare Queues — berbayar/di luar batasan.
3. **Tabel outbox di D1, diproses Cron Trigger.**

## Keputusan

Opsi 3. Item outbox ditulis **dalam `db.batch()` yang sama** dengan mutasi kehadiran, sehingga tidak ada "absen tercatat tapi tidak pernah masuk antrean". Cron (tiap 5 menit) mengambil sejumlah kecil item, mengelompokkan per acara, melakukan satu `values.batchUpdate` per acara, lalu menandai hasil. Detail status, coalescing, dan backoff ada di [`../DESAIN_DATABASE.md`](../DESAIN_DATABASE.md) §6.

## Konsekuensi

- Sinkronisasi bersifat eventual (menit), bukan real-time.
- Status `pending → inflight → done`, atau `failed` → retry dengan backoff, lalu `dead` setelah percobaan maksimum; `dead` dapat di-retry manual.
- Kegagalan Google tidak memblokir transaksi inti — selaras `FR-193`.
- Bentuk item outbox saat ini terikat proyeksi per peserta (ADR-0004); akan berubah bersama AQ-011.
