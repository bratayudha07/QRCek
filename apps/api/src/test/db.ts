import { testEnv as env } from "./env";

/**
 * Removes every application table.
 *
 * Only needed by tests that assert on absolute counts across repeated runs;
 * the pool's storage isolation already gives most tests a clean slate.
 */
export async function dropAllTables(): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
  ).all<{ name: string }>();

  for (const { name } of results) {
    await env.DB.exec(`DROP TABLE IF EXISTS "${name}"`);
  }
}
