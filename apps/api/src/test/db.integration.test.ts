import { testEnv as env } from "./env";
import { beforeEach, describe, expect, it } from "vitest";

const NOW = 1_730_000_000_000;

async function seedEvent(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, display_name, role, status, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind("u1", "Admin", "superadmin", "active", NOW),
    env.DB.prepare(
      "INSERT INTO events (id, slug, name, created_at, created_by) VALUES (?, ?, ?, ?, ?)",
    ).bind("e1", "wisuda-2026", "Wisuda 2026", NOW, "u1"),
    env.DB.prepare(
      `INSERT INTO participants
         (id, event_id, external_ref, full_name, qr_token_hash, qr_issued_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind("p1", "e1", "REF-1", "Budi Santoso", "hash-p1", NOW, NOW, NOW),
  ]);
}

async function recordAttendance(): Promise<D1Result<unknown>> {
  return env.DB.prepare(
    `INSERT INTO attendance
       (id, event_id, participant_id, status, checked_in_at, recorded_by, method, created_at, updated_at)
     VALUES (?, ?, ?, 'present', ?, ?, 'qr_scan', ?, ?)
     ON CONFLICT (event_id, participant_id) DO NOTHING`,
  )
    .bind("a1", "e1", "p1", NOW, "u1", NOW, NOW)
    .run();
}

describe("D1 integration", () => {
  beforeEach(async () => {
    await env.DB.exec("DELETE FROM attendance; DELETE FROM participants; DELETE FROM events; DELETE FROM users;");
    await seedEvent();
  });

  it("applies the real migration files (tables + triggers exist)", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();

    const tables = results.map((r) => r.name);

    for (const expected of [
      "attendance",
      "audit_log",
      "device_credentials",
      "event_memberships",
      "events",
      "invites",
      "outbox",
      "participants",
      "rate_limits",
      "recovery_codes",
      "sessions",
      "sheet_rows",
      "sync_state",
      "users",
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it("prevents double attendance at the database level", async () => {
    const first = await recordAttendance();
    const second = await recordAttendance();

    expect(first.meta.changes).toBe(1);
    // Second scan must be reported as "already present", not as a 500.
    expect(second.meta.changes).toBe(0);

    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM attendance WHERE event_id = ? AND participant_id = ?",
    )
      .bind("e1", "p1")
      .first<{ n: number }>();

    expect(count?.n).toBe(1);
  });

  it("keeps audit_log append-only", async () => {
    await env.DB.prepare(
      "INSERT INTO audit_log (id, event_id, actor_user_id, action, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind("au1", "e1", "u1", "attendance.created", "attendance", "a1", NOW)
      .run();

    await expect(
      env.DB.prepare("UPDATE audit_log SET action = 'tampered' WHERE id = ?").bind("au1").run(),
    ).rejects.toThrow(/append-only/);

    await expect(env.DB.prepare("DELETE FROM audit_log WHERE id = ?").bind("au1").run()).rejects.toThrow(
      /append-only/,
    );
  });
});
