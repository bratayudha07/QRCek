import type {
  ActivityDetailPayload,
  ActivitySessionDetailPayload,
  ActivitySessionListPayload,
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
  adminB: { id: string; cookie: string };
  activityA: string;
  activityB: string;
}

async function world(): Promise<World> {
  const superadminId = await createUser({ role: "superadmin" });
  const eventA = await createEvent({ createdBy: superadminId, name: "Acara A" });
  const eventB = await createEvent({ createdBy: superadminId, name: "Acara B" });

  const adminAId = await createUser({ role: "event_admin" });
  await addMembership(eventA, adminAId, "event_admin");
  const adminBId = await createUser({ role: "event_admin" });
  await addMembership(eventB, adminBId, "event_admin");

  const adminA = { id: adminAId, cookie: (await createSession(adminAId)).cookie };
  const adminB = { id: adminBId, cookie: (await createSession(adminBId)).cookie };

  const activityA = await createActivity(adminA.cookie, eventA, "Kehadiran A");
  const activityB = await createActivity(adminB.cookie, eventB, "Kehadiran B");

  return {
    superadmin: { id: superadminId, cookie: (await createSession(superadminId)).cookie },
    eventA,
    eventB,
    adminA,
    adminB,
    activityA,
    activityB,
  };
}

async function createActivity(
  cookie: string,
  eventId: string,
  name: string,
): Promise<string> {
  const response = await callApi(`/api/events/${eventId}/activities`, {
    cookie,
    body: { name, transactionType: "attendance" },
  });
  if (response.status !== 201) {
    throw new Error(`createActivity failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  const body = response.json<ActivityDetailPayload>();
  if (!body.ok) throw new Error("expected success");
  return body.data.activity.id;
}

async function createSessionRow(
  cookie: string,
  eventId: string,
  activityId: string,
  body: Partial<{
    name: string;
    location: string;
    startsAt: number;
    endsAt: number;
  }> = {},
): Promise<string> {
  const response = await callApi(
    `/api/events/${eventId}/activities/${activityId}/sessions`,
    { cookie, body: { name: body.name ?? "Sesi", ...body } },
  );
  if (response.status !== 201) {
    throw new Error(`createSession failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  const payload = response.json<ActivitySessionDetailPayload>();
  if (!payload.ok) throw new Error("expected success");
  return payload.data.session.id;
}

async function auditActions(eventId: string): Promise<string[]> {
  const { results } = await testEnv.DB.prepare(
    "SELECT action FROM audit_log WHERE event_id = ? ORDER BY created_at, id",
  )
    .bind(eventId)
    .all<{ action: string }>();
  return results.map((row) => row.action);
}

describe("POST /api/events/:eventId/activities/:activityId/sessions", () => {
  it("creates a scheduled session and writes audit", async () => {
    const w = await world();

    const response = await callApi(
      `/api/events/${w.eventA}/activities/${w.activityA}/sessions`,
      {
        cookie: w.adminA.cookie,
        body: { name: "Pagi", location: "Gerbang", startsAt: 1000, endsAt: 2000 },
      },
    );

    expect(response.status).toBe(201);
    const body = response.json<ActivitySessionDetailPayload>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data.session).toMatchObject({
      activityId: w.activityA,
      name: "Pagi",
      location: "Gerbang",
      startsAt: 1000,
      endsAt: 2000,
      status: "scheduled",
      archivedAt: null,
    });

    expect(await auditActions(w.eventA)).toContain("session.created");
  });

  it("rejects endsAt before startsAt", async () => {
    const w = await world();

    const response = await callApi(
      `/api/events/${w.eventA}/activities/${w.activityA}/sessions`,
      {
        cookie: w.adminA.cookie,
        body: { name: "Pagi", startsAt: 2000, endsAt: 1000 },
      },
    );

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe("VALIDATION_ERROR");
  });

  it("cannot create a session under an activity from another Tema (T-001)", async () => {
    const w = await world();

    const response = await callApi(
      `/api/events/${w.eventB}/activities/${w.activityA}/sessions`,
      {
        cookie: w.adminB.cookie,
        body: { name: "Pagi" },
      },
    );

    expect(response.status).toBe(404);
    expect(errorCode(response)).toBe("NOT_FOUND");
  });
});

describe("GET session", () => {
  it("lists sessions ordered by starts_at, nulls last", async () => {
    const w = await world();
    await createSessionRow(w.adminA.cookie, w.eventA, w.activityA, {
      name: "Tanpa Jam",
    });
    await createSessionRow(w.adminA.cookie, w.eventA, w.activityA, {
      name: "Siang",
      startsAt: 2000,
    });
    await createSessionRow(w.adminA.cookie, w.eventA, w.activityA, {
      name: "Pagi",
      startsAt: 1000,
    });

    const response = await callApi(
      `/api/events/${w.eventA}/activities/${w.activityA}/sessions`,
      { cookie: w.adminA.cookie },
    );

    expect(response.status).toBe(200);
    const body = response.json<ActivitySessionListPayload>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data.sessions.map((session) => session.name)).toEqual([
      "Pagi",
      "Siang",
      "Tanpa Jam",
    ]);
  });

  it("rejects a session id from another activity with 404", async () => {
    const w = await world();
    const sessionId = await createSessionRow(w.adminA.cookie, w.eventA, w.activityA);

    const response = await callApi(
      `/api/events/${w.eventA}/activities/${w.activityB}/sessions/${sessionId}`,
      { cookie: w.adminA.cookie },
    );

    expect(response.status).toBe(404);
    expect(errorCode(response)).toBe("NOT_FOUND");
  });
});

describe("session lifecycle", () => {
  it("follows scheduled → in_progress → completed and writes audit", async () => {
    const w = await world();
    const sessionId = await createSessionRow(w.adminA.cookie, w.eventA, w.activityA);

    for (const status of ["in_progress", "completed"]) {
      const response = await callApi(
        `/api/events/${w.eventA}/activities/${w.activityA}/sessions/${sessionId}/status`,
        { cookie: w.adminA.cookie, body: { status } },
      );
      expect(response.status).toBe(200);
    }

    const invalid = await callApi(
      `/api/events/${w.eventA}/activities/${w.activityA}/sessions/${sessionId}/status`,
      { cookie: w.adminA.cookie, body: { status: "scheduled" } },
    );
    expect(invalid.status).toBe(422);
    expect(errorCode(invalid)).toBe("BUSINESS_RULE");

    expect((await auditActions(w.eventA)).filter((a) => a === "session.status_changed"))
      .toHaveLength(2);
  });

  it("rejects scheduled → completed directly", async () => {
    const w = await world();
    const sessionId = await createSessionRow(w.adminA.cookie, w.eventA, w.activityA);

    const response = await callApi(
      `/api/events/${w.eventA}/activities/${w.activityA}/sessions/${sessionId}/status`,
      { cookie: w.adminA.cookie, body: { status: "completed" } },
    );

    expect(response.status).toBe(422);
  });

  it("archives only a finished or disabled session", async () => {
    const w = await world();
    const sessionId = await createSessionRow(w.adminA.cookie, w.eventA, w.activityA);

    const tooEarly = await callApi(
      `/api/events/${w.eventA}/activities/${w.activityA}/sessions/${sessionId}/archive`,
      { method: "POST", cookie: w.adminA.cookie },
    );
    expect(tooEarly.status).toBe(422);

    for (const status of ["in_progress", "completed"]) {
      await callApi(
        `/api/events/${w.eventA}/activities/${w.activityA}/sessions/${sessionId}/status`,
        { cookie: w.adminA.cookie, body: { status } },
      );
    }

    const archived = await callApi(
      `/api/events/${w.eventA}/activities/${w.activityA}/sessions/${sessionId}/archive`,
      { method: "POST", cookie: w.adminA.cookie },
    );
    expect(archived.status).toBe(200);

    const body = archived.json<ActivitySessionDetailPayload>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data.session.status).toBe("completed");
    expect(body.data.session.archivedAt).not.toBeNull();

    // Archived is final: no patch, no status change, no second archive.
    const patch = await callApi(
      `/api/events/${w.eventA}/activities/${w.activityA}/sessions/${sessionId}`,
      { method: "PATCH", cookie: w.adminA.cookie, body: { name: "Baru" } },
    );
    expect(patch.status).toBe(422);

    const status = await callApi(
      `/api/events/${w.eventA}/activities/${w.activityA}/sessions/${sessionId}/status`,
      { cookie: w.adminA.cookie, body: { status: "in_progress" } },
    );
    expect(status.status).toBe(422);

    const again = await callApi(
      `/api/events/${w.eventA}/activities/${w.activityA}/sessions/${sessionId}/archive`,
      { method: "POST", cookie: w.adminA.cookie },
    );
    expect(again.status).toBe(422);

    expect(await auditActions(w.eventA)).toContain("session.archived");
  });

  it("does not delete history when a session is archived (T-007 partial)", async () => {
    const w = await world();
    const sessionId = await createSessionRow(w.adminA.cookie, w.eventA, w.activityA);
    await callApi(
      `/api/events/${w.eventA}/activities/${w.activityA}/sessions/${sessionId}/status`,
      { cookie: w.adminA.cookie, body: { status: "in_progress" } },
    );
    await callApi(
      `/api/events/${w.eventA}/activities/${w.activityA}/sessions/${sessionId}/status`,
      { cookie: w.adminA.cookie, body: { status: "disabled" } },
    );
    await callApi(
      `/api/events/${w.eventA}/activities/${w.activityA}/sessions/${sessionId}/archive`,
      { method: "POST", cookie: w.adminA.cookie },
    );

    const row = await testEnv.DB.prepare(
      "SELECT id, status, archived_at FROM activity_sessions WHERE id = ?",
    )
      .bind(sessionId)
      .first<{ id: string; status: string; archived_at: number | null }>();

    expect(row).toEqual({
      id: sessionId,
      status: "disabled",
      archived_at: expect.any(Number),
    });

    const auditBefore = (await auditActions(w.eventA)).length;
    expect(auditBefore).toBeGreaterThan(0);
    expect(await auditActions(w.eventA)).toContain("session.archived");
  });
});

describe("session duplication", () => {
  it("copies configuration only, with a new id and scheduled status", async () => {
    const w = await world();
    const sessionId = await createSessionRow(w.adminA.cookie, w.eventA, w.activityA, {
      name: "Gelombang 1",
      location: "Aula",
      startsAt: 1000,
      endsAt: 2000,
    });

    for (const status of ["in_progress", "completed"]) {
      await callApi(
        `/api/events/${w.eventA}/activities/${w.activityA}/sessions/${sessionId}/status`,
        { cookie: w.adminA.cookie, body: { status } },
      );
    }

    const response = await callApi(
      `/api/events/${w.eventA}/activities/${w.activityA}/sessions/${sessionId}/duplicate`,
      { method: "POST", cookie: w.adminA.cookie },
    );

    expect(response.status).toBe(201);
    const body = response.json<ActivitySessionDetailPayload>();
    if (!body.ok) throw new Error("expected success");

    const copy = body.data.session;
    expect(copy.id).not.toBe(sessionId);
    expect(copy).toMatchObject({
      activityId: w.activityA,
      name: "Gelombang 1",
      location: "Aula",
      startsAt: 1000,
      endsAt: 2000,
      status: "scheduled",
      archivedAt: null,
    });

    expect(await auditActions(w.eventA)).toContain("session.duplicated");
  });

  it("rejects a duplicate request for a session from another activity", async () => {
    const w = await world();
    const sessionId = await createSessionRow(w.adminA.cookie, w.eventA, w.activityA);

    const response = await callApi(
      `/api/events/${w.eventA}/activities/${w.activityB}/sessions/${sessionId}/duplicate`,
      { method: "POST", cookie: w.adminA.cookie },
    );

    expect(response.status).toBe(404);
  });
});

describe("session update", () => {
  it("rejects a combined time range that ends before it starts", async () => {
    const w = await world();
    const sessionId = await createSessionRow(w.adminA.cookie, w.eventA, w.activityA, {
      startsAt: 1000,
      endsAt: 2000,
    });

    const response = await callApi(
      `/api/events/${w.eventA}/activities/${w.activityA}/sessions/${sessionId}`,
      { method: "PATCH", cookie: w.adminA.cookie, body: { endsAt: 500 } },
    );

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe("VALIDATION_ERROR");
  });
});
