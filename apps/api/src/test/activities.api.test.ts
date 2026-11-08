import type {
  ActivityDetailPayload,
  ActivityListPayload,
} from "@absensi/shared";
import { describe, expect, it } from "vitest";

import {
  addMembership,
  createEvent,
  createSession,
  createUser,
} from "./fixtures";
import { testEnv } from "./env";
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

async function createActivity(
  cookie: string,
  eventId: string,
  body: Partial<{ name: string; transactionType: string; sortOrder: number }> = {},
): Promise<string> {
  const response = await callApi(`/api/events/${eventId}/activities`, {
    cookie,
    body: {
      name: body.name ?? "Kehadiran",
      transactionType: body.transactionType ?? "attendance",
      sortOrder: body.sortOrder ?? 0,
    },
  });

  if (response.status !== 201) {
    throw new Error(`createActivity failed: ${response.status} ${JSON.stringify(response.body)}`);
  }

  const payload = response.json<ActivityDetailPayload>();
  if (!payload.ok) throw new Error("expected success");
  return payload.data.activity.id;
}

async function auditActions(eventId: string): Promise<string[]> {
  const { results } = await testEnv.DB.prepare(
    "SELECT action FROM audit_log WHERE event_id = ? ORDER BY created_at, id",
  )
    .bind(eventId)
    .all<{ action: string }>();
  return results.map((row) => row.action);
}

describe("POST /api/events/:eventId/activities", () => {
  it("creates a draft activity scoped to the Tema and writes audit", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/activities`, {
      cookie: w.adminA.cookie,
      body: {
        name: "Kehadiran",
        description: "Presensi harian",
        transactionType: "attendance",
        location: "Aula",
        sortOrder: 3,
      },
    });

    expect(response.status).toBe(201);

    const body = response.json<ActivityDetailPayload>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data.activity).toMatchObject({
      themeId: w.eventA,
      name: "Kehadiran",
      transactionType: "attendance",
      status: "draft",
      location: "Aula",
      sortOrder: 3,
      archivedAt: null,
    });

    expect(await auditActions(w.eventA)).toContain("activity.created");
  });

  it("rejects an unknown transaction type at the boundary", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/activities`, {
      cookie: w.adminA.cookie,
      body: { name: "Aneh", transactionType: "unknown" },
    });

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe("VALIDATION_ERROR");
  });

  it("forbids an officer from creating an activity", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/activities`, {
      cookie: w.officerA.cookie,
      body: { name: "Kehadiran", transactionType: "attendance" },
    });

    expect(response.status).toBe(403);
    expect(errorCode(response)).toBe("FORBIDDEN");
  });

  it("hides another admin's Tema behind 404", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/activities`, {
      cookie: w.adminB.cookie,
      body: { name: "Kehadiran", transactionType: "attendance" },
    });

    expect(response.status).toBe(404);
    expect(errorCode(response)).toBe("NOT_FOUND");
  });

  it("refuses to add an activity to an archived Tema", async () => {
    const w = await world();

    for (const status of ["active", "closed", "archived"]) {
      const response = await callApi(`/api/events/${w.eventA}/status`, {
        cookie: w.superadmin.cookie,
        body: { status },
      });
      expect(response.status).toBe(200);
    }

    const response = await callApi(`/api/events/${w.eventA}/activities`, {
      cookie: w.superadmin.cookie,
      body: { name: "Kehadiran", transactionType: "attendance" },
    });

    expect(response.status).toBe(422);
    expect(errorCode(response)).toBe("BUSINESS_RULE");
  });
});

describe("GET /api/events/:eventId/activities", () => {
  it("lists activities ordered by sort_order", async () => {
    const w = await world();
    await createActivity(w.adminA.cookie, w.eventA, { name: "Kedua", sortOrder: 2 });
    await createActivity(w.adminA.cookie, w.eventA, { name: "Pertama", sortOrder: 1 });

    const response = await callApi(`/api/events/${w.eventA}/activities`, {
      cookie: w.adminA.cookie,
    });

    expect(response.status).toBe(200);
    const body = response.json<ActivityListPayload>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data.activities.map((activity) => activity.name)).toEqual([
      "Pertama",
      "Kedua",
    ]);
  });

  it("rejects an activity id from another Tema with 404", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);

    const response = await callApi(
      `/api/events/${w.eventB}/activities/${activityId}`,
      { cookie: w.adminB.cookie },
    );

    expect(response.status).toBe(404);
    expect(errorCode(response)).toBe("NOT_FOUND");
  });
});

describe("PATCH /api/events/:eventId/activities/:activityId", () => {
  it("updates allowlisted fields and writes audit", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);

    const response = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}`,
      {
        method: "PATCH",
        cookie: w.adminA.cookie,
        body: { name: "Kehadiran Pagi", location: "Aula", sortOrder: 7 },
      },
    );

    expect(response.status).toBe(200);
    const body = response.json<ActivityDetailPayload>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data.activity).toMatchObject({
      name: "Kehadiran Pagi",
      location: "Aula",
      sortOrder: 7,
      transactionType: "attendance",
    });

    expect(await auditActions(w.eventA)).toContain("activity.updated");
  });

  it("refuses to change transactionType", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);

    const response = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}`,
      {
        method: "PATCH",
        cookie: w.adminA.cookie,
        body: { transactionType: "consumption" },
      },
    );

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe("VALIDATION_ERROR");
  });

  it("makes an archived activity read-only", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);

    for (const status of ["active", "completed", "archived"]) {
      const response = await callApi(
        `/api/events/${w.eventA}/activities/${activityId}/status`,
        { cookie: w.adminA.cookie, body: { status } },
      );
      expect(response.status).toBe(200);
    }

    const response = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}`,
      { method: "PATCH", cookie: w.adminA.cookie, body: { name: "Baru" } },
    );

    expect(response.status).toBe(422);
    expect(errorCode(response)).toBe("BUSINESS_RULE");
  });
});

describe("POST /api/events/:eventId/activities/:activityId/status", () => {
  it("allows draft → archived directly (ADR-0012)", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);

    const response = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/status`,
      { cookie: w.adminA.cookie, body: { status: "archived" } },
    );

    expect(response.status).toBe(200);
    const body = response.json<ActivityDetailPayload>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data.activity.status).toBe("archived");
    expect(body.data.activity.archivedAt).not.toBeNull();
  });

  it("rejects active → archived and reopens nothing", async () => {
    const w = await world();
    const activityId = await createActivity(w.adminA.cookie, w.eventA);

    const activated = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/status`,
      { cookie: w.adminA.cookie, body: { status: "active" } },
    );
    expect(activated.status).toBe(200);

    const skipped = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/status`,
      { cookie: w.adminA.cookie, body: { status: "archived" } },
    );
    expect(skipped.status).toBe(422);
    expect(errorCode(skipped)).toBe("BUSINESS_RULE");

    for (const status of ["completed", "archived"]) {
      const response = await callApi(
        `/api/events/${w.eventA}/activities/${activityId}/status`,
        { cookie: w.adminA.cookie, body: { status } },
      );
      expect(response.status).toBe(200);

      const body = response.json<ActivityDetailPayload>();
      if (!body.ok) throw new Error("expected success");
      expect(body.data.activity.status).toBe(status);
    }

    const reopened = await callApi(
      `/api/events/${w.eventA}/activities/${activityId}/status`,
      { cookie: w.adminA.cookie, body: { status: "active" } },
    );
    expect(reopened.status).toBe(422);

    expect((await auditActions(w.eventA)).filter((a) => a === "activity.status_changed"))
      .toHaveLength(3);
  });
});

describe("DELETE /api/events/:eventId", () => {
  it("does not hard-delete a draft Tema that still has activities", async () => {
    const w = await world();
    await createActivity(w.adminA.cookie, w.eventA);

    const response = await callApi(`/api/events/${w.eventA}`, {
      method: "DELETE",
      cookie: w.superadmin.cookie,
    });

    expect(response.status).toBe(422);
    expect(errorCode(response)).toBe("BUSINESS_RULE");

    const row = await testEnv.DB.prepare("SELECT id FROM events WHERE id = ?")
      .bind(w.eventA)
      .first<{ id: string }>();
    expect(row?.id).toBe(w.eventA);
  });
});
