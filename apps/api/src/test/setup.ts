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
  "transaction_corrections",
  "transactions",
  "staff_assignments",
  "entitlement_rules",
  "activity_sessions",
  "activities",
  "attendance",
  "outbox",
  "sheet_rows",
  "sync_state",
  "sessions",
  "device_credentials",
  "recovery_codes",
  "invites",
  "qr_identities",
  "participants",
  "custom_fields",
  "categories",
  "event_label_config",
  "event_memberships",
  "events",
  "users",
  "rate_limits",
];

/**
 * `audit_log` is deliberately not truncated: its append-only triggers reject
 * DELETE, and that is the property under test. Tests that assert on audit rows
 * scope their queries by the unique event/actor ids created by their fixtures,
 * so rows from a previous test cannot change a result.
 */

/**
 * `transaction_corrections` is append-only in production (ADR-0020), so its
 * DELETE trigger must be lifted for test cleanup. It is recreated immediately,
 * from the same shape the migration installs, so every test still runs against
 * the real guard.
 */
const APPEND_ONLY_DELETE_GUARD = `CREATE TRIGGER trg_transaction_corrections_no_delete
BEFORE DELETE ON transaction_corrections
BEGIN SELECT RAISE(ABORT, 'transaction_corrections is append-only'); END`;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, __MIGRATIONS__);

  await testEnv.DB.prepare(
    "DROP TRIGGER IF EXISTS trg_transaction_corrections_no_delete",
  ).run();

  // Adjustment rows reference the version they replaced, so the self-referencing
  // FK must be cleared before the table can be emptied in one pass.
  await testEnv.DB.prepare(
    "UPDATE transactions SET adjusts_transaction_id = NULL",
  ).run();

  for (const table of TABLES_CHILDREN_FIRST) {
    await testEnv.DB.prepare(`DELETE FROM ${table}`).run();
  }

  await testEnv.DB.prepare(APPEND_ONLY_DELETE_GUARD).run();
});
