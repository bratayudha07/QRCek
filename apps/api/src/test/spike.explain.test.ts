import { testEnv as env } from "./env";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Spike (IMPLEMENTATION_PLAN.md Fase 0): do the planned hot-path queries use
 * indexes?
 *
 * A full table scan on the future attendance table costs 1 row read per row
 * scanned, and the free tier allows 5M row reads/day. `SCAN` here would be a
 * production outage waiting to happen.
 *
 * Fase 0 ships no business tables, so this builds throwaway tables with the
 * same column shapes and the same indexes as `docs/DESAIN_DATABASE.md` §3.
 * The point is to prove the *index design* is sound before the tables exist:
 * if a query plans as SCAN, the design is wrong and must be fixed now, not
 * after the schema is deployed.
 */
const SCHEMA = [
  `CREATE TABLE spike_participants (
     id TEXT PRIMARY KEY,
     event_id TEXT NOT NULL,
     external_ref TEXT,
     full_name TEXT NOT NULL,
     qr_token_hash TEXT NOT NULL
   )`,
  `CREATE UNIQUE INDEX spike_uq_participant_ref
     ON spike_participants(event_id, external_ref)
     WHERE external_ref IS NOT NULL`,
  `CREATE INDEX spike_idx_participant_name ON spike_participants(event_id, full_name)`,
  `CREATE INDEX spike_idx_participant_token ON spike_participants(qr_token_hash)`,
  `CREATE TABLE spike_attendance (
     id TEXT PRIMARY KEY,
     event_id TEXT NOT NULL,
     participant_id TEXT NOT NULL,
     status TEXT NOT NULL,
     checked_in_at INTEGER NOT NULL,
     UNIQUE (event_id, participant_id)
   )`,
  `CREATE INDEX spike_idx_attendance_time ON spike_attendance(event_id, checked_in_at)`,
  `CREATE INDEX spike_idx_attendance_status ON spike_attendance(event_id, status)`,
  `CREATE TABLE spike_outbox (
     id TEXT PRIMARY KEY,
     event_id TEXT NOT NULL,
     participant_id TEXT NOT NULL,
     status TEXT NOT NULL,
     next_attempt_at INTEGER NOT NULL
   )`,
  `CREATE UNIQUE INDEX spike_uq_outbox_pending
     ON spike_outbox(event_id, participant_id)
     WHERE status IN ('pending','inflight','failed')`,
  `CREATE INDEX spike_idx_outbox_due ON spike_outbox(status, next_attempt_at)`,
  `CREATE TABLE spike_sessions (
     id TEXT PRIMARY KEY,
     token_hash TEXT NOT NULL,
     user_id TEXT NOT NULL
   )`,
  `CREATE INDEX spike_idx_session_token ON spike_sessions(token_hash)`,
  `CREATE TABLE spike_memberships (
     id TEXT PRIMARY KEY,
     event_id TEXT NOT NULL,
     user_id TEXT NOT NULL,
     status TEXT NOT NULL
   )`,
  `CREATE INDEX spike_idx_membership_user ON spike_memberships(user_id, status)`,
  `CREATE TABLE spike_audit (
     id TEXT PRIMARY KEY,
     event_id TEXT NOT NULL,
     created_at INTEGER NOT NULL
   )`,
  `CREATE INDEX spike_idx_audit_event_time ON spike_audit(event_id, created_at DESC)`,
];

const QUERIES: ReadonlyArray<{ name: string; sql: string; params: string[] }> = [
  {
    name: "scan: participant by token hash",
    sql: "SELECT id FROM spike_participants WHERE qr_token_hash = ?",
    params: ["h1"],
  },
  {
    name: "attendance: by event + participant (unique)",
    sql: "SELECT id FROM spike_attendance WHERE event_id = ? AND participant_id = ?",
    params: ["e1", "p1"],
  },
  {
    name: "attendance: recap ordered by time",
    sql: "SELECT id FROM spike_attendance WHERE event_id = ? ORDER BY checked_in_at DESC",
    params: ["e1"],
  },
  {
    name: "attendance: counts per status",
    sql: "SELECT status, COUNT(*) FROM spike_attendance WHERE event_id = ? GROUP BY status",
    params: ["e1"],
  },
  {
    name: "participants: list per event ordered by name",
    sql: "SELECT id FROM spike_participants WHERE event_id = ? ORDER BY full_name LIMIT 50",
    params: ["e1"],
  },
  {
    name: "participants: lookup by external ref",
    sql: "SELECT id FROM spike_participants WHERE event_id = ? AND external_ref = ?",
    params: ["e1", "R1"],
  },
  {
    name: "outbox: due items",
    sql: "SELECT id FROM spike_outbox WHERE status = 'pending' AND next_attempt_at <= ?",
    params: ["1730000000000"],
  },
  {
    name: "session: by token hash",
    sql: "SELECT id FROM spike_sessions WHERE token_hash = ?",
    params: ["t1"],
  },
  {
    name: "membership: by user",
    sql: "SELECT event_id FROM spike_memberships WHERE user_id = ? AND status = 'active'",
    params: ["u1"],
  },
  {
    name: "audit: by event ordered by time",
    sql: "SELECT id FROM spike_audit WHERE event_id = ? ORDER BY created_at DESC LIMIT 50",
    params: ["e1"],
  },
];

describe("spike: EXPLAIN QUERY PLAN", () => {
  beforeAll(async () => {
    // `db.exec()` splits SQL per line, so multi-line DDL goes through
    // `prepare().run()` (docs/OPERASIONAL.md §4.2).
    for (const statement of SCHEMA) {
      await env.DB.prepare(statement).run();
    }
  });

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

  it("uses the real migrated table for the only query that exists today", async () => {
    const { results } = await env.DB.prepare(
      "EXPLAIN QUERY PLAN SELECT value FROM app_meta WHERE key = ?",
    )
      .bind("schema_version")
      .all<{ detail: string }>();

    const plan = results.map((r) => r.detail).join(" | ");

    expect(plan).toMatch(/USING (COVERING )?INDEX/);
  });
});
