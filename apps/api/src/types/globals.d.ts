import type { D1Migration } from "@cloudflare/vitest-plugin";

declare global {
  /**
   * Injected by `apps/api/vitest.config.ts` via Vite `define`.
   *
   * `readD1Migrations()` needs `node:fs`, which does not exist inside
   * `workerd`, so the migration list is read at config time and serialised
   * into the test bundle.
   */
  const __MIGRATIONS__: D1Migration[];
}

export {};
