# ADR-0009 — Peta model `events` baseline ke hierarki Tema → Aktivitas → Sesi

| Atribut | Nilai |
|---|---|
| Status | **Diusulkan** — jawaban AQ-001; menunggu adopsi pemilik proyek sebelum Q1 dibuka |
| Terkait AQ | AQ-001 (`docs/ARCHITECTURE.md` §6) |
| Terkait kebutuhan | `FR-172`–`FR-175`, `D-003` [A], `D-004` [A], `D-007` [A] |
| Dampak keputusan produk QRCek | Menentukan keterbacaan reuse `routes/events.ts`, `db/events.ts`, `packages/shared/src/events.ts` |

## Konteks

Baseline memakai satu tabel `events` datar (`REQUIREMENTS.md` §7.2, §7.2.4). Target menuntut `Tema Acara → Aktivitas (0..n) → Sesi (0..n)` dengan peserta/kategori/identitas QR melekat pada Tema (`REQUIREMENTS.md` §4). `D-007` [A] menghapus kewajiban migrasi data produksi, sehingga opsi yang menyimplifikasikan reuse sebagian boleh dipilih tanpa beban data.

## Opsi

1. **`events` = Tema Acara.** Aktivitas ditambahkan di atas `events` yang di-rename secara semantik ke Tema; `events` yang ada menjadi "Tema" dengan 1 Aktivitas default (atau tanpa Aktivitas). Reuse membership, undangan, peserta, QR, route/pengecekan Tema paling besar. Biayanya: lifecycle acara lama (status + jadwal) harus dipetakan ke lifecycle Tema; Semantics `/api/events/:id` dipertahankan selama masa transisi.
2. **Tema entitas baru di atas `events`.** `events` menjadi Aktivitas pertama (atau dipensiunkan) di bawah Tema baru. Model hierarki bersih, tetapi hampir semua route, FK, dan query yang memakai `event_id` harus diinterpretasikan ulang ke `activity_id`/`theme_id`. Reuse paling kecil.
3. **Pensiunkan `events`, model bersih.** Semua tabel baseline baru dibuat paralel (`themes`, `activities`, `sessions`) dengan migrasi data opsional, dan tabel lama dipensiunkan setelah penggantinya teruji (mengikuti opsi additive di ADR-0010).

## Rekomendasi (status usulan)

**Opsi 1** untuk rilis awal: `events` menjadi Tema Acara, dengan 1 Aktivitas tanpa Sesi sebagai representasi operasional acara-berbasis-waktu yang lama (compatibility shim) dan Aktivitas baru dibuat oleh admin. Reuse meminimalkan perubahan route (`/api/events/:themeId/...` ke `/api/themes/:id/activities/...` dilakukan bertahap lewat alias), sementara entitas Aktivitas/Sesi diciptakan oleh migrasi additif (ADR-0010). Tidak ada migrasi data produksi (`D-007` [A]).

Jika product owner memilih Opsi 2/3, migrasi perlu skema baru dari awal dan biaya route lebih besar; pilihannya tertutup dari docs ini, tidak dari kode.

## Konsekuensi (bila adopsi Opsi 1)

- `event_id` di baseline menjadi `theme_id` semantiknya; `participants.event_id` → `participants.theme_id`, `attendance.event_id` → transaksi konteks Tema + Aktivitas (+ Sesi opsional).
- Lifecycle acara datar (`events.status`) dipetakan: `draft` → Aktivitas Tema Draft/Terjadwal; `active` → Tema+Aktivitas aktif; `completed` → Selesai.
- Route lama `/api/events/:id/...` dipertahankan sebagai alias ke Tema agar UI lama tidak mati mendadak; nanti deprecated setelah Q8.
- Reuse yang perlu dievaluasi di Q1: `routes/events.ts`, `db/events.ts`, `packages/shared/src/events.ts`, membership, undangan, `lib/navigation.ts`.

## Belum ditutup

Status ADR ini **Diusulkan**, bukan Diterima. Q1 belum dibuka sampai adopsinya dicatat pemilik proyek (`REQUIREMENTS.md` gate Q0: ADR AQ-001).
