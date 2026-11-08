import { describe, expect, it } from "vitest";

import { insertActivityStatement, updateActivityStatement } from "../db/activities";
import {
  insertActivitySessionStatement,
  updateActivitySessionStatement,
} from "../db/activity-sessions";
import {
  insertAuditAfterActivityUpdateStatement,
  insertAuditAfterCategoryUpdateStatement,
  insertAuditAfterCustomFieldUpdateStatement,
  insertAuditAfterEntitlementRuleDeleteStatement,
  insertAuditAfterEntitlementRuleUpdateStatement,
  insertAuditAfterParticipantUpdateStatement,
  insertAuditAfterSessionUpdateStatement,
  insertAuditAfterThemeStatusStatement,
} from "../db/audit";
import { updateCategoryStatement } from "../db/categories";
import {
  deleteEntitlementRuleStatement,
  insertEntitlementRuleStatement,
  updateEntitlementRuleStatusStatement,
} from "../db/entitlement-rules";
import { updateCustomFieldStatement } from "../db/custom-fields";
import { updateParticipantStatement } from "../db/participants";
import { newId } from "../domain/ids";
import { testEnv as env } from "./env";
import {
  createCategory,
  createCustomField,
  createEvent,
  createParticipant,
  createUser,
} from "./fixtures";
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

  it("writes no category audit row when the update loses the optimistic race", async () => {
    const user = await createUser({ role: "event_admin" });
    const themeId = await createEvent({ createdBy: user });
    const category = await createCategory(themeId, { name: "Kelas 7A" });

    const stale = await env.DB.batch([
      updateCategoryStatement(env.DB, {
        themeId,
        categoryId: category.id,
        update: { name: "Kelas 7B" },
        actorUserId: user,
        now: TEST_NOW + 1_000,
        expectedUpdatedAt: TEST_NOW - 1,
      }),
      insertAuditAfterCategoryUpdateStatement(
        env.DB,
        {
          id: newId(TEST_NOW + 10),
          eventId: themeId,
          actorUserId: user,
          action: "category.updated",
          entityType: "category",
          entityId: category.id,
          before: { name: "Kelas 7A" },
          after: { name: "Kelas 7B" },
          createdAt: TEST_NOW + 1_000,
        },
        category.id,
        TEST_NOW + 1_000,
      ),
    ]);

    expect(stale[0]?.meta.changes).toBe(0);
    expect(await auditCount(category.id)).toBe(0);

    const current = await env.DB.batch([
      updateCategoryStatement(env.DB, {
        themeId,
        categoryId: category.id,
        update: { name: "Kelas 7B" },
        actorUserId: user,
        now: TEST_NOW + 1_000,
        expectedUpdatedAt: TEST_NOW,
      }),
      insertAuditAfterCategoryUpdateStatement(
        env.DB,
        {
          id: newId(TEST_NOW + 11),
          eventId: themeId,
          actorUserId: user,
          action: "category.updated",
          entityType: "category",
          entityId: category.id,
          before: { name: "Kelas 7A" },
          after: { name: "Kelas 7B" },
          createdAt: TEST_NOW + 1_000,
        },
        category.id,
        TEST_NOW + 1_000,
      ),
    ]);

    expect(current[0]?.meta.changes).toBe(1);
    expect(await auditCount(category.id)).toBe(1);
  });

  it("writes no custom-field audit row when the update loses the optimistic race", async () => {
    const user = await createUser({ role: "event_admin" });
    const themeId = await createEvent({ createdBy: user });
    const field = await createCustomField(themeId, { key: "nisn", label: "NISN" });

    const stale = await env.DB.batch([
      updateCustomFieldStatement(env.DB, {
        themeId,
        fieldId: field.id,
        update: { label: "NISN Baru" },
        actorUserId: user,
        now: TEST_NOW + 1_000,
        expectedUpdatedAt: TEST_NOW - 1,
      }),
      insertAuditAfterCustomFieldUpdateStatement(
        env.DB,
        {
          id: newId(TEST_NOW + 12),
          eventId: themeId,
          actorUserId: user,
          action: "custom_field.updated",
          entityType: "custom_field",
          entityId: field.id,
          before: { label: "NISN" },
          after: { label: "NISN Baru" },
          createdAt: TEST_NOW + 1_000,
        },
        field.id,
        TEST_NOW + 1_000,
      ),
    ]);

    expect(stale[0]?.meta.changes).toBe(0);
    expect(await auditCount(field.id)).toBe(0);

    const current = await env.DB.batch([
      updateCustomFieldStatement(env.DB, {
        themeId,
        fieldId: field.id,
        update: { label: "NISN Baru" },
        actorUserId: user,
        now: TEST_NOW + 1_000,
        expectedUpdatedAt: TEST_NOW,
      }),
      insertAuditAfterCustomFieldUpdateStatement(
        env.DB,
        {
          id: newId(TEST_NOW + 13),
          eventId: themeId,
          actorUserId: user,
          action: "custom_field.updated",
          entityType: "custom_field",
          entityId: field.id,
          before: { label: "NISN" },
          after: { label: "NISN Baru" },
          createdAt: TEST_NOW + 1_000,
        },
        field.id,
        TEST_NOW + 1_000,
      ),
    ]);

    expect(current[0]?.meta.changes).toBe(1);
    expect(await auditCount(field.id)).toBe(1);
  });

  it("writes no participant audit row when the update loses the optimistic race", async () => {
    const user = await createUser({ role: "event_admin" });
    const themeId = await createEvent({ createdBy: user });
    const participant = await createParticipant(themeId, { fullName: "Siti" });

    const stale = await env.DB.batch([
      updateParticipantStatement(env.DB, {
        eventId: themeId,
        participantId: participant.id,
        update: { fullName: "Siti Baru" },
        now: TEST_NOW + 1_000,
        expectedUpdatedAt: TEST_NOW - 1,
      }),
      insertAuditAfterParticipantUpdateStatement(
        env.DB,
        {
          id: newId(TEST_NOW + 14),
          eventId: themeId,
          actorUserId: user,
          action: "participant.updated",
          entityType: "participant",
          entityId: participant.id,
          before: { status: "active" },
          after: { status: "active" },
          createdAt: TEST_NOW + 1_000,
        },
        participant.id,
        TEST_NOW + 1_000,
      ),
    ]);

    expect(stale[0]?.meta.changes).toBe(0);
    expect(await auditCount(participant.id)).toBe(0);

    const current = await env.DB.batch([
      updateParticipantStatement(env.DB, {
        eventId: themeId,
        participantId: participant.id,
        update: { fullName: "Siti Baru" },
        now: TEST_NOW + 1_000,
        expectedUpdatedAt: TEST_NOW,
      }),
      insertAuditAfterParticipantUpdateStatement(
        env.DB,
        {
          id: newId(TEST_NOW + 15),
          eventId: themeId,
          actorUserId: user,
          action: "participant.updated",
          entityType: "participant",
          entityId: participant.id,
          before: { status: "active" },
          after: { status: "active" },
          createdAt: TEST_NOW + 1_000,
        },
        participant.id,
        TEST_NOW + 1_000,
      ),
    ]);

    expect(current[0]?.meta.changes).toBe(1);
    expect(await auditCount(participant.id)).toBe(1);
  });

  it("guards entitlement rule audit on updated_at and on the row being gone", async () => {
    const user = await createUser({ role: "event_admin" });
    const { themeId, activityId } = await seedActivity(user);
    const category = await createCategory(themeId, { name: "Kelas Entitlement" });
    const ruleId = newId(TEST_NOW + 20);
    const now = TEST_NOW + 1_000;

    await insertEntitlementRuleStatement(env.DB, {
      id: ruleId,
      themeId,
      activityId,
      sessionId: null,
      participantId: null,
      categoryId: category.id,
      status: "inherit",
      createdAt: TEST_NOW,
      createdBy: user,
    }).run();

    const stale = await env.DB.batch([
      updateEntitlementRuleStatusStatement(env.DB, {
        themeId,
        ruleId,
        status: "allowed",
        actorUserId: user,
        now,
        expectedUpdatedAt: TEST_NOW - 1,
      }),
      insertAuditAfterEntitlementRuleUpdateStatement(
        env.DB,
        {
          id: newId(TEST_NOW + 21),
          eventId: themeId,
          actorUserId: user,
          action: "entitlement_rule.updated",
          entityType: "entitlement_rule",
          entityId: ruleId,
          before: { status: "inherit" },
          after: { status: "allowed" },
          createdAt: now,
        },
        ruleId,
        now,
      ),
    ]);

    expect(stale[0]?.meta.changes).toBe(0);
    expect(await auditCount(ruleId)).toBe(0);

    const current = await env.DB.batch([
      updateEntitlementRuleStatusStatement(env.DB, {
        themeId,
        ruleId,
        status: "allowed",
        actorUserId: user,
        now,
        expectedUpdatedAt: TEST_NOW,
      }),
      insertAuditAfterEntitlementRuleUpdateStatement(
        env.DB,
        {
          id: newId(TEST_NOW + 22),
          eventId: themeId,
          actorUserId: user,
          action: "entitlement_rule.updated",
          entityType: "entitlement_rule",
          entityId: ruleId,
          before: { status: "inherit" },
          after: { status: "allowed" },
          createdAt: now,
        },
        ruleId,
        now,
      ),
    ]);

    expect(current[0]?.meta.changes).toBe(1);
    expect(await auditCount(ruleId)).toBe(1);

    const staleDelete = await env.DB.batch([
      deleteEntitlementRuleStatement(env.DB, {
        themeId,
        ruleId,
        expectedUpdatedAt: TEST_NOW,
      }),
      insertAuditAfterEntitlementRuleDeleteStatement(
        env.DB,
        {
          id: newId(TEST_NOW + 23),
          eventId: themeId,
          actorUserId: user,
          action: "entitlement_rule.deleted",
          entityType: "entitlement_rule",
          entityId: ruleId,
          before: { status: "allowed" },
          createdAt: now,
        },
        ruleId,
      ),
    ]);

    expect(staleDelete[0]?.meta.changes).toBe(0);
    expect(await auditCount(ruleId)).toBe(1);

    const deleted = await env.DB.batch([
      deleteEntitlementRuleStatement(env.DB, {
        themeId,
        ruleId,
        expectedUpdatedAt: now,
      }),
      insertAuditAfterEntitlementRuleDeleteStatement(
        env.DB,
        {
          id: newId(TEST_NOW + 24),
          eventId: themeId,
          actorUserId: user,
          action: "entitlement_rule.deleted",
          entityType: "entitlement_rule",
          entityId: ruleId,
          before: { status: "allowed" },
          createdAt: now,
        },
        ruleId,
      ),
    ]);

    expect(deleted[0]?.meta.changes).toBe(1);
    expect(await auditCount(ruleId)).toBe(2);
  });
});
