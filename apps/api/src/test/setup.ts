import { applyD1Migrations } from "cloudflare:test";
import { beforeEach } from "vitest";

import { testEnv } from "./env";

/**
 * Fresh schema before every test.
 *
 * `applyD1Migrations` runs the same SQL files wrangler applies, in order, and
 * records them in `d1_migrations` — so a broken migration fails CI instead of
 * drifting from the deployed schema.
 */
beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, __MIGRATIONS__);
});
