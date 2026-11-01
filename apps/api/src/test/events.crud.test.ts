import type {
  EventDeletePayload,
  EventDetailPayload,
  EventListPayload,
  EventSummaryPayload,
} from "@absensi/shared";
import { describe, expect, it } from "vitest";

import {
  addMembership,
  createEvent,
  createParticipant,
  createSession,
  createUser,
} from "./fixtures";
import { TEST_NOW, callApi, errorCode } from "./http";

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

  const adminAId = await createUser({ role: "event_admin", displayName: "Admin A" });
  await addMembership(eventA, adminAId, "event_admin");

  const officerAId = await createUser({ role: "officer", displayName: "Petugas A" });
  await addMembership(eventA, officerAId, "officer");

  const adminBId = await createUser({ role: "event_admin", displayName: "Admin B" });
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

describe("POST /api/events", () => {
  it("lets a superadmin create a draft event", async () => {
    const w = await world();

    const response = await callApi("/api/events", {
      cookie: w.superadmin.cookie,
      body: {
        name: "Wisuda Santri 2026",
        description: "Wisuda akhir tahun",
        timezone: "Asia/Jakarta",
        startsAt: TEST_NOW + 86_400_000,
        endsAt: TEST_NOW + 90_000_000,
      },
    });

    expect(response.status).toBe(201);

    const body = response.json<EventDetailPayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data.event).toMatchObject({
      name: "Wisuda Santri 2026",
      status: "draft",
      accessRole: "superadmin",
      participantCount: 0,
      allowManual: false,
    });
    expect(body.data.event.slug).toMatch(/^wisuda-santri-2026-[a-z0-9]{6}$/);
  });

  it("lets an event_admin create an event it will own (ADR-007)", async () => {
    const w = await world();

    const response = await callApi("/api/events", {
      cookie: w.adminA.cookie,
      body: { name: "Acara Baru" },
    });

    expect(response.status).toBe(201);

    const body = response.json<EventDetailPayload>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data.event.accessRole).toBe("event_admin");

    // The creator owns the new event immediately: one batch, no gap.
    const me = await callApi("/api/events", { cookie: w.adminA.cookie });
    const list = me.json<EventListPayload>();
    if (!list.ok) throw new Error("expected success");
    expect(list.data.events.map((event) => event.id)).toContain(body.data.event.id);

    // ...and it stays invisible to another admin.
    const other = await callApi(`/api/events/${body.data.event.id}`, { cookie: w.adminB.cookie });
    expect(other.status).toBe(404);
  });

  it("still rejects an officer as event creator", async () => {
    const w = await world();

    const response = await callApi("/api/events", {
      cookie: w.officerA.cookie,
      body: { name: "Acara Petugas" },
    });

    expect(response.status).toBe(403);
    expect(errorCode(response)).toBe("FORBIDDEN");
  });

  it("rejects an invalid time window", async () => {
    const w = await world();

    const response = await callApi("/api/events", {
      cookie: w.superadmin.cookie,
      body: {
        name: "Acara Salah",
        startsAt: TEST_NOW + 10_000,
        endsAt: TEST_NOW + 5_000,
      },
    });

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/events", () => {
  it("serves the calendar alias for browsers with content blockers", async () => {
    const w = await world();

    const response = await callApi("/api/calendar", { cookie: w.adminA.cookie });
    const body = response.json<EventListPayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data.events.map((event) => event.id)).toEqual([w.eventA]);
  });

  it("shows a superadmin every event", async () => {
    const w = await world();

    const response = await callApi("/api/events", { cookie: w.superadmin.cookie });
    const body = response.json<EventListPayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data.events.map((event) => event.id).sort()).toEqual([w.eventA, w.eventB].sort());
    expect(body.data.events.every((event) => event.accessRole === "superadmin")).toBe(true);
  });

  it("shows a member only their own events", async () => {
    const w = await world();

    const response = await callApi("/api/events", { cookie: w.adminA.cookie });
    const body = response.json<EventListPayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data.events.map((event) => event.id)).toEqual([w.eventA]);
    expect(body.data.events[0]?.accessRole).toBe("event_admin");
  });
});

describe("GET /api/events/:id", () => {
  it("lets an officer read their event", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}`, { cookie: w.officerA.cookie });
    const body = response.json<EventDetailPayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data.event.id).toBe(w.eventA);
    expect(body.data.event.accessRole).toBe("officer");
  });

  it("returns 404 for a non-member of another event", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}`, { cookie: w.adminB.cookie });

    expect(response.status).toBe(404);
    expect(errorCode(response)).toBe("NOT_FOUND");
  });
});

describe("PATCH /api/events/:id", () => {
  it("lets an event admin update event details", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}`, {
      cookie: w.adminA.cookie,
      method: "PATCH",
      body: { name: "Acara A (Revisi)", allowManual: true, description: null },
    });

    expect(response.status).toBe(200);
    const body = response.json<EventDetailPayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data.event).toMatchObject({
      name: "Acara A (Revisi)",
      allowManual: true,
      description: null,
    });
  });

  it("returns 403 for an officer", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}`, {
      cookie: w.officerA.cookie,
      method: "PATCH",
      body: { name: "Ditolak" },
    });

    expect(response.status).toBe(403);
  });

  it("returns 404 when an admin edits another event", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}`, {
      cookie: w.adminB.cookie,
      method: "PATCH",
      body: { name: "IDOR" },
    });

    expect(response.status).toBe(404);
  });

  it("refuses to edit an archived event", async () => {
    const w = await world();

    await callApi(`/api/events/${w.eventA}/status`, {
      cookie: w.adminA.cookie,
      body: { status: "active" },
    });
    await callApi(`/api/events/${w.eventA}/status`, {
      cookie: w.adminA.cookie,
      body: { status: "closed" },
    });
    await callApi(`/api/events/${w.eventA}/status`, {
      cookie: w.adminA.cookie,
      body: { status: "archived" },
    });

    const response = await callApi(`/api/events/${w.eventA}`, {
      cookie: w.adminA.cookie,
      method: "PATCH",
      body: { name: "Tidak boleh" },
    });

    expect(response.status).toBe(422);
    expect(errorCode(response)).toBe("BUSINESS_RULE");
  });
});

describe("POST /api/events/:id/status", () => {
  it("walks the lifecycle draft → active → closed → archived", async () => {
    const w = await world();

    for (const status of ["active", "closed", "archived"] as const) {
      const response = await callApi(`/api/events/${w.eventA}/status`, {
        cookie: w.adminA.cookie,
        body: { status },
      });
      expect(response.status).toBe(200);

      const body = response.json<EventDetailPayload>();
      if (!body.ok) throw new Error("expected success");
      expect(body.data.event.status).toBe(status);
    }
  });

  it("rejects active → archived without closing first", async () => {
    const w = await world();

    await callApi(`/api/events/${w.eventA}/status`, {
      cookie: w.adminA.cookie,
      body: { status: "active" },
    });

    const response = await callApi(`/api/events/${w.eventA}/status`, {
      cookie: w.adminA.cookie,
      body: { status: "archived" },
    });

    expect(response.status).toBe(422);
    expect(errorCode(response)).toBe("BUSINESS_RULE");
  });

  it("treats archived as final", async () => {
    const w = await world();

    await callApi(`/api/events/${w.eventA}/status`, {
      cookie: w.adminA.cookie,
      body: { status: "active" },
    });
    await callApi(`/api/events/${w.eventA}/status`, {
      cookie: w.adminA.cookie,
      body: { status: "closed" },
    });
    await callApi(`/api/events/${w.eventA}/status`, {
      cookie: w.adminA.cookie,
      body: { status: "archived" },
    });

    const response = await callApi(`/api/events/${w.eventA}/status`, {
      cookie: w.adminA.cookie,
      body: { status: "active" },
    });

    expect(response.status).toBe(422);
  });

  it("returns 403 for an officer", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/status`, {
      cookie: w.officerA.cookie,
      body: { status: "active" },
    });

    expect(response.status).toBe(403);
  });
});

describe("DELETE /api/events/:id", () => {
  it("lets a superadmin delete an empty draft", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}`, {
      cookie: w.superadmin.cookie,
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(response.json<EventDeletePayload>()).toMatchObject({ ok: true });

    const after = await callApi(`/api/events/${w.eventA}`, { cookie: w.superadmin.cookie });
    expect(after.status).toBe(404);
  });

  it("refuses to delete a draft that already has participants", async () => {
    const w = await world();
    await createParticipant(w.eventA, { fullName: "Budi" });

    const response = await callApi(`/api/events/${w.eventA}`, {
      cookie: w.superadmin.cookie,
      method: "DELETE",
    });

    expect(response.status).toBe(422);
  });

  it("refuses to delete an active event", async () => {
    const w = await world();

    await callApi(`/api/events/${w.eventA}/status`, {
      cookie: w.adminA.cookie,
      body: { status: "active" },
    });

    const response = await callApi(`/api/events/${w.eventA}`, {
      cookie: w.superadmin.cookie,
      method: "DELETE",
    });

    expect(response.status).toBe(422);
  });

  it("is superadmin-only", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}`, {
      cookie: w.adminA.cookie,
      method: "DELETE",
    });

    expect(response.status).toBe(403);
  });
});

describe("GET /api/events/:id/summary", () => {
  it("counts participants by status inside the event only", async () => {
    const w = await world();

    await createParticipant(w.eventA, { fullName: "Aktif 1" });
    await createParticipant(w.eventA, { fullName: "Aktif 2" });
    await createParticipant(w.eventA, { fullName: "Nonaktif", status: "inactive" });
    await createParticipant(w.eventB, { fullName: "Acara B" });

    const response = await callApi(`/api/events/${w.eventA}/summary`, {
      cookie: w.officerA.cookie,
    });

    expect(response.status).toBe(200);
    const body = response.json<EventSummaryPayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data).toEqual({
      participantCount: 3,
      activeParticipantCount: 2,
      inactiveParticipantCount: 1,
    });
  });
});
