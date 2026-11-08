import { testEnv as env } from "./env";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Spike (IMPLEMENTATION_PLAN.md Fase 0): does D1 support
 * `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING`?
 *
 * This decides whether the rate limiter needs a second `SELECT`
 * (DESAIN_API.md §11) and whether the outbox can read back its own row.
 */
describe("spike: RETURNING on upsert", () => {
  beforeEach(async () => {
    await env.DB.exec("DROP TABLE IF EXISTS spike_counter;");
    await env.DB.exec("CREATE TABLE spike_counter (k TEXT PRIMARY KEY, n INTEGER NOT NULL);");
  });

  const upsert = (key: string) =>
    env.DB.prepare(
      "INSERT INTO spike_counter (k, n) VALUES (?, 1) ON CONFLICT (k) DO UPDATE SET n = n + 1 RETURNING n",
    )
      .bind(key)
      .first<{ n: number }>();

  it("returns the inserted row on first upsert", async () => {
    const row = await upsert("bucket-1");
    expect(row?.n).toBe(1);
  });

  it("returns the incremented value on conflict", async () => {
    await upsert("bucket-1");
    const row = await upsert("bucket-1");
    expect(row?.n).toBe(2);
  });

  it("also works inside db.batch()", async () => {
    const results = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO spike_counter (k, n) VALUES ('b', 1) ON CONFLICT (k) DO UPDATE SET n = n + 1 RETURNING n",
      ),
      env.DB.prepare(
        "INSERT INTO spike_counter (k, n) VALUES ('b', 1) ON CONFLICT (k) DO UPDATE SET n = n + 1 RETURNING n",
      ),
    ]);

    const values = results.map((r) => (r.results[0] as { n: number }).n);
    expect(values).toEqual([1, 2]);
  });
});
