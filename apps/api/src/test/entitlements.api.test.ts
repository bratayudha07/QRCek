import type {
  ActivityDetailPayload,
  ActivitySessionDetailPayload,
  CategoryDetailPayload,
  EntitlementCategoryRulesPayload,
  EntitlementDefaultPayload,
  EntitlementMatrixPayload,
  EntitlementParticipantRulePayload,
  EntitlementResolvePayload,
} from "@absensi/shared";
import { describe, expect, it } from "vitest";

import { testEnv } from "./env";
import {
  addMembership,
  createEvent,
  createParticipant,
  createSession,
  createUser,
} from "./fixtures";
import { callApi, errorCode } from "./http";

/**
 * Q3 API, authorization, audit, and `draft → active` gate tests
 * (RENCANA_PENGUJIAN.md §9.3, §9.4).
 *
 * The world helper builds two Temas so every cross-Tema case is a 404, and both
 * an admin and an officer in Tema A so write denial is exercised end to end.
 */

interface World {
  superadmin: { id: string; cookie: string };
  eventA: string;
  eventB: string;
  adminA: { id: string; cookie: string };
  officerA: { id: string; cookie: string };
  adminB: { id: string; cookie: string };
}

async function world(): Promise<World> {
  const superadminId = await createUser({ role: "superadmin" });
  const eventA = await createEvent({ createdBy: superadminId, name: "Acara A" });
  const eventB = await createEvent({ createdBy: superadminId, name: "Acara B" });

  const adminAId = await createUser({ role: "event_admin" });
  await addMembership(eventA, adminAId, "event_admin");
  const officerAId = await createUser({ role: "officer" });
  await addMembership(eventA, officerAId, "officer");
  const adminBId = await createUser({ role: "event_admin" });
  await addMembership(eventB, adminBId, "event_admin");

  return {
    superadmin: { id: superadminId, cookie: (await createSession(superadminId)).cookie },
    eventA,
    eventB,
    adminA: { id: adminAId, cookie: (await createSession(adminAId)).cookie },
    officerA: { id: officerAId, cookie: (await createSession(officerAId)).cookie },
    adminB: { id: adminBId, cookie: (await createSession(adminBId)).cookie },
  };
}

async function createActivity(
  cookie: string,
  eventId: string,
  name = "Aktivitas Uji",
): Promise<string> {
  const response = await callApi(`/api/events/${eventId}/activities`, {
    cookie,
    body: { name, transactionType: "attendance" },
  });
  if (response.status !== 201) {
    throw new Error(`createActivity failed: ${response.status} ${response.text}`);
  }
  const payload = response.json<ActivityDetailPayload>();
  if (!payload.ok) throw new Error("expected success");
  return payload.data.activity.id;
}

async function createCategoryViaApi(
  cookie: string,
  eventId: string,
  name: string,
): Promise<string> {
  const response = await callApi(`/api/events/${eventId}/categories`, {
    cookie,
    body: { name },
  });
  if (response.status !== 201) {
    throw new Error(`createCategory failed: ${response.status} ${response.text}`);
  }
  const payload = response.json<CategoryDetailPayload>();
  if (!payload.ok) throw new Error("expected success");
  return payload.data.category.id;
}

async function createSessionViaApi(
  cookie: string,
  eventId: string,
  activityId: string,
  name = "Sesi Uji",
): Promise<string> {
  const response = await callApi(
    `/api/events/${eventId}/activities/${activityId}/sessions`,
    { cookie, body: { name } },
  );
  if (response.status !== 201) {
    throw new Error(`createSession failed: ${response.status} ${response.text}`);
  }
  const payload = response.json<ActivitySessionDetailPayload>();
  if (!payload.ok) throw new Error("expected success");
  return payload.data.session.id;
}

async function putCategoryRules(
  cookie: string,
  eventId: string,
  activityId: string,
  rules: Array<{ categoryId: string; status: string }>,
  sessionId?: string,
) {
  const suffix =
    sessionId === undefined
      ? "entitlements/categories"
      : `sessions/${sessionId}/entitlements/categories`;
  return callApi(
    `/api/events/${eventId}/activities/${activityId}/${suffix}`,
    { cookie, method: "PUT", body: { rules } },
  );
}

async function auditActions(eventId: string): Promise<string[]> {
  const { results } = await testEnv.DB.prepare(
    "SELECT action FROM audit_log WHERE event_id = ? ORDER BY created_at, id",
  )
    .bind(eventId)
    .all<{ action: string }>();
  return results.map((row) => row.action);
}

async function entitlementAuditCount(eventId: string): Promise<number> {
  const row = await testEnv.DB.prepare(
    "SELECT COUNT(*) AS n FROM audit_log WHERE event_id = ? AND entity_type = 'entitlement_rule'",
  )
    .bind(eventId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function archiveEvent(cookie: string, eventId: string): Promise<void> {
  for (const status of ["active", "closed", "archived"] as const) {
    const response = await callApi(`/api/events/${eventId}/status`, {
      cookie,
      body: { status },
    });
    if (response.status !== 200) {
      throw new Error(`archiveEvent failed: ${response.status} ${response.text}`);
    }
  }
}

describe("entitlement authorization", () => {
  it("lets an officer read but never write", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);
    const categoryId = await createCategoryViaApi(w.adminA.cookie, w.eventA, "Kelas A");

    expect(
      (
        await callApi(`/api/events/${w.eventA}/entitlements/default`, {
          cookie: w.officerA.cookie,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await callApi(`/api/events/${w.eventA}/activities/${activityId}/entitlements`, {
          cookie: w.officerA.cookie,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await callApi(
          `/api/events/${w.eventA}/activities/${activityId}/entitlements/resolve?participantId=p`,
          { cookie: w.officerA.cookie },
        )
      ).status,
    ).toBe(404); // participant is checked; read permission itself passed

    for (const response of [
      await callApi(`/api/events/${w.eventA}/entitlements/default`, {
        cookie: w.officerA.cookie,
        method: "PUT",
        body: { status: "allowed" },
      }),
      await callApi(`/api/events/${w.eventA}/entitlements/default`, {
        cookie: w.officerA.cookie,
        method: "DELETE",
      }),
      await putCategoryRules(w.officerA.cookie, w.eventA, activityId, [
        { categoryId, status: "allowed" },
      ]),
    ]) {
      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe("FORBIDDEN");
    }

    expect(await entitlementAuditCount(w.eventA)).toBe(0);
  });

  it("treats another Tema as not found for admin and superadmin rules", async () => {
    const w = await world();
    const activityB = await createActivity(w.adminB.cookie, w.eventB);

    for (const response of [
      await callApi(`/api/events/${w.eventB}/entitlements/default`, {
        cookie: w.adminA.cookie,
        method: "PUT",
        body: { status: "denied" },
      }),
      await callApi(`/api/events/${w.eventA}/activities/${activityB}/entitlements`, {
        cookie: w.adminA.cookie,
      }),
    ]) {
      expect(response.status).toBe(404);
    }
  });

  it("lets superadmin configure a Tema they do not belong to", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/entitlements/default`, {
      cookie: w.superadmin.cookie,
      method: "PUT",
      body: { status: "denied" },
    });

    expect(response.status).toBe(200);
  });

  it("refuses every mutation when the Tema is archived", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);
    const categoryId = await createCategoryViaApi(w.adminA.cookie, w.eventA, "Kelas A");
    await archiveEvent(w.adminA.cookie, w.eventA);

    for (const response of [
      await callApi(`/api/events/${w.eventA}/entitlements/default`, {
        cookie: w.adminA.cookie,
        method: "PUT",
        body: { status: "allowed" },
      }),
      await putCategoryRules(w.adminA.cookie, w.eventA, activityId, [
        { categoryId, status: "allowed" },
      ]),
    ]) {
      expect(response.status).toBe(422);
      expect(errorCode(response)).toBe("BUSINESS_RULE");
    }
  });
});

describe("Theme default entitlement", () => {
  it("creates, updates, and deletes the default with audit in the same batch", async () => {
    const w = await world();
    const base = `/api/events/${w.eventA}/entitlements/default`;

    const initial = await callApi(base, { cookie: w.adminA.cookie });
    expect(initial.status).toBe(200);
    const initialPayload = initial.json<EntitlementDefaultPayload>();
    if (!initialPayload.ok) throw new Error("expected success");
    expect(initialPayload.data).toEqual({ themeDefault: null });

    const created = await callApi(base, {
      cookie: w.adminA.cookie,
      method: "PUT",
      body: { status: "denied" },
    });
    expect(created.status).toBe(200);
    const createdPayload = created.json<EntitlementDefaultPayload>();
    if (!createdPayload.ok) throw new Error("expected success");
    expect(createdPayload.data).toEqual({
      themeDefault: { status: "denied" },
    });

    const updated = await callApi(base, {
      cookie: w.adminA.cookie,
      method: "PUT",
      body: { status: "allowed" },
    });
    expect(updated.status).toBe(200);

    const audit = await testEnv.DB.prepare(
      `SELECT action, after_json FROM audit_log
        WHERE event_id = ? AND entity_type = 'entitlement_rule'
        ORDER BY created_at, id`,
    )
      .bind(w.eventA)
      .all<{ action: string; after_json: string }>();
    expect(new Set(audit.results.map((row) => row.action))).toEqual(
      new Set(["entitlement_rule.created", "entitlement_rule.updated"]),
    );
    const updatedAudit = audit.results.find(
      (row) => row.action === "entitlement_rule.updated",
    );
    expect(Object.keys(JSON.parse(updatedAudit?.after_json ?? "{}"))).toEqual([
      "themeId",
      "activityId",
      "sessionId",
      "participantId",
      "categoryId",
      "status",
    ]);

    const deleted = await callApi(base, {
      cookie: w.adminA.cookie,
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    const deletedPayload = deleted.json<EntitlementDefaultPayload>();
    if (!deletedPayload.ok) throw new Error("expected success");
    expect(deletedPayload.data).toEqual({ themeDefault: null });

    const missing = await callApi(base, {
      cookie: w.adminA.cookie,
      method: "DELETE",
    });
    expect(missing.status).toBe(404);
  });

  it("rejects inherit on the Theme default with 422", async () => {
    const w = await world();
    const response = await callApi(`/api/events/${w.eventA}/entitlements/default`, {
      cookie: w.adminA.cookie,
      method: "PUT",
      body: { status: "inherit" },
    });

    expect(response.status).toBe(422);
    expect(errorCode(response)).toBe("BUSINESS_RULE");
    expect(await entitlementAuditCount(w.eventA)).toBe(0);
  });
});

describe("category rule batches", () => {
  it("upserts category–activity rules and reports completeness", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);
    const first = await createCategoryViaApi(w.adminA.cookie, w.eventA, "Kelas 1");
    const second = await createCategoryViaApi(w.adminA.cookie, w.eventA, "Kelas 2");

    const response = await putCategoryRules(w.adminA.cookie, w.eventA, activityId, [
      { categoryId: first, status: "allowed" },
      { categoryId: second, status: "inherit" },
    ]);

    expect(response.status).toBe(200);
    const payload = response.json<EntitlementCategoryRulesPayload>();
    if (!payload.ok) throw new Error("expected success");
    expect(payload.data.entitlementComplete).toBe(true);
    expect(payload.data.missingCategoryIds).toEqual([]);
    expect(payload.data.rules).toHaveLength(2);

    const matrix = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/entitlements`,
      { cookie: w.adminA.cookie },
    );
    const matrixPayload = matrix.json<EntitlementMatrixPayload>();
    if (!matrixPayload.ok) throw new Error("expected success");
    expect(
      matrixPayload.data.categories.map((cell) => [cell.categoryId, cell.status]),
    ).toEqual([
      [first, "allowed"],
      [second, "inherit"],
    ]);

    expect((await auditActions(w.eventA)).filter((action) => action.startsWith("entitlement_rule"))).toEqual([
      "entitlement_rule.created",
      "entitlement_rule.created",
    ]);
  });

  it("accepts 15 rows but rejects 16 without writing anything", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);
    const categories: string[] = [];
    for (let index = 0; index < 16; index += 1) {
      categories.push(
        await createCategoryViaApi(w.adminA.cookie, w.eventA, `Kelas ${index + 1}`),
      );
    }

    const fifteen = await putCategoryRules(
      w.adminA.cookie,
      w.eventA,
      activityId,
      categories.slice(0, 15).map((categoryId) => ({ categoryId, status: "allowed" })),
    );
    expect(fifteen.status).toBe(200);

    const before = await entitlementAuditCount(w.eventA);

    const sixteen = await putCategoryRules(
      w.adminA.cookie,
      w.eventA,
      activityId,
      categories.map((categoryId) => ({ categoryId, status: "allowed" })),
    );
    expect(sixteen.status).toBe(422);
    expect(errorCode(sixteen)).toBe("BUSINESS_RULE");
    expect(await entitlementAuditCount(w.eventA)).toBe(before);
  });

  it("rejects duplicate categoryId, invalid status, and cross-Tema categories", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);
    const categoryId = await createCategoryViaApi(w.adminA.cookie, w.eventA, "Kelas A");
    const foreignCategory = await createCategoryViaApi(
      w.adminB.cookie,
      w.eventB,
      "Kelas B",
    );

    const duplicate = await putCategoryRules(w.adminA.cookie, w.eventA, activityId, [
      { categoryId, status: "allowed" },
      { categoryId, status: "denied" },
    ]);
    expect(duplicate.status).toBe(422);

    const invalidStatus = await putCategoryRules(w.adminA.cookie, w.eventA, activityId, [
      { categoryId, status: "maybe" },
    ]);
    expect(invalidStatus.status).toBe(422);

    const crossTheme = await putCategoryRules(w.adminA.cookie, w.eventA, activityId, [
      { categoryId: foreignCategory, status: "allowed" },
    ]);
    expect(crossTheme.status).toBe(404);

    expect(await entitlementAuditCount(w.eventA)).toBe(0);
  });

  it("refuses new writes for an archived category but keeps existing rows readable", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);
    const categoryId = await createCategoryViaApi(w.adminA.cookie, w.eventA, "Kelas A");

    await putCategoryRules(w.adminA.cookie, w.eventA, activityId, [
      { categoryId, status: "allowed" },
    ]);
    await callApi(`/api/events/${w.eventA}/categories/${categoryId}/status`, {
      cookie: w.adminA.cookie,
      body: { status: "archived" },
    });

    const write = await putCategoryRules(w.adminA.cookie, w.eventA, activityId, [
      { categoryId, status: "denied" },
    ]);
    expect(write.status).toBe(422);
    expect(errorCode(write)).toBe("BUSINESS_RULE");

    const matrix = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/entitlements`,
      { cookie: w.adminA.cookie },
    );
    const payload = matrix.json<EntitlementMatrixPayload>();
    if (!payload.ok) throw new Error("expected success");
    expect(payload.data.categories).toEqual([
      { categoryId, name: "Kelas A", status: "allowed" },
    ]);
  });
});

describe("individual overrides and session scope", () => {
  it("preserves an individual override when the participant's category changes", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);
    const firstCategory = await createCategoryViaApi(w.adminA.cookie, w.eventA, "Kelas 1");
    const secondCategory = await createCategoryViaApi(w.adminA.cookie, w.eventA, "Kelas 2");
    const participant = await createParticipant(w.eventA, {
      categoryId: firstCategory,
      fullName: "Siti",
    });

    await putCategoryRules(w.adminA.cookie, w.eventA, activityId, [
      { categoryId: firstCategory, status: "allowed" },
      { categoryId: secondCategory, status: "denied" },
    ]);

    const override = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/entitlements/participants/${participant.id}`,
      { cookie: w.adminA.cookie, method: "PUT", body: { status: "allowed" } },
    );
    expect(override.status).toBe(200);

    // Changing the category must not remove the individual row (FR-042).
    await callApi(`/api/events/${w.eventA}/participants/${participant.id}`, {
      cookie: w.adminA.cookie,
      method: "PATCH",
      body: { categoryId: secondCategory },
    });

    const preview = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/entitlements/resolve?participantId=${participant.id}`,
      { cookie: w.adminA.cookie },
    );
    const payload = preview.json<EntitlementResolvePayload>();
    if (!payload.ok) throw new Error("expected success");
    expect(payload.data).toEqual({
      allowed: true,
      status: "allowed",
      decidedBy: "individual_activity",
    });
  });

  it("applies a session override only to that session", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);
    const categoryId = await createCategoryViaApi(w.adminA.cookie, w.eventA, "Kelas 1");
    const participant = await createParticipant(w.eventA, {
      categoryId,
      fullName: "Siti",
    });
    const firstSession = await createSessionViaApi(
      w.adminA.cookie,
      w.eventA,
      activityId,
      "Sesi 1",
    );
    const secondSession = await createSessionViaApi(
      w.adminA.cookie,
      w.eventA,
      activityId,
      "Sesi 2",
    );

    await putCategoryRules(w.adminA.cookie, w.eventA, activityId, [
      { categoryId, status: "denied" },
    ]);

    const override = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/sessions/${firstSession}/entitlements/participants/${participant.id}`,
      { cookie: w.adminA.cookie, method: "PUT", body: { status: "allowed" } },
    );
    expect(override.status).toBe(200);

    const first = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/entitlements/resolve?participantId=${participant.id}&sessionId=${firstSession}`,
      { cookie: w.adminA.cookie },
    );
    const firstPayload = first.json<EntitlementResolvePayload>();
    if (!firstPayload.ok) throw new Error("expected success");
    expect(firstPayload.data).toEqual({
      allowed: true,
      status: "allowed",
      decidedBy: "individual_session",
    });

    const second = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/entitlements/resolve?participantId=${participant.id}&sessionId=${secondSession}`,
      { cookie: w.adminA.cookie },
    );
    const secondPayload = second.json<EntitlementResolvePayload>();
    if (!secondPayload.ok) throw new Error("expected success");
    expect(secondPayload.data).toEqual({
      allowed: false,
      status: "denied",
      decidedBy: "category_activity",
    });

    const matrix = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/entitlements`,
      { cookie: w.adminA.cookie },
    );
    const matrixPayload = matrix.json<EntitlementMatrixPayload>();
    if (!matrixPayload.ok) throw new Error("expected success");
    const bySession = new Map(
      matrixPayload.data.sessions.map((session) => [session.sessionId, session.participants]),
    );
    expect(bySession.get(firstSession)).toEqual([
      { participantId: participant.id, status: "allowed" },
    ]);
    expect(bySession.get(secondSession)).toEqual([]);
  });

  it("deletes an override explicitly and writes a delete audit", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);
    const categoryId = await createCategoryViaApi(w.adminA.cookie, w.eventA, "Kelas 1");
    const participant = await createParticipant(w.eventA, { categoryId });

    await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/entitlements/participants/${participant.id}`,
      { cookie: w.adminA.cookie, method: "PUT", body: { status: "denied" } },
    );

    const deleted = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/entitlements/participants/${participant.id}`,
      { cookie: w.adminA.cookie, method: "DELETE" },
    );
    expect(deleted.status).toBe(200);
    const payload = deleted.json<EntitlementParticipantRulePayload>();
    expect(payload.ok && payload.data.participantOverride).toBeNull();

    const actions = (await auditActions(w.eventA)).filter((action) =>
      action.startsWith("entitlement_rule"),
    );
    expect(actions.sort()).toEqual(
      ["entitlement_rule.created", "entitlement_rule.deleted"].sort(),
    );

    const missing = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/entitlements/participants/${participant.id}`,
      { cookie: w.adminA.cookie, method: "DELETE" },
    );
    expect(missing.status).toBe(404);
  });

  it("rejects a session from another activity as not found", async () => {
    const w = await world();
    const firstActivity = await createActivity(w.adminA.cookie, w.eventA, "Aktivitas 1");
    const secondActivity = await createActivity(w.adminA.cookie, w.eventA, "Aktivitas 2");
    const foreignSession = await createSessionViaApi(
      w.adminA.cookie,
      w.eventA,
      secondActivity,
    );
    const categoryId = await createCategoryViaApi(w.adminA.cookie, w.eventA, "Kelas 1");

    const response = await putCategoryRules(
      w.adminA.cookie,
      w.eventA,
      firstActivity,
      [{ categoryId, status: "allowed" }],
      foreignSession,
    );

    expect(response.status).toBe(404);
  });
});

describe("resolver preview", () => {
  it("matches the pure resolver for the five priority levels", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);
    const categoryId = await createCategoryViaApi(w.adminA.cookie, w.eventA, "Kelas 1");
    const participant = await createParticipant(w.eventA, { categoryId });
    const sessionId = await createSessionViaApi(w.adminA.cookie, w.eventA, activityId);

    const noRules = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/entitlements/resolve?participantId=${participant.id}&sessionId=${sessionId}`,
      { cookie: w.officerA.cookie },
    );
    const noRulesPayload = noRules.json<EntitlementResolvePayload>();
    if (!noRulesPayload.ok) throw new Error("expected success");
    expect(noRulesPayload.data).toEqual({
      allowed: false,
      status: "denied",
      decidedBy: null,
    });

    await callApi(`/api/events/${w.eventA}/entitlements/default`, {
      cookie: w.adminA.cookie,
      method: "PUT",
      body: { status: "allowed" },
    });
    const themeDefault = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/entitlements/resolve?participantId=${participant.id}&sessionId=${sessionId}`,
      { cookie: w.officerA.cookie },
    );
    const themePayload = themeDefault.json<EntitlementResolvePayload>();
    if (!themePayload.ok) throw new Error("expected success");
    expect(themePayload.data.decidedBy).toBe("theme_default");
    expect(themePayload.data.allowed).toBe(true);

    await putCategoryRules(w.adminA.cookie, w.eventA, activityId, [
      { categoryId, status: "denied" },
    ]);
    const category = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/entitlements/resolve?participantId=${participant.id}&sessionId=${sessionId}`,
      { cookie: w.officerA.cookie },
    );
    const categoryPayload = category.json<EntitlementResolvePayload>();
    if (!categoryPayload.ok) throw new Error("expected success");
    expect(categoryPayload.data.decidedBy).toBe("category_activity");
    expect(categoryPayload.data.allowed).toBe(false);
  });

  it("treats a participant from another Tema as not found", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);
    const categoryB = await createCategoryViaApi(w.adminB.cookie, w.eventB, "Kelas B");
    const participantB = await createParticipant(w.eventB, { categoryId: categoryB });

    const response = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/entitlements/resolve?participantId=${participantB.id}`,
      { cookie: w.adminA.cookie },
    );

    expect(response.status).toBe(404);
  });
});

describe("draft → active entitlement gate", () => {
  it("rejects activation until every active category has a rule, then allows it", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);
    const first = await createCategoryViaApi(w.adminA.cookie, w.eventA, "Kelas 1");
    const second = await createCategoryViaApi(w.adminA.cookie, w.eventA, "Kelas 2");

    const rejected = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/status`,
      { cookie: w.adminA.cookie, body: { status: "active" } },
    );

    expect(rejected.status).toBe(422);
    expect(errorCode(rejected)).toBe("BUSINESS_RULE");
    expect(rejected.body.ok ? "" : rejected.body.error.message).toContain("Kelas 1");
    expect(rejected.body.ok ? "" : rejected.body.error.message).toContain("Kelas 2");

    const stillDraft = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}`,
      { cookie: w.adminA.cookie },
    );
    const draftPayload = stillDraft.json<ActivityDetailPayload>();
    if (!draftPayload.ok) throw new Error("expected success");
    expect(draftPayload.data.activity.status).toBe("draft");

    await putCategoryRules(w.adminA.cookie, w.eventA, activityId, [
      { categoryId: first, status: "allowed" },
      { categoryId: second, status: "allowed" },
    ]);

    const activated = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/status`,
      { cookie: w.adminA.cookie, body: { status: "active" } },
    );
    expect(activated.status).toBe(200);
    const activatedPayload = activated.json<ActivityDetailPayload>();
    if (!activatedPayload.ok) throw new Error("expected success");
    expect(activatedPayload.data.activity.status).toBe("active");
  });

  it("keeps a new category fail-closed without deactivating the activity", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);
    const first = await createCategoryViaApi(w.adminA.cookie, w.eventA, "Kelas 1");
    const participant = await createParticipant(w.eventA, { categoryId: first });

    await putCategoryRules(w.adminA.cookie, w.eventA, activityId, [
      { categoryId: first, status: "allowed" },
    ]);
    await callApi(`/api/events/${w.eventA}/activities/${activityId}/status`, {
      cookie: w.adminA.cookie,
      body: { status: "active" },
    });

    const newCategory = await createCategoryViaApi(w.adminA.cookie, w.eventA, "Kelas 2");
    const newParticipant = await createParticipant(w.eventA, { categoryId: newCategory });

    const matrix = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/entitlements`,
      { cookie: w.adminA.cookie },
    );
    const matrixPayload = matrix.json<EntitlementMatrixPayload>();
    if (!matrixPayload.ok) throw new Error("expected success");
    expect(matrixPayload.data.entitlementComplete).toBe(false);
    expect(matrixPayload.data.missingCategoryIds).toEqual([newCategory]);

    const oldPreview = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/entitlements/resolve?participantId=${participant.id}`,
      { cookie: w.adminA.cookie },
    );
    const oldPayload = oldPreview.json<EntitlementResolvePayload>();
    if (!oldPayload.ok) throw new Error("expected success");
    expect(oldPayload.data).toEqual({
      allowed: true,
      status: "allowed",
      decidedBy: "category_activity",
    });

    const newPreview = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/entitlements/resolve?participantId=${newParticipant.id}`,
      { cookie: w.adminA.cookie },
    );
    const newPayload = newPreview.json<EntitlementResolvePayload>();
    if (!newPayload.ok) throw new Error("expected success");
    expect(newPayload.data).toEqual({
      allowed: false,
      status: "denied",
      decidedBy: null,
    });

    const activity = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}`,
      { cookie: w.adminA.cookie },
    );
    const activityPayload = activity.json<ActivityDetailPayload>();
    if (!activityPayload.ok) throw new Error("expected success");
    expect(activityPayload.data.activity.status).toBe("active");
  });
});

describe("entitlement audit allowlist", () => {
  it("stores only rule coordinates and status, never participant PII", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);
    const categoryId = await createCategoryViaApi(w.adminA.cookie, w.eventA, "Kelas 1");
    const participant = await createParticipant(w.eventA, {
      categoryId,
      fullName: "Nama Rahasia",
      phone: "08123456789",
      email: "rahasia@example.test",
    });

    await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/entitlements/participants/${participant.id}`,
      { cookie: w.adminA.cookie, method: "PUT", body: { status: "allowed" } },
    );

    const row = await testEnv.DB.prepare(
      `SELECT before_json, after_json FROM audit_log
        WHERE event_id = ? AND entity_type = 'entitlement_rule'
        ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
      .bind(w.eventA)
      .first<{ before_json: string | null; after_json: string | null }>();

    const serialised = `${row?.before_json ?? ""}${row?.after_json ?? ""}`;

    expect(serialised).not.toContain("Nama Rahasia");
    expect(serialised).not.toContain("08123456789");
    expect(serialised).not.toContain("rahasia@example.test");

    const after = JSON.parse(row?.after_json ?? "{}") as Record<string, unknown>;
    expect(Object.keys(after).sort()).toEqual([
      "activityId",
      "categoryId",
      "participantId",
      "sessionId",
      "status",
      "themeId",
    ]);
  });
});
