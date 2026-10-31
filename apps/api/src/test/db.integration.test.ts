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

  it("records the migration so it is not applied twice", async () => {
    const { results } = await env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{
      name: string;
    }>();

    expect(results.map((r) => r.name)).toEqual(["0001_init.sql"]);
  });

  it("seeds a schema version", async () => {
    const row = await env.DB.prepare("SELECT value FROM app_meta WHERE key = ?")
      .bind("schema_version")
      .first<{ value: string }>();

    expect(row?.value).toBe("1");
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
   * Boundary guard for Tahap 1.
   *
   * If one of these tables appears here, it means a later phase started before
   * its gate was opened (AGENTS.md "Roadmap bertahap"). Adding a table is
   * exactly when you want a failing test, not a silent scope creep.
   */
  it("ships no business tables yet", async () => {
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all<{ name: string }>();

    const tables = results.map((r) => r.name);

    for (const forbidden of [
      "attendance",
      "audit_log",
      "audit_logs",
      "event_memberships",
      "events",
      "invites",
      "outbox",
      "participants",
      "staff",
      "users",
    ]) {
      expect(tables).not.toContain(forbidden);
    }
  });
});
