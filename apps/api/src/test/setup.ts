import { applyD1Migrations } from "cloudflare:test";
import { beforeEach } from "vitest";

import { testEnv } from "./env";

/**
 * Fresh schema before every test.
 *
 * `applyD1Migrations` runs the same SQL files wrangler applies, in order, and
 * records them in `d1_migrations` — so a broken migration fails CI instead of
 * drifting from the deployed schema.
 *
 * Data is truncated explicitly, children first. Relying on the plugin's storage
 * isolation alone would make tests order-dependent the day isolation changes,
 * and a leaked session row is exactly the sort of thing that produces a
 * mysteriously green authorization test.
 */
const TABLES_CHILDREN_FIRST = [
  "sessions",
  "device_credentials",
  "recovery_codes",
  "invites",
  "participants",
  "event_memberships",
  "events",
  "users",
  "rate_limits",
];

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, __MIGRATIONS__);

  for (const table of TABLES_CHILDREN_FIRST) {
    await testEnv.DB.prepare(`DELETE FROM ${table}`).run();
  }
});
