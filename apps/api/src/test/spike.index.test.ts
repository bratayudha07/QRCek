import { testEnv as env } from "./env";
import { beforeEach, describe, expect, it } from "vitest";

const NOW = 1_730_000_000_000;

/**
 * Spike (IMPLEMENTATION_PLAN.md Fase 0): is a *partial* unique index
 * (`WHERE status IN (...)`) supported and enforced?
 *
 * The future outbox coalescing (ADR-004) depends on it: at most one pending
 * sync row per participant, while completed rows stay as history.
 *
 * This uses a throwaway table with the same shape as the planned `outbox`
 * instead of the real table, because Fase 0 deliberately ships no business
 * tables. The SQL under test is identical.
 */
describe("spike: partial unique index", () => {
  beforeEach(async () => {
    await env.DB.exec("DROP TABLE IF EXISTS spike_outbox;");
    // `db.exec()` splits SQL per line, so multi-line DDL must go through
    // `prepare().run()` (docs/OPERASIONAL.md §4.2).
    await env.DB.prepare(
      `CREATE TABLE spike_outbox (
        id             TEXT PRIMARY KEY,
        event_id       TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        status         TEXT NOT NULL,
        attempts       INTEGER NOT NULL,
        next_attempt_at INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL
      )`,
    ).run();
    await env.DB.prepare(
      `CREATE UNIQUE INDEX spike_uq_outbox_pending
        ON spike_outbox(event_id, participant_id)
        WHERE status IN ('pending','inflight','failed')`,
    ).run();
  });

  const insertOutbox = (id: string, status: string) =>
    env.DB.prepare(
      `INSERT INTO spike_outbox (id, event_id, participant_id, status, attempts, next_attempt_at, updated_at)
       VALUES (?, 'e1', 'p1', ?, 0, ?, ?)`,
    )
      .bind(id, status, NOW, NOW)
      .run();

  it("rejects a second pending row for the same participant", async () => {
    await insertOutbox("o1", "pending");

    await expect(insertOutbox("o2", "pending")).rejects.toThrow(/UNIQUE/i);
  });

  it("allows a pending row alongside completed history", async () => {
    await insertOutbox("o1", "done");
    await insertOutbox("o2", "done");

    await expect(insertOutbox("o3", "pending")).resolves.toBeDefined();
  });

  it("supports the coalescing upsert (conflict target must repeat the partial predicate)", async () => {
    await insertOutbox("o1", "pending");

    await env.DB.prepare(
      `INSERT INTO spike_outbox (id, event_id, participant_id, status, attempts, next_attempt_at, updated_at)
       VALUES (?, 'e1', 'p1', 'pending', 0, ?, ?)
       ON CONFLICT (event_id, participant_id) WHERE status IN ('pending','inflight','failed') DO UPDATE SET
         status = 'pending',
         attempts = 0,
         next_attempt_at = excluded.next_attempt_at,
         updated_at = excluded.updated_at`,
    )
      .bind("o4", NOW + 60_000, NOW + 60_000)
      .run();

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n, MAX(id) AS id FROM spike_outbox",
    ).first<{ n: number; id: string }>();

    expect(row?.n).toBe(1);
    expect(row?.id).toBe("o1"); // updated in place, not inserted
  });

  it("rejects a conflict target that omits the partial predicate", async () => {
    await insertOutbox("o1", "pending");

    // Discovered in Fase 0: SQLite refuses to infer a partial index from a
    // bare conflict target. Documented in docs/DESAIN_DATABASE.md.
    await expect(
      env.DB.prepare(
        `INSERT INTO spike_outbox (id, event_id, participant_id, status, attempts, next_attempt_at, updated_at)
         VALUES (?, 'e1', 'p1', 'pending', 0, ?, ?)
         ON CONFLICT (event_id, participant_id) DO UPDATE SET updated_at = excluded.updated_at`,
      )
        .bind("o5", NOW, NOW)
        .run(),
    ).rejects.toThrow(/ON CONFLICT clause does not match/);
  });
});
