import type {
  ParticipantDeletePayload,
  ParticipantDetailPayload,
  ParticipantListPayload,
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

async function addParticipant(
  eventId: string,
  cookie: string,
  overrides: Record<string, unknown> = {},
): Promise<ParticipantDetailPayload["participant"]> {
  const response = await callApi(`/api/events/${eventId}/participants`, {
    cookie,
    body: { fullName: "Budi Santoso", ...overrides },
  });

  if (response.status !== 201) {
    throw new Error(`create participant failed: ${response.status} ${response.text}`);
  }

  const body = response.json<ParticipantDetailPayload>();
  if (!body.ok) throw new Error("expected success");
  return body.data.participant;
}

describe("POST /api/events/:id/participants", () => {
  it("creates and normalizes a participant", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/participants`, {
      cookie: w.adminA.cookie,
      body: {
        externalRef: " NIS-001 ",
        fullName: "  Budi   Santoso ",
        phone: "0812-3456-7890",
        email: "BUDI@Example.com",
        category: "Kelas 5A",
      },
    });

    expect(response.status).toBe(201);
    const body = response.json<ParticipantDetailPayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data.participant).toMatchObject({
      externalRef: "NIS-001",
      fullName: "Budi Santoso",
      phone: "+6281234567890",
      email: "budi@example.com",
      category: "Kelas 5A",
      status: "active",
    });
  });

  it("returns 403 for an officer", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/participants`, {
      cookie: w.officerA.cookie,
      body: { fullName: "Budi" },
    });

    expect(response.status).toBe(403);
  });

  it("returns 404 for an admin of another event", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/participants`, {
      cookie: w.adminB.cookie,
      body: { fullName: "IDOR" },
    });

    expect(response.status).toBe(404);
  });

  it("rejects a duplicate external_ref within the event", async () => {
    const w = await world();
    await addParticipant(w.eventA, w.adminA.cookie, { externalRef: "NIS-1" });

    const response = await callApi(`/api/events/${w.eventA}/participants`, {
      cookie: w.adminA.cookie,
      body: { fullName: "Peserta Lain", externalRef: "NIS-1" },
    });

    expect(response.status).toBe(409);
    expect(errorCode(response)).toBe("CONFLICT");
  });

  it("allows the same external_ref in a different event", async () => {
    const w = await world();
    await addParticipant(w.eventA, w.adminA.cookie, { externalRef: "NIS-1" });

    const participant = await addParticipant(w.eventB, w.adminB.cookie, {
      externalRef: "NIS-1",
      fullName: "Peserta B",
    });

    expect(participant.externalRef).toBe("NIS-1");
  });

  it("refuses writes to an archived event", async () => {
    const w = await world();

    for (const status of ["active", "closed", "archived"] as const) {
      await callApi(`/api/events/${w.eventA}/status`, {
        cookie: w.adminA.cookie,
        body: { status },
      });
    }

    const response = await callApi(`/api/events/${w.eventA}/participants`, {
      cookie: w.adminA.cookie,
      body: { fullName: "Terlambat" },
    });

    expect(response.status).toBe(422);
  });
});

describe("GET /api/events/:id/participants", () => {
  it("lists, searches, and filters participants", async () => {
    const w = await world();
    await addParticipant(w.eventA, w.adminA.cookie, { fullName: "Budi Santoso" });
    await addParticipant(w.eventA, w.adminA.cookie, { fullName: "Siti Aminah" });
    const inactiveParticipant = await addParticipant(w.eventA, w.adminA.cookie, {
      fullName: "Nonaktif",
    });
    await callApi(`/api/events/${w.eventA}/participants/${inactiveParticipant.id}`, {
      cookie: w.adminA.cookie,
      method: "DELETE",
      body: { confirm: true },
    });

    const all = await callApi(`/api/events/${w.eventA}/participants?status=all`, {
      cookie: w.officerA.cookie,
    });
    const allBody = all.json<ParticipantListPayload>();
    if (!allBody.ok) throw new Error("expected success");
    expect(allBody.data.items).toHaveLength(3);

    const search = await callApi(`/api/events/${w.eventA}/participants?query=bud`, {
      cookie: w.officerA.cookie,
    });
    const searchBody = search.json<ParticipantListPayload>();
    if (!searchBody.ok) throw new Error("expected success");
    expect(searchBody.data.items.map((item) => item.fullName)).toEqual(["Budi Santoso"]);

    const active = await callApi(`/api/events/${w.eventA}/participants`, {
      cookie: w.officerA.cookie,
    });
    const activeBody = active.json<ParticipantListPayload>();
    if (!activeBody.ok) throw new Error("expected success");
    expect(activeBody.data.items).toHaveLength(2);

    const inactive = await callApi(
      `/api/events/${w.eventA}/participants?status=inactive`,
      { cookie: w.officerA.cookie },
    );
    const inactiveBody = inactive.json<ParticipantListPayload>();
    if (!inactiveBody.ok) throw new Error("expected success");
    expect(inactiveBody.data.items.map((item) => item.fullName)).toEqual(["Nonaktif"]);
  });

  it("paginates with an opaque cursor without duplicates", async () => {
    const w = await world();
    for (const name of ["A", "B", "C"]) {
      await addParticipant(w.eventA, w.adminA.cookie, { fullName: `Peserta ${name}` });
    }

    const first = await callApi(`/api/events/${w.eventA}/participants?limit=2`, {
      cookie: w.officerA.cookie,
    });
    const firstBody = first.json<ParticipantListPayload>();
    if (!firstBody.ok) throw new Error("expected success");
    expect(firstBody.data.items).toHaveLength(2);
    expect(firstBody.data.nextCursor).not.toBeNull();

    const second = await callApi(
      `/api/events/${w.eventA}/participants?limit=2&cursor=${encodeURIComponent(firstBody.data.nextCursor ?? "")}`,
      { cookie: w.officerA.cookie },
    );
    const secondBody = second.json<ParticipantListPayload>();
    if (!secondBody.ok) throw new Error("expected success");

    const ids = [...firstBody.data.items, ...secondBody.data.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(3);
    expect(secondBody.data.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor", async () => {
    const w = await world();

    const response = await callApi(
      `/api/events/${w.eventA}/participants?cursor=bukan-cursor`,
      { cookie: w.officerA.cookie },
    );

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for another event", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/participants`, {
      cookie: w.adminB.cookie,
    });

    expect(response.status).toBe(404);
  });
});

describe("participant detail, edit, and controlled delete", () => {
  it("lets an officer read a participant but not edit it", async () => {
    const w = await world();
    const participant = await addParticipant(w.eventA, w.adminA.cookie);

    const read = await callApi(
      `/api/events/${w.eventA}/participants/${participant.id}`,
      { cookie: w.officerA.cookie },
    );
    expect(read.status).toBe(200);

    const write = await callApi(
      `/api/events/${w.eventA}/participants/${participant.id}`,
      { cookie: w.officerA.cookie, method: "PATCH", body: { fullName: "Ditolak" } },
    );
    expect(write.status).toBe(403);
  });

  it("does not expose a participant through another event id (IDOR)", async () => {
    const w = await world();
    const participant = await addParticipant(w.eventB, w.adminB.cookie, {
      fullName: "Peserta B",
    });

    const response = await callApi(
      `/api/events/${w.eventA}/participants/${participant.id}`,
      { cookie: w.adminA.cookie },
    );

    expect(response.status).toBe(404);
  });

  it("updates fields, clears optional values, and restores status", async () => {
    const w = await world();
    const participant = await addParticipant(w.eventA, w.adminA.cookie, {
      phone: "081234567890",
      category: "Kelas 5A",
    });

    const updated = await callApi(
      `/api/events/${w.eventA}/participants/${participant.id}`,
      {
        cookie: w.adminA.cookie,
        method: "PATCH",
        body: { fullName: "Budi Baru", phone: null, category: null },
      },
    );

    expect(updated.status).toBe(200);
    const body = updated.json<ParticipantDetailPayload>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data.participant).toMatchObject({
      fullName: "Budi Baru",
      phone: null,
      category: null,
    });

    await callApi(`/api/events/${w.eventA}/participants/${participant.id}`, {
      cookie: w.adminA.cookie,
      method: "DELETE",
      body: { confirm: true },
    });

    const restored = await callApi(
      `/api/events/${w.eventA}/participants/${participant.id}`,
      { cookie: w.adminA.cookie, method: "PATCH", body: { status: "active" } },
    );
    const restoredBody = restored.json<ParticipantDetailPayload>();
    if (!restoredBody.ok) throw new Error("expected success");
    expect(restoredBody.data.participant.status).toBe("active");
  });

  it("rejects an edit that duplicates external_ref", async () => {
    const w = await world();
    await addParticipant(w.eventA, w.adminA.cookie, { externalRef: "NIS-1" });
    const second = await addParticipant(w.eventA, w.adminA.cookie, {
      fullName: "Siti",
      externalRef: "NIS-2",
    });

    const response = await callApi(
      `/api/events/${w.eventA}/participants/${second.id}`,
      { cookie: w.adminA.cookie, method: "PATCH", body: { externalRef: "NIS-1" } },
    );

    expect(response.status).toBe(409);
  });

  it("requires explicit confirmation before deactivating", async () => {
    const w = await world();
    const participant = await addParticipant(w.eventA, w.adminA.cookie);

    const refused = await callApi(
      `/api/events/${w.eventA}/participants/${participant.id}`,
      { cookie: w.adminA.cookie, method: "DELETE", body: {} },
    );
    expect(refused.status).toBe(400);

    const deleted = await callApi(
      `/api/events/${w.eventA}/participants/${participant.id}`,
      { cookie: w.adminA.cookie, method: "DELETE", body: { confirm: true } },
    );
    expect(deleted.status).toBe(200);

    const body = deleted.json<ParticipantDeletePayload>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data).toEqual({ deleted: true, status: "inactive" });

    const row = await callApi(
      `/api/events/${w.eventA}/participants/${participant.id}`,
      { cookie: w.adminA.cookie },
    );
    const rowBody = row.json<ParticipantDetailPayload>();
    if (!rowBody.ok) throw new Error("expected success");
    expect(rowBody.data.participant.status).toBe("inactive");
  });

  it("does not let another event's admin deactivate via the wrong event", async () => {
    const w = await world();
    const participant = await addParticipant(w.eventA, w.adminA.cookie);

    const response = await callApi(
      `/api/events/${w.eventA}/participants/${participant.id}`,
      { cookie: w.adminB.cookie, method: "DELETE", body: { confirm: true } },
    );

    expect(response.status).toBe(404);
  });
});

describe("export and template", () => {
  it("exports a CSV that can be re-imported", async () => {
    const w = await world();
    await createParticipant(w.eventA, {
      externalRef: "NIS-1",
      fullName: "Budi, Santoso",
      phone: "+6281234567890",
    });

    const response = await callApi(`/api/events/${w.eventA}/participants/export`, {
      cookie: w.adminA.cookie,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("peserta-acara-a.csv");
    expect(response.text).toContain('"Budi, Santoso"');
    expect(response.text).toContain("+6281234567890");
    // `Response.text()` decodes UTF-8 and drops the BOM; the header is still
    // the canonical one, which is what makes the export re-importable.
    expect(response.text.startsWith("external_ref,full_name")).toBe(true);
  });

  it("applies search and status filters to the export", async () => {
    const w = await world();
    await createParticipant(w.eventA, { fullName: "Budi", status: "active" });
    await createParticipant(w.eventA, { fullName: "Siti", status: "inactive" });
    const response = await callApi(
      `/api/events/${w.eventA}/participants/export?status=inactive`,
      { cookie: w.adminA.cookie },
    );

    expect(response.text).toContain("Siti");
    expect(response.text).not.toContain("Budi");
  });

  it("denies export and template to an officer", async () => {
    const w = await world();

    const exportResponse = await callApi(
      `/api/events/${w.eventA}/participants/export`,
      { cookie: w.officerA.cookie },
    );
    expect(exportResponse.status).toBe(403);

    const templateResponse = await callApi(
      `/api/events/${w.eventA}/participants/template`,
      { cookie: w.officerA.cookie },
    );
    expect(templateResponse.status).toBe(403);
  });

  it("serves a downloadable template for an event admin", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/participants/template`, {
      cookie: w.adminA.cookie,
    });

    expect(response.status).toBe(200);
    expect(response.text.replace("\uFEFF", "")).toBe(
      "external_ref,full_name,phone,email,category,note\r\n",
    );
    expect(response.headers.get("content-disposition")).toContain("template-peserta.csv");
  });

  it("returns 404 for a non-member export attempt", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/participants/export`, {
      cookie: w.adminB.cookie,
    });

    expect(response.status).toBe(404);
  });
});

describe("participant data integrity", () => {
  it("stores UTC timestamps from the injected clock", async () => {
    const w = await world();
    const participant = await addParticipant(w.eventA, w.adminA.cookie);

    expect(participant.createdAt).toBe(TEST_NOW);
    expect(participant.updatedAt).toBe(TEST_NOW);
  });
});
