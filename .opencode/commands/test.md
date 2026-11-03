---
description: Jalankan verifikasi QRCek (typecheck → lint → test), terfokus bila diberi argumen
---

Jalankan verifikasi proyek QRCek sesuai `AGENTS.md`.

Argumen (opsional): $ARGUMENTS

1. Bila argumen berisi path file tes atau nama test case, jalankan tes terfokus saja:
   - satu file: `npm run test -- <path>`
   - satu test case: `npm run test -- -t "<nama>"`
   Mesin dev pemilik lemah (Celeron, RAM 4 GB); jangan menjalankan suite penuh saat iterasi.
2. Bila tanpa argumen, jalankan berurutan dan berhenti di langkah pertama yang gagal:
   `npm run typecheck` → `npm run lint` → `npm run test`.
   Jalankan `npm run build` hanya bila diminta atau sebelum menutup tahap roadmap.
3. Laporkan hasil apa adanya: jumlah file/tes lulus, kegagalan beserta pesan error yang relevan. Jangan menyatakan "lulus" untuk langkah yang tidak dijalankan.

Konteks tes:

- Tes Worker berjalan di `workerd` via `@cloudflare/vitest-plugin` (`apps/api/vitest.config.ts`, config `wrangler.test.jsonc`); D1 bersih per file.
- Tes web dan shared berjalan di Node tanpa DOM.
- Tidak ada tes yang memanggil Google Sheets sungguhan atau bergantung pada jam nyata.
- `npm run bench` = spike pengukuran hot path (`apps/api/src/test/spike.measure.test.ts`), bukan gerbang.
- Tes integritas wajib model target: `docs/RENCANA_PENGUJIAN.md` §9.

Contoh file tes baseline: `apps/api/src/routes/scan.test.ts`, `apps/api/src/routes/audit.test.ts`, `apps/api/src/routes/sync.test.ts`, `apps/api/src/test/authz.unauthenticated.test.ts`, `apps/api/src/test/authz.events.test.ts`, `apps/api/src/test/auth.activate.test.ts`, `apps/api/src/test/participants.import.test.ts`, `apps/api/src/test/qr.db.test.ts`, `apps/api/src/test/csv.test.ts`, `apps/api/src/domain/attendance-policy.test.ts`, `packages/shared/src/attendance.test.ts`, `apps/web/src/lib/navigation.test.ts`.
