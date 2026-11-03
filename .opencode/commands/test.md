# test

Jalankan suite tes project Absensi Acara.

## Perintah

```bash
# Suite penuh (semua workspace)
npm run test

# Satu file tes
npm run test -- apps/api/src/test/health.test.ts

# Satu test case
npm run test -- -t "menolak scan ganda"

# Benchmark spike (verbose)
npm run bench
```

## Konfigurasi tes

- Worker tes berjalan di `workerd` via `@cloudflare/vitest-plugin` (lihat `apps/api/vitest.config.ts`)
- Tes frontend berjalan di Node (tanpa DOM/jsdom)
- Tidak ada tes yang memanggil Google Sheets API sungguhan — gunakan fake client
- Tidak ada tes yang bergantung pada jam nyata — injek waktu
- Urutan verifikasi: `typecheck → lint → test → build`

## File tes penting

| File | Cakupan |
|------|---------|
| `apps/api/src/test/health.test.ts` | Health endpoint |
| `apps/api/src/test/auth.activate.test.ts` | Aktivasi undangan |
| `apps/api/src/test/auth.recover.test.ts` | Pemulihan kode |
| `apps/api/src/test/authz.events.test.ts` | Otorisasi lintas acara |
| `apps/api/src/test/authz.unauthenticated.test.ts` | Route publik 401 |
| `apps/api/src/test/participants.import.test.ts` | Import CSV |
| `apps/api/src/test/participants.crud.test.ts` | CRUD peserta |
| `apps/api/src/test/scan.test.ts` | Endpoint scan |
| `apps/api/src/test/qr.db.test.ts` | Kredensial QR |
| `apps/api/src/test/labels.api.test.ts` | Label QR |
| `packages/shared/src/attendance.test.ts` | Logika kehadiran |
| `packages/shared/src/csv.test.ts` | Parsing CSV |
