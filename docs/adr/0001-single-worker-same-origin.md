# ADR-0001 — Topologi origin: satu Worker, same-origin

| Atribut | Nilai |
|---|---|
| Status | **Diterima** — diterapkan sejak Fase 0 |
| Asal | `docs/ARSITEKTUR.md` ADR-001 (diekstrak 3 November 2026 tanpa perubahan keputusan) |
| Terkait kebutuhan | `NFR-002`, `NFR-003`, `NFR-005`, `NFR-009`, `NFR-014` di [`../REQUIREMENTS.md`](../REQUIREMENTS.md) |
| Dampak keputusan produk QRCek | Tidak ada. Hierarki Tema → Aktivitas → Sesi (`D-003` [A]) tidak mengubah topologi. |

## Konteks

Sistem terdiri dari SPA React dan API yang memegang semua secret. Sesi memakai cookie `HttpOnly` (ADR-0002). Platform yang boleh dipakai hanya free tier Cloudflare (`AGENTS.md` aturan #1).

## Opsi

1. **Pages terpisah + Worker di subdomain.** Menambah CORS, cookie lintas-site (`SameSite=None` + `Secure`), dua pipeline deploy, dan dua tempat konfigurasi.
2. **Satu Worker menyajikan SPA (Workers Static Assets) dan API di `/api/*`.**

## Keputusan

Opsi 2. Satu Worker menyajikan SPA lewat Workers Static Assets **dan** API di `/api/*`.

```jsonc
// apps/api/wrangler.jsonc (ringkas)
{
  "assets": {
    "directory": "../web/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  }
}
```

## Konsekuensi

- SPA dan API selalu di-deploy bersamaan (versi terkunci).
- Kuota Workers hanya terpakai untuk request API; request aset statis yang cocok disajikan tanpa menjalankan Worker (perilaku terdokumentasi Cloudflare).
- Dev: `vite dev` di `:5173` mem-proxy `/api` ke `wrangler dev` di `:8787`. Dari sisi browser tetap same-origin, jadi perilaku cookie identik dengan produksi.
- Tidak ada konfigurasi CORS; proteksi CSRF cukup header khusus + cek `Origin` (ADR-0002).
