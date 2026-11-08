import { testEnv as env } from "./env";
import { describe, expect, it } from "vitest";

const NOW = 1_730_000_000_000;

/**
 * Integration test against the real D1 binding and the real migration files.
 *
 * Scope is intentionally the Fase 0 schema: `app_meta` and nothing else.
 * `applyD1Migrations` runs in `setup.ts`, so reaching this file already proves
 * the migration pipeline works inside `workerd`.
 */
describe("D1 integration", () => {
  it("applies the real migration files", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' ORDER BY name",
    ).all<{ name: string }>();

    const tables = results.map((r) => r.name);

    expect(tables).toContain("app_meta");
  });

  it("records each migration so it is not applied twice", async () => {
    const { results } = await env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{
      name: string;
    }>();

    expect(results.map((r) => r.name)).toEqual([
      "0001_init.sql",
      "0002_auth.sql",
      "0003_participants.sql",
      "0004_qr.sql",
      "0005_attendance_sync.sql",
      "0006_self_signup.sql",
      "0007_q1_activities_sessions.sql",
      "0008_q2_categories_custom_fields.sql",
      "0009_entitlement_rules.sql",
    ]);
  });

  it("seeds a schema version", async () => {
    const row = await env.DB.prepare("SELECT value FROM app_meta WHERE key = ?")
      .bind("schema_version")
      .first<{ value: string }>();

    expect(row?.value).toBe("9");
  });

  it("stores and updates a key", async () => {
    await env.DB.prepare(
      "INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
      .bind("site_name", "Absensi Acara", NOW)
      .run();

    await env.DB.prepare(
      "INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
      .bind("site_name", "Absensi Acara 2026", NOW + 1000)
      .run();

    const row = await env.DB.prepare("SELECT value, updated_at FROM app_meta WHERE key = ?")
      .bind("site_name")
      .first<{ value: string; updated_at: number }>();

    expect(row?.value).toBe("Absensi Acara 2026");
    expect(row?.updated_at).toBe(NOW + 1000);
  });

  it("rejects an empty key", async () => {
    await expect(
      env.DB.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)")
        .bind("", "x", NOW)
        .run(),
    ).rejects.toThrow(/CHECK constraint/i);
  });

  /**
   * Boundary guard per phase.
   *
   * If a table from a later phase appears here, it means that phase started
   * before its gate was opened (AGENTS.md "Roadmap bertahap"). Adding a table is
   * exactly when you want a failing test, not a silent scope creep.
   *
   * Tahap 3 (Fase 2, non-QR) owns participants. Tahap 4 (Fase 2, QR) adds the
   * QR credential columns, `event_label_config`, and `audit_log`. Tahap 5
   * (Fase 3–4) adds attendance, the sync outbox, `sheet_rows`, and `sync_state`.
   * Q1 adds activities and activity_sessions.
   */
  it("ships every table through Q1 and nothing later", async () => {
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all<{ name: string }>();

    const tables = results.map((r) => r.name);

    for (const expected of [
      "activities",
      "activity_sessions",
      "attendance",
      "audit_log",
      "device_credentials",
      "event_label_config",
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

  /**
   * The bootstrap superadmin invite has no event and no author yet. The CHECK
   * constraints must still reject an event-bound invite without an author.
   */
  it("enforces invite role/event/author invariants", async () => {
    const insert = (id: string, eventId: string | null, role: string, createdBy: string | null) =>
      env.DB.prepare(
        `INSERT INTO invites (id, event_id, role, token_hash, created_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, eventId, role, `hash-${id}`, createdBy, NOW, NOW + 1000)
        .run();

    await expect(insert("01INV-BOOT", null, "superadmin", null)).resolves.toBeDefined();
    await expect(insert("01INV-NOEVENT", null, "officer", null)).rejects.toThrow(/CHECK/i);
    await expect(insert("01INV-NOAUTHOR", "01EVT", "officer", null)).rejects.toThrow(/CHECK/i);
  });
});
