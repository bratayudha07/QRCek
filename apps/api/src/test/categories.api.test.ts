import type {
  CategoryDetailPayload,
  CategoryListPayload,
  ParticipantDetailPayload,
} from "@absensi/shared";
import { describe, expect, it } from "vitest";

import { testEnv } from "./env";
import {
  addMembership,
  createCategory,
  createEvent,
  createParticipant,
  createSession,
  createUser,
} from "./fixtures";
import { callApi, errorCode } from "./http";

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

async function createCategoryViaApi(
  eventId: string,
  cookie: string,
  body: Record<string, unknown> = {},
): Promise<CategoryDetailPayload["category"]> {
  const response = await callApi(`/api/events/${eventId}/categories`, {
    cookie,
    body: { name: "Kelas 7A", ...body },
  });

  if (response.status !== 201) {
    throw new Error(`create category failed: ${response.status} ${response.text}`);
  }

  const payload = response.json<CategoryDetailPayload>();
  if (!payload.ok) throw new Error("expected success");
  return payload.data.category;
}

async function auditActionsFor(entityId: string): Promise<string[]> {
  const { results } = await testEnv.DB.prepare(
    "SELECT action FROM audit_log WHERE entity_id = ? ORDER BY created_at, id",
  )
    .bind(entityId)
    .all<{ action: string }>();
  return results.map((row) => row.action);
}

describe("category management", () => {
  it("creates a category and writes audit in the same batch", async () => {
    const w = await world();

    const category = await createCategoryViaApi(w.eventA, w.adminA.cookie, {
      name: "Kelas 7A",
      description: "Rombel pagi",
      sortOrder: 3,
    });

    expect(category).toMatchObject({
      themeId: w.eventA,
      name: "Kelas 7A",
      description: "Rombel pagi",
      sortOrder: 3,
      status: "active",
      archivedAt: null,
    });
    expect(await auditActionsFor(category.id)).toEqual(["category.created"]);
  });

  it("rejects a duplicate name case-insensitively", async () => {
    const w = await world();
    await createCategoryViaApi(w.eventA, w.adminA.cookie, { name: "Kelas 7A" });

    const response = await callApi(`/api/events/${w.eventA}/categories`, {
      cookie: w.adminA.cookie,
      body: { name: "kelas 7a" },
    });

    expect(response.status).toBe(409);
    expect(errorCode(response)).toBe("CONFLICT");
  });

  it("allows the same category name in a different Tema", async () => {
    const w = await world();
    await createCategoryViaApi(w.eventA, w.adminA.cookie, { name: "Kelas 7A" });

    const response = await callApi(`/api/events/${w.eventB}/categories`, {
      cookie: w.adminB.cookie,
      body: { name: "Kelas 7A" },
    });

    expect(response.status).toBe(201);
  });

  it("treats a category from another Tema as not found", async () => {
    const w = await world();
    const category = await createCategoryViaApi(w.eventB, w.adminB.cookie);

    const read = await callApi(`/api/events/${w.eventA}/categories/${category.id}`, {
      cookie: w.adminA.cookie,
    });
    const patch = await callApi(`/api/events/${w.eventA}/categories/${category.id}`, {
      cookie: w.adminA.cookie,
      method: "PATCH",
      body: { name: "Bocor" },
    });
    const status = await callApi(`/api/events/${w.eventA}/categories/${category.id}/status`, {
      cookie: w.adminA.cookie,
      body: { status: "archived" },
    });

    expect(read.status).toBe(404);
    expect(patch.status).toBe(404);
    expect(status.status).toBe(404);
  });

  it("lets an officer read but not write", async () => {
    const w = await world();
    const category = await createCategoryViaApi(w.eventA, w.adminA.cookie);

    const list = await callApi(`/api/events/${w.eventA}/categories`, {
      cookie: w.officerA.cookie,
    });
    expect(list.status).toBe(200);

    const create = await callApi(`/api/events/${w.eventA}/categories`, {
      cookie: w.officerA.cookie,
      body: { name: "Kelas 8A" },
    });
    expect(create.status).toBe(403);

    const patch = await callApi(`/api/events/${w.eventA}/categories/${category.id}`, {
      cookie: w.officerA.cookie,
      method: "PATCH",
      body: { name: "Kelas 8A" },
    });
    expect(patch.status).toBe(403);
  });

  it("renames a category, updates the participant mirror, and keeps the id", async () => {
    const w = await world();
    const category = await createCategoryViaApi(w.eventA, w.adminA.cookie, { name: "Kelas 7A" });
    const participant = await createParticipant(w.eventA, {
      fullName: "Siti",
      categoryId: category.id,
    });

    const response = await callApi(`/api/events/${w.eventA}/categories/${category.id}`, {
      cookie: w.adminA.cookie,
      method: "PATCH",
      body: { name: "Kelas 7B" },
    });

    expect(response.status).toBe(200);

    const detail = await callApi(
      `/api/events/${w.eventA}/participants/${participant.id}`,
      { cookie: w.adminA.cookie },
    );
    const payload = detail.json<ParticipantDetailPayload>();
    if (!payload.ok) throw new Error("expected success");
    expect(payload.data.participant).toMatchObject({
      categoryId: category.id,
      category: "Kelas 7B",
    });
    expect((await auditActionsFor(category.id)).sort()).toEqual([
      "category.created",
      "category.updated",
    ]);
  });

  it("archives a category and refuses new assignments without touching history", async () => {
    const w = await world();
    const category = await createCategoryViaApi(w.eventA, w.adminA.cookie, { name: "Kelas 7A" });
    const existing = await createParticipant(w.eventA, {
      fullName: "Siti",
      categoryId: category.id,
    });

    const archived = await callApi(
      `/api/events/${w.eventA}/categories/${category.id}/status`,
      { cookie: w.adminA.cookie, body: { status: "archived" } },
    );
    expect(archived.status).toBe(200);

    const create = await callApi(`/api/events/${w.eventA}/participants`, {
      cookie: w.adminA.cookie,
      body: { fullName: "Budi", categoryId: category.id },
    });
    expect(create.status).toBe(422);
    expect(errorCode(create)).toBe("BUSINESS_RULE");

    const detail = await callApi(
      `/api/events/${w.eventA}/participants/${existing.id}`,
      { cookie: w.adminA.cookie },
    );
    const payload = detail.json<ParticipantDetailPayload>();
    if (!payload.ok) throw new Error("expected success");
    expect(payload.data.participant).toMatchObject({
      status: "active",
      categoryId: category.id,
    });
    expect((await auditActionsFor(category.id)).sort()).toEqual([
      "category.archived",
      "category.created",
    ]);
  });

  it("reports participantCount in the list", async () => {
    const w = await world();
    const first = await createCategoryViaApi(w.eventA, w.adminA.cookie, { name: "Kelas 7A" });
    const second = await createCategoryViaApi(w.eventA, w.adminA.cookie, { name: "Kelas 7B" });
    await createParticipant(w.eventA, { categoryId: first.id });
    await createParticipant(w.eventA, { categoryId: first.id });
    await createParticipant(w.eventA, { categoryId: second.id });

    const response = await callApi(`/api/events/${w.eventA}/categories`, {
      cookie: w.adminA.cookie,
    });
    const payload = response.json<CategoryListPayload>();
    if (!payload.ok) throw new Error("expected success");

    const counts = Object.fromEntries(
      payload.data.categories.map((category) => [category.name, category.participantCount]),
    );
    expect(counts).toEqual({ "Kelas 7A": 2, "Kelas 7B": 1 });
  });

  it("filter by status returns archived rows only when asked", async () => {
    const w = await world();
    const category = await createCategoryViaApi(w.eventA, w.adminA.cookie);
    await callApi(`/api/events/${w.eventA}/categories/${category.id}/status`, {
      cookie: w.adminA.cookie,
      body: { status: "archived" },
    });
    await createCategoryViaApi(w.eventA, w.adminA.cookie, { name: "Kelas 8A" });

    const activeList = await callApi(`/api/events/${w.eventA}/categories`, {
      cookie: w.adminA.cookie,
    });
    const archivedList = await callApi(
      `/api/events/${w.eventA}/categories?status=archived`,
      { cookie: w.adminA.cookie },
    );

    const active = activeList.json<CategoryListPayload>();
    const archived = archivedList.json<CategoryListPayload>();
    if (!active.ok || !archived.ok) throw new Error("expected success");

    expect(active.data.categories.map((row) => row.name)).toEqual(["Kelas 8A"]);
    expect(archived.data.categories.map((row) => row.name)).toEqual(["Kelas 7A"]);
  });

  it("refuses every mutation when the Tema is archived", async () => {
    const w = await world();
    const category = await createCategoryViaApi(w.eventA, w.adminA.cookie);

    for (const status of ["active", "closed", "archived"] as const) {
      await callApi(`/api/events/${w.eventA}/status`, {
        cookie: w.adminA.cookie,
        body: { status },
      });
    }

    const create = await callApi(`/api/events/${w.eventA}/categories`, {
      cookie: w.adminA.cookie,
      body: { name: "Kelas 8A" },
    });
    const patch = await callApi(`/api/events/${w.eventA}/categories/${category.id}`, {
      cookie: w.adminA.cookie,
      method: "PATCH",
      body: { name: "Kelas 8A" },
    });
    const archive = await callApi(
      `/api/events/${w.eventA}/categories/${category.id}/status`,
      { cookie: w.adminA.cookie, body: { status: "archived" } },
    );

    for (const response of [create, patch, archive]) {
      expect(response.status).toBe(422);
      expect(errorCode(response)).toBe("BUSINESS_RULE");
    }
  });
});

describe("category persistence", () => {
  it("rejects a second category with the same name at the database level", async () => {
    const w = await world();
    await createCategory(w.eventA, { name: "Kelas 7A" });

    await expect(createCategory(w.eventA, { name: "kelas 7a" })).rejects.toThrow(/UNIQUE/i);
  });
});
