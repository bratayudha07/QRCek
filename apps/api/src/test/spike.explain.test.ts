import { testEnv as env } from "./env";
import { describe, expect, it } from "vitest";

/**
 * Spike (IMPLEMENTATION_PLAN.md Fase 0): do the hot-path queries use indexes?
 *
 * A full table scan on `attendance` costs 1 row read per row scanned, and the
 * free tier allows 5M row reads/day. `SCAN` here would be a production outage
 * waiting to happen.
 */
const QUERIES: ReadonlyArray<{ name: string; sql: string; params: string[] }> = [
  {
    name: "scan: participant by token hash",
    sql: "SELECT id FROM participants WHERE qr_token_hash = ?",
    params: ["h1"],
  },
  {
    name: "attendance: by event + participant (unique)",
    sql: "SELECT id FROM attendance WHERE event_id = ? AND participant_id = ?",
    params: ["e1", "p1"],
  },
  {
    name: "attendance: recap ordered by time",
    sql: "SELECT id FROM attendance WHERE event_id = ? ORDER BY checked_in_at DESC",
    params: ["e1"],
  },
  {
    name: "attendance: counts per status",
    sql: "SELECT status, COUNT(*) FROM attendance WHERE event_id = ? GROUP BY status",
    params: ["e1"],
  },
  {
    name: "participants: list per event ordered by name",
    sql: "SELECT id FROM participants WHERE event_id = ? ORDER BY full_name LIMIT 50",
    params: ["e1"],
  },
  {
    name: "participants: lookup by external ref",
    sql: "SELECT id FROM participants WHERE event_id = ? AND external_ref = ?",
    params: ["e1", "R1"],
  },
  {
    name: "outbox: due items",
    sql: "SELECT id FROM outbox WHERE status = 'pending' AND next_attempt_at <= ?",
    params: ["1730000000000"],
  },
  {
    name: "session: by token hash",
    sql: "SELECT id FROM sessions WHERE token_hash = ?",
    params: ["t1"],
  },
  {
    name: "membership: by user",
    sql: "SELECT event_id FROM event_memberships WHERE user_id = ? AND status = 'active'",
    params: ["u1"],
  },
  {
    name: "audit: by event ordered by time",
    sql: "SELECT id FROM audit_log WHERE event_id = ? ORDER BY created_at DESC LIMIT 50",
    params: ["e1"],
  },
];

describe("spike: EXPLAIN QUERY PLAN", () => {
  it.each(QUERIES)("$name uses an index", async ({ sql, params }) => {
    const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...params)
      .all<{ detail: string }>();

    const plan = results.map((r) => r.detail).join(" | ");

    console.log(`PLAN ${sql}\n  -> ${plan}`);

    // SQLite reports "SCAN table" for full scans and "SEARCH ... USING INDEX" otherwise.
    expect(plan).not.toMatch(/\bSCAN\b/);
    expect(plan).toMatch(/USING (COVERING )?INDEX/);
  });
});
