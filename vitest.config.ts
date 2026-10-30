import { defineConfig } from "vitest/config";

/**
 * Root test entrypoint.
 *
 * Each workspace owns its own config so the API can run inside `workerd`
 * (real D1 binding) while the rest run in Node. Running from the root lets the
 * documented shortcuts work:
 *   npm run test -- apps/api/src/routes/scan.test.ts
 *   npm run test -- -t "menolak scan ganda"
 */
export default defineConfig({
  test: {
    projects: ["packages/shared", "apps/api", "apps/web"],
  },
});
