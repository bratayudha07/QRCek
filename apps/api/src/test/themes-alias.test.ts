import type { EventDetailPayload, EventListPayload } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import { addMembership, createEvent, createSession, createUser } from "./fixtures";
import { callApi, errorCode } from "./http";

/**
 * `/api/themes` and `/api/calendar` are aliases of `/api/events` (ADR-0009).
 *
 * Neither alias has its own handler: `app.ts` derives them from the same route
 * table, so behaviour must be byte-for-byte equivalent to the canonical path.
 * These tests fail if an alias drifts (wrong guard, wrong status, wrong body).
 */

interface World {
  superadmin: { id: string; cookie: string };
  eventA: string;
  adminA: { id: string; cookie: string };
  adminB: { id: string; cookie: string };
}

async function world(): Promise<World> {
  const superadminId = await createUser({ role: "superadmin" });
  const eventA = await createEvent({ createdBy: superadminId, name: "Acara A" });

  const adminAId = await createUser({ role: "event_admin", displayName: "Admin A" });
  await addMembership(eventA, adminAId, "event_admin");

  const adminBId = await createUser({ role: "event_admin", displayName: "Admin B" });

  return {
    superadmin: { id: superadminId, cookie: (await createSession(superadminId)).cookie },
    eventA,
    adminA: { id: adminAId, cookie: (await createSession(adminAId)).cookie },
    adminB: { id: adminBId, cookie: (await createSession(adminBId)).cookie },
  };
}

const ALIASES = ["/api/calendar", "/api/themes"] as const;

describe("theme alias routes", () => {
  it.each(ALIASES)("%s lists the same themes as /api/events", async (prefix) => {
    const w = await world();

    const canonical = await callApi("/api/events", { cookie: w.adminA.cookie });
    const aliased = await callApi(prefix, { cookie: w.adminA.cookie });

    expect(canonical.status).toBe(200);
    expect(aliased.status).toBe(200);

    const canonicalBody = canonical.json<EventListPayload>();
    const aliasedBody = aliased.json<EventListPayload>();
    if (!canonicalBody.ok || !aliasedBody.ok) throw new Error("expected success");

    expect(aliasedBody.data).toEqual(canonicalBody.data);
  });

  it.each(ALIASES)("%s returns the same detail as /api/events", async (prefix) => {
    const w = await world();

    const canonical = await callApi(`/api/events/${w.eventA}`, { cookie: w.adminA.cookie });
    const aliased = await callApi(`${prefix}/${w.eventA}`, { cookie: w.adminA.cookie });

    expect(aliased.status).toBe(200);

    const canonicalBody = canonical.json<EventDetailPayload>();
    const aliasedBody = aliased.json<EventDetailPayload>();
    if (!canonicalBody.ok || !aliasedBody.ok) throw new Error("expected success");

    expect(aliasedBody.data).toEqual(canonicalBody.data);
  });

  it.each(ALIASES)("%s keeps the 404 for a Tema the caller cannot see", async (prefix) => {
    const w = await world();

    const response = await callApi(`${prefix}/${w.eventA}`, { cookie: w.adminB.cookie });

    expect(response.status).toBe(404);
    expect(errorCode(response)).toBe("NOT_FOUND");
  });

  it.each(ALIASES)("%s still requires a session", async (prefix) => {
    const response = await callApi(prefix);

    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe("UNAUTHENTICATED");
  });

  it("keeps alias mutations writing through the canonical handler", async () => {
    const w = await world();

    const response = await callApi(`/api/themes/${w.eventA}`, {
      method: "PATCH",
      cookie: w.adminA.cookie,
      body: { name: "Acara A (baru)" },
    });

    expect(response.status).toBe(200);

    const body = response.json<EventDetailPayload>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data.event.name).toBe("Acara A (baru)");

    const canonical = await callApi(`/api/events/${w.eventA}`, { cookie: w.adminA.cookie });
    const canonicalBody = canonical.json<EventDetailPayload>();
    if (!canonicalBody.ok) throw new Error("expected success");
    expect(canonicalBody.data.event.name).toBe("Acara A (baru)");
  });
});
