import { describe, expect, it } from "vitest";

import { insertActivityStatement, updateActivityStatement } from "../db/activities";
import {
  insertActivitySessionStatement,
  updateActivitySessionStatement,
} from "../db/activity-sessions";
import {
  insertAuditAfterActivityUpdateStatement,
  insertAuditAfterSessionUpdateStatement,
  insertAuditAfterThemeStatusStatement,
} from "../db/audit";
import { newId } from "../domain/ids";
import { testEnv as env } from "./env";
import { createEvent, createUser } from "./fixtures";
import { TEST_NOW } from "./http";

/**
 * I-35 `audit.guarded-write` (RENCANA_PENGUJIAN.md).
 *
 * "Audit written" has to mean "mutation landed". Every audit insert runs in the
 * same `db.batch` as its mutation and re-checks a condition that only holds when
 * the mutation landed: `updated_at` for Aktivitas/Sesi, current `status` for
 * Tema (events has no `updated_at`).
 *
 * These tests drive the statement builders directly with a stale expectation so
 * the race is deterministic. Route-level tests cover the happy path; deleting
 * the guard has to make this file red.
 */

async function auditCount(entityId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_id = ?")
    .bind(entityId)
    .first<{ n: number }>();

  return row?.n ?? 0;
}

async function seedActivity(createdBy: string): Promise<{ themeId: string; activityId: string }> {
  const themeId = await createEvent({ createdBy });
  const activityId = newId(TEST_NOW + 1);

  await insertActivityStatement(env.DB, {
    id: activityId,
    themeId,
    name: "Aktivitas Uji",
    description: null,
    transactionType: "attendance",
    location: null,
    sortOrder: 0,
    createdBy,
    createdAt: TEST_NOW,
  }).run();

  return { themeId, activityId };
}

describe("audit guarded write (I-35)", () => {
  it("writes no audit row when an activity update loses the optimistic race", async () => {
    const user = await createUser({ role: "event_admin" });
    const { themeId, activityId } = await seedActivity(user);
    const now = TEST_NOW + 1_000;

    const results = await env.DB.batch([
      updateActivityStatement(env.DB, {
        themeId,
        activityId,
        update: { name: "Nama Baru" },
        actorUserId: user,
        now,
        // Stale: the row still carries created_at/updated_at == TEST_NOW.
        expectedUpdatedAt: TEST_NOW - 1,
      }),
      insertAuditAfterActivityUpdateStatement(
        env.DB,
        {
          id: newId(TEST_NOW + 2),
          eventId: themeId,
          actorUserId: user,
          action: "activity.updated",
          entityType: "activity",
          entityId: activityId,
          before: { name: "Aktivitas Uji" },
          after: { name: "Nama Baru" },
          createdAt: now,
        },
        activityId,
        now,
      ),
    ]);

    expect(results[0]?.meta.changes).toBe(0);
    expect(await auditCount(activityId)).toBe(0);
  });

  it("writes exactly one audit row when the same activity update lands", async () => {
    const user = await createUser({ role: "event_admin" });
    const { themeId, activityId } = await seedActivity(user);
    const now = TEST_NOW + 1_000;

    const results = await env.DB.batch([
      updateActivityStatement(env.DB, {
        themeId,
        activityId,
        update: { name: "Nama Baru" },
        actorUserId: user,
        now,
        expectedUpdatedAt: TEST_NOW,
      }),
      insertAuditAfterActivityUpdateStatement(
        env.DB,
        {
          id: newId(TEST_NOW + 3),
          eventId: themeId,
          actorUserId: user,
          action: "activity.updated",
          entityType: "activity",
          entityId: activityId,
          before: { name: "Aktivitas Uji" },
          after: { name: "Nama Baru" },
          createdAt: now,
        },
        activityId,
        now,
      ),
    ]);

    expect(results[0]?.meta.changes).toBe(1);
    expect(await auditCount(activityId)).toBe(1);
  });

  it("writes no audit row when a session update loses the optimistic race", async () => {
    const user = await createUser({ role: "event_admin" });
    const { themeId, activityId } = await seedActivity(user);
    const sessionId = newId(TEST_NOW + 4);

    await insertActivitySessionStatement(env.DB, {
      id: sessionId,
      activityId,
      name: "Sesi Uji",
      location: null,
      startsAt: null,
      endsAt: null,
      createdBy: user,
      createdAt: TEST_NOW,
    }).run();

    const now = TEST_NOW + 1_000;

    const results = await env.DB.batch([
      updateActivitySessionStatement(env.DB, {
        activityId,
        sessionId,
        update: { name: "Sesi Baru" },
        actorUserId: user,
        now,
        expectedUpdatedAt: TEST_NOW - 1,
      }),
      insertAuditAfterSessionUpdateStatement(
        env.DB,
        {
          id: newId(TEST_NOW + 5),
          eventId: themeId,
          actorUserId: user,
          action: "session.updated",
          entityType: "session",
          entityId: sessionId,
          before: { name: "Sesi Uji" },
          after: { name: "Sesi Baru" },
          createdAt: now,
        },
        sessionId,
        now,
      ),
    ]);

    expect(results[0]?.meta.changes).toBe(0);
    expect(await auditCount(sessionId)).toBe(0);
  });

  it("writes exactly one audit row when the same session update lands", async () => {
    const user = await createUser({ role: "event_admin" });
    const { themeId, activityId } = await seedActivity(user);
    const sessionId = newId(TEST_NOW + 6);

    await insertActivitySessionStatement(env.DB, {
      id: sessionId,
      activityId,
      name: "Sesi Uji",
      location: null,
      startsAt: null,
      endsAt: null,
      createdBy: user,
      createdAt: TEST_NOW,
    }).run();

    const now = TEST_NOW + 1_000;

    const results = await env.DB.batch([
      updateActivitySessionStatement(env.DB, {
        activityId,
        sessionId,
        update: { name: "Sesi Baru" },
        actorUserId: user,
        now,
        expectedUpdatedAt: TEST_NOW,
      }),
      insertAuditAfterSessionUpdateStatement(
        env.DB,
        {
          id: newId(TEST_NOW + 7),
          eventId: themeId,
          actorUserId: user,
          action: "session.updated",
          entityType: "session",
          entityId: sessionId,
          before: { name: "Sesi Uji" },
          after: { name: "Sesi Baru" },
          createdAt: now,
        },
        sessionId,
        now,
      ),
    ]);

    expect(results[0]?.meta.changes).toBe(1);
    expect(await auditCount(sessionId)).toBe(1);
  });

  it("guards theme audit on the status the caller expected", async () => {
    const user = await createUser({ role: "superadmin" });
    const themeId = await createEvent({ createdBy: user });

    const stale = await insertAuditAfterThemeStatusStatement(
      env.DB,
      {
        id: newId(TEST_NOW + 8),
        eventId: themeId,
        actorUserId: user,
        action: "theme.status_changed",
        entityType: "theme",
        entityId: themeId,
        before: { status: "draft" },
        after: { status: "active" },
        createdAt: TEST_NOW + 1_000,
      },
      themeId,
      // The row is still `draft`: a concurrent status change would make this 0.
      "active",
    ).run();

    expect(stale.meta.changes).toBe(0);

    const current = await insertAuditAfterThemeStatusStatement(
      env.DB,
      {
        id: newId(TEST_NOW + 9),
        eventId: themeId,
        actorUserId: user,
        action: "theme.status_changed",
        entityType: "theme",
        entityId: themeId,
        before: { status: "draft" },
        after: { status: "active" },
        createdAt: TEST_NOW + 1_000,
      },
      themeId,
      "draft",
    ).run();

    expect(current.meta.changes).toBe(1);
    expect(await auditCount(themeId)).toBe(1);
  });
});
