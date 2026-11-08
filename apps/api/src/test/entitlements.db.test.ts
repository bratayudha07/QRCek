import { describe, expect, it } from "vitest";

import migrationSql from "../../../../migrations/0009_entitlement_rules.sql?raw";

import { insertActivityStatement } from "../db/activities";
import { insertActivitySessionStatement } from "../db/activity-sessions";
import type { EntitlementRuleRow } from "../db/entitlement-rules";
import {
  insertEntitlementRuleStatement,
  listRulesForContext,
  resolverRulesSql,
} from "../db/entitlement-rules";
import { newId } from "../domain/ids";
import { testEnv as env } from "./env";
import {
  createCategory,
  createEvent,
  createParticipant,
  createUser,
} from "./fixtures";
import { TEST_NOW } from "./http";

/**
 * T-040/T-041/T-042 database guardrails and Q3 measurements
 * (RENCANA_PENGUJIAN.md §9.2, §9.4, §9.5).
 *
 * These tests use the migrated schema; `?raw` loads the real `0009` SQL so the
 * backfill test exercises the migration statement instead of a copy.
 */

interface Seeded {
  themeId: string;
  activityId: string;
  sessionId: string;
  categoryId: string;
  participantId: string;
  userId: string;
}

async function seedTheme(): Promise<{
  themeId: string;
  activityId: string;
  sessionId: string;
  categoryId: string;
  participantId: string;
  userId: string;
}> {
  const userId = await createUser({ role: "event_admin" });
  const themeId = await createEvent({ createdBy: userId });
  const activityId = newId(TEST_NOW + 1);
  const sessionId = newId(TEST_NOW + 2);
  const category = await createCategory(themeId, { name: "Kelas Uji" });
  const participant = await createParticipant(themeId, {
    categoryId: category.id,
    fullName: "Peserta Uji",
  });

  await insertActivityStatement(env.DB, {
    id: activityId,
    themeId,
    name: "Aktivitas Uji",
    description: null,
    transactionType: "attendance",
    location: null,
    sortOrder: 0,
    createdBy: userId,
    createdAt: TEST_NOW,
  }).run();

  await insertActivitySessionStatement(env.DB, {
    id: sessionId,
    activityId,
    name: "Sesi Uji",
    location: null,
    startsAt: null,
    endsAt: null,
    createdBy: userId,
    createdAt: TEST_NOW,
  }).run();

  return {
    themeId,
    activityId,
    sessionId,
    categoryId: category.id,
    participantId: participant.id,
    userId,
  };
}

function insertRule(
  seeded: Seeded,
  level: "theme" | "individual_activity" | "category_activity" | "individual_session" | "category_session",
): Promise<unknown> {
  const id = newId(TEST_NOW + 10);
  const base = {
    id,
    themeId: seeded.themeId,
    status: "allowed" as const,
    createdAt: TEST_NOW,
    createdBy: seeded.userId,
  };

  switch (level) {
    case "theme":
      return insertEntitlementRuleStatement(env.DB, {
        ...base,
        activityId: null,
        sessionId: null,
        participantId: null,
        categoryId: null,
      }).run();
    case "individual_activity":
      return insertEntitlementRuleStatement(env.DB, {
        ...base,
        activityId: seeded.activityId,
        sessionId: null,
        participantId: seeded.participantId,
        categoryId: null,
      }).run();
    case "category_activity":
      return insertEntitlementRuleStatement(env.DB, {
        ...base,
        activityId: seeded.activityId,
        sessionId: null,
        participantId: null,
        categoryId: seeded.categoryId,
      }).run();
    case "individual_session":
      return insertEntitlementRuleStatement(env.DB, {
        ...base,
        activityId: seeded.activityId,
        sessionId: seeded.sessionId,
        participantId: seeded.participantId,
        categoryId: null,
      }).run();
    case "category_session":
      return insertEntitlementRuleStatement(env.DB, {
        ...base,
        activityId: seeded.activityId,
        sessionId: seeded.sessionId,
        participantId: null,
        categoryId: seeded.categoryId,
      }).run();
  }
}

describe("entitlement_rules persistence", () => {
  it("allows exactly one theme default per Tema", async () => {
    const seeded = await seedTheme();
    await insertRule(seeded, "theme");

    await expect(insertRule(seeded, "theme")).rejects.toThrow(/UNIQUE/i);
  });

  it.each([
    ["individual_activity", "individual_activity"],
    ["category_activity", "category_activity"],
    ["individual_session", "individual_session"],
    ["category_session", "category_session"],
  ] as const)("rejects a duplicate %s cell", async (_label, level) => {
    const seeded = await seedTheme();
    await insertRule(seeded, level);

    await expect(insertRule(seeded, level)).rejects.toThrow(/UNIQUE/i);
  });

  it("rejects a category that belongs to another Tema", async () => {
    const seeded = await seedTheme();
    const otherUser = await createUser({ role: "event_admin" });
    const otherTheme = await createEvent({ createdBy: otherUser });
    const foreignCategory = await createCategory(otherTheme, { name: "Kelas Lain" });

    await expect(
      insertEntitlementRuleStatement(env.DB, {
        id: newId(TEST_NOW + 20),
        themeId: seeded.themeId,
        activityId: seeded.activityId,
        sessionId: null,
        participantId: null,
        categoryId: foreignCategory.id,
        status: "allowed",
        createdAt: TEST_NOW,
        createdBy: seeded.userId,
      }).run(),
    ).rejects.toThrow(/category does not belong to this theme/i);
  });

  it("rejects a participant that belongs to another Tema", async () => {
    const seeded = await seedTheme();
    const otherUser = await createUser({ role: "event_admin" });
    const otherTheme = await createEvent({ createdBy: otherUser });
    const otherCategory = await createCategory(otherTheme, { name: "Kelas Lain" });
    const foreignParticipant = await createParticipant(otherTheme, {
      categoryId: otherCategory.id,
      fullName: "Peserta Lain",
    });

    await expect(
      insertEntitlementRuleStatement(env.DB, {
        id: newId(TEST_NOW + 21),
        themeId: seeded.themeId,
        activityId: seeded.activityId,
        sessionId: null,
        participantId: foreignParticipant.id,
        categoryId: null,
        status: "allowed",
        createdAt: TEST_NOW,
        createdBy: seeded.userId,
      }).run(),
    ).rejects.toThrow(/participant does not belong to this theme/i);
  });

  it("rejects an activity that belongs to another Tema", async () => {
    const seeded = await seedTheme();
    const otherUser = await createUser({ role: "event_admin" });
    const otherTheme = await createEvent({ createdBy: otherUser });
    const foreignActivity = newId(TEST_NOW + 22);

    await insertActivityStatement(env.DB, {
      id: foreignActivity,
      themeId: otherTheme,
      name: "Aktivitas Lain",
      description: null,
      transactionType: "attendance",
      location: null,
      sortOrder: 0,
      createdBy: otherUser,
      createdAt: TEST_NOW,
    }).run();

    await expect(
      insertEntitlementRuleStatement(env.DB, {
        id: newId(TEST_NOW + 23),
        themeId: seeded.themeId,
        activityId: foreignActivity,
        sessionId: null,
        participantId: null,
        categoryId: seeded.categoryId,
        status: "allowed",
        createdAt: TEST_NOW,
        createdBy: seeded.userId,
      }).run(),
    ).rejects.toThrow(/activity does not belong to this theme/i);
  });

  it("rejects a session that belongs to another activity", async () => {
    const seeded = await seedTheme();
    const otherActivity = newId(TEST_NOW + 24);
    const foreignSession = newId(TEST_NOW + 25);

    await insertActivityStatement(env.DB, {
      id: otherActivity,
      themeId: seeded.themeId,
      name: "Aktivitas Lain",
      description: null,
      transactionType: "attendance",
      location: null,
      sortOrder: 0,
      createdBy: seeded.userId,
      createdAt: TEST_NOW,
    }).run();

    await insertActivitySessionStatement(env.DB, {
      id: foreignSession,
      activityId: otherActivity,
      name: "Sesi Lain",
      location: null,
      startsAt: null,
      endsAt: null,
      createdBy: seeded.userId,
      createdAt: TEST_NOW,
    }).run();

    await expect(
      insertEntitlementRuleStatement(env.DB, {
        id: newId(TEST_NOW + 26),
        themeId: seeded.themeId,
        activityId: seeded.activityId,
        sessionId: foreignSession,
        participantId: null,
        categoryId: seeded.categoryId,
        status: "allowed",
        createdAt: TEST_NOW,
        createdBy: seeded.userId,
      }).run(),
    ).rejects.toThrow(/session does not belong to this activity/i);
  });

  it("keeps ON DELETE RESTRICT on referenced activities", async () => {
    const seeded = await seedTheme();
    await insertRule(seeded, "category_activity");

    await expect(
      env.DB.prepare("DELETE FROM activities WHERE id = ?").bind(seeded.activityId).run(),
    ).rejects.toThrow(/FOREIGN KEY/i);
  });
});

function backfillStatement(): string {
  const start = migrationSql.indexOf("-- >>> backfill");
  const end = migrationSql.indexOf("-- <<< backfill");
  if (start === -1 || end === -1) {
    throw new Error("0009 backfill markers not found");
  }
  return migrationSql.slice(start + "-- >>> backfill".length, end);
}

describe("0009 backfill", () => {
  it("backfills active activities only and includes archived categories with participants", async () => {
    const userId = await createUser({ role: "event_admin" });
    const themeId = await createEvent({ createdBy: userId });
    const activeActivity = newId(TEST_NOW + 30);
    const draftActivity = newId(TEST_NOW + 31);

    const activeCategory = await createCategory(themeId, { name: "Kelas Aktif" });
    const archivedWithParticipant = await createCategory(themeId, {
      name: "Kelas Arsip Berpeserta",
      status: "archived",
    });
    await createCategory(themeId, { name: "Kelas Arsip Kosong", status: "archived" });
    await createParticipant(themeId, {
      categoryId: archivedWithParticipant.id,
      fullName: "Peserta Lama",
    });

    for (const [id, status] of [
      [activeActivity, "active"],
      [draftActivity, "draft"],
    ] as const) {
      await insertActivityStatement(env.DB, {
        id,
        themeId,
        name: `Aktivitas ${status}`,
        description: null,
        transactionType: "attendance",
        location: null,
        sortOrder: 0,
        createdBy: userId,
        createdAt: TEST_NOW,
      }).run();
      await env.DB.prepare(
        "UPDATE activities SET status = ?, archived_at = NULL WHERE id = ?",
      )
        .bind(status, id)
        .run();
    }

    await env.DB.prepare(backfillStatement()).run();

    const rows = await env.DB.prepare(
      `SELECT activity_id, category_id, status, participant_id, session_id
         FROM entitlement_rules ORDER BY activity_id, category_id`,
    ).all<{
      activity_id: string;
      category_id: string;
      status: string;
      participant_id: string | null;
      session_id: string | null;
    }>();

    expect(rows.results).toHaveLength(2);
    expect(rows.results.every((row) => row.status === "allowed")).toBe(true);
    expect(rows.results.every((row) => row.activity_id === activeActivity)).toBe(true);
    expect(rows.results.map((row) => row.category_id).sort()).toEqual(
      [activeCategory.id, archivedWithParticipant.id].sort(),
    );
    expect(rows.results.every((row) => row.session_id === null)).toBe(true);
    expect(rows.results.every((row) => row.participant_id === null)).toBe(true);

    // Idempotent: re-running does not duplicate cells or pretend the draft is complete.
    await env.DB.prepare(backfillStatement()).run();
    const afterSecondRun = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM entitlement_rules",
    ).first<{ n: number }>();
    expect(afterSecondRun?.n).toBe(2);
  });
});

describe("resolver query plan and row budget", () => {
  it("uses a SEARCH for every UNION ALL branch", async () => {
    for (const hasSession of [true, false]) {
      const sql = resolverRulesSql(hasSession);
      const bindings = Array.from({ length: hasSession ? 15 : 7 }, () => "x");
      const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .bind(...bindings)
        .all<{ detail: string }>();

      const plan = results.map((row) => row.detail).join(" | ");
      const expectedBranches = hasSession ? 5 : 3;

      expect(plan).not.toMatch(/\bSCAN\b/);
      expect(plan.match(/\bSEARCH\b/g) ?? []).toHaveLength(expectedBranches);
    }
  });

  it("returns at most five rows, one per configured level", async () => {
    const seeded = await seedTheme();
    await insertRule(seeded, "theme");
    await insertRule(seeded, "individual_activity");
    await insertRule(seeded, "category_activity");
    await insertRule(seeded, "individual_session");
    await insertRule(seeded, "category_session");

    const rows = await listRulesForContext(env.DB, {
      themeId: seeded.themeId,
      participantId: seeded.participantId,
      categoryId: seeded.categoryId,
      activityId: seeded.activityId,
      sessionId: seeded.sessionId,
    });

    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((row) => row.level)).size).toBe(5);

    const activityOnly = await listRulesForContext(env.DB, {
      themeId: seeded.themeId,
      participantId: seeded.participantId,
      categoryId: seeded.categoryId,
      activityId: seeded.activityId,
      sessionId: null,
    });
    expect(activityOnly).toHaveLength(3);
    expect(activityOnly.some((row) => row.level.endsWith("_session"))).toBe(false);
  });

  it("selects only the current Tema's rows", async () => {
    const seeded = await seedTheme();
    await insertRule(seeded, "category_activity");

    const rows = await env.DB.prepare(
      "SELECT theme_id FROM entitlement_rules WHERE activity_id = ?",
    )
      .bind(seeded.activityId)
      .all<Pick<EntitlementRuleRow, "theme_id">>();

    expect(rows.results.every((row) => row.theme_id === seeded.themeId)).toBe(true);
  });
});
