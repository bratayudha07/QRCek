import { testEnv as env } from "./env";
import { beforeEach, describe, expect, it } from "vitest";

const NOW = 1_730_000_000_000;

/**
 * Spike (IMPLEMENTATION_PLAN.md Fase 0): is a *partial* unique index
 * (`WHERE status IN (...)`) supported and enforced?
 *
 * ADR-004 / outbox coalescing depends on it: at most one pending sync row per
 * participant, while completed rows stay as history.
 */
describe("spike: partial unique index", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM outbox; DELETE FROM participants; DELETE FROM events; DELETE FROM users;");
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, display_name, role, status, created_at) VALUES (?, ?, ?, ?, ?)",
      ).bind("u1", "Admin", "superadmin", "active", NOW),
      env.DB.prepare(
        "INSERT INTO events (id, slug, name, created_at, created_by) VALUES (?, ?, ?, ?, ?)",
      ).bind("e1", "ev-1", "Event", NOW, "u1"),
      env.DB.prepare(
        `INSERT INTO participants
           (id, event_id, external_ref, full_name, qr_token_hash, qr_issued_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind("p1", "e1", "R1", "Budi", "h1", NOW, NOW, NOW),
    ]);
  });

  const insertOutbox = (id: string, status: string) =>
    env.DB.prepare(
      `INSERT INTO outbox (id, event_id, participant_id, kind, status, attempts, next_attempt_at, created_at, updated_at)
       VALUES (?, 'e1', 'p1', 'attendance', ?, 0, ?, ?, ?)`,
    )
      .bind(id, status, NOW, NOW, NOW)
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
      `INSERT INTO outbox (id, event_id, participant_id, kind, status, attempts, next_attempt_at, created_at, updated_at)
       VALUES (?, 'e1', 'p1', 'attendance', 'pending', 0, ?, ?, ?)
       ON CONFLICT (event_id, participant_id) WHERE status IN ('pending','inflight','failed') DO UPDATE SET
         status = 'pending',
         attempts = 0,
         next_attempt_at = excluded.next_attempt_at,
         updated_at = excluded.updated_at`,
    )
      .bind("o4", NOW + 60_000, NOW, NOW + 60_000)
      .run();

    const row = await env.DB.prepare("SELECT COUNT(*) AS n, MAX(id) AS id FROM outbox").first<{
      n: number;
      id: string;
    }>();

    expect(row?.n).toBe(1);
    expect(row?.id).toBe("o1"); // updated in place, not inserted
  });

  it("rejects a conflict target that omits the partial predicate", async () => {
    await insertOutbox("o1", "pending");

    // Discovered in Fase 0: SQLite refuses to infer a partial index from a
    // bare conflict target. Documented in docs/DESAIN_DATABASE.md.
    await expect(
      env.DB.prepare(
        `INSERT INTO outbox (id, event_id, participant_id, kind, status, attempts, next_attempt_at, created_at, updated_at)
         VALUES (?, 'e1', 'p1', 'attendance', 'pending', 0, ?, ?, ?)
         ON CONFLICT (event_id, participant_id) DO UPDATE SET updated_at = excluded.updated_at`,
      )
        .bind("o5", NOW, NOW, NOW)
        .run(),
    ).rejects.toThrow(/ON CONFLICT clause does not match/);
  });
});
