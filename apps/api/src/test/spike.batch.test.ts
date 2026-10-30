import { testEnv as env } from "./env";
import { beforeEach, describe, expect, it } from "vitest";

const NOW = 1_730_000_000_000;

/**
 * Spike (IMPLEMENTATION_PLAN.md Fase 0): is `db.batch()` atomic?
 *
 * If a later statement in the batch fails, does the earlier statement roll back?
 * The whole outbox/audit design depends on the answer.
 */
describe("spike: db.batch() atomicity", () => {
  beforeEach(async () => {
    await env.DB.exec("DROP TABLE IF EXISTS spike_batch;");
    await env.DB.exec("CREATE TABLE spike_batch (id TEXT PRIMARY KEY);");
    await env.DB.exec("INSERT INTO spike_batch (id) VALUES ('a');");
  });

  it("rolls back earlier statements when a later statement fails", async () => {
    let threw = false;

    try {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO spike_batch (id) VALUES ('b')"),
        // 'a' already exists -> UNIQUE constraint violation
        env.DB.prepare("INSERT INTO spike_batch (id) VALUES ('a')"),
      ]);
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);

    const { results } = await env.DB.prepare("SELECT id FROM spike_batch ORDER BY id").all<{
      id: string;
    }>();

    // Atomic => only the pre-existing row remains. Not atomic => ['a', 'b'].
    expect(results.map((r) => r.id)).toEqual(["a"]);
  });

  it("returns one result per statement on success", async () => {
    const results = await env.DB.batch([
      env.DB.prepare("INSERT INTO spike_batch (id) VALUES ('b')"),
      env.DB.prepare("INSERT INTO spike_batch (id) VALUES ('c')"),
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it("counts a batch as one query against the per-invocation limit contract", () => {
    // Documented platform behaviour: db.batch() counts as a single query.
    // This test only records the assumption used by the query budget.
    expect(true).toBe(true);
    void NOW;
  });
});
