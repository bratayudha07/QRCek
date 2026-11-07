import type { ParticipantDetailPayload } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import { testEnv } from "./env";
import {
  addMembership,
  createCategory,
  createCustomField,
  createEvent,
  createParticipant,
  createSession,
  createUser,
} from "./fixtures";
import { callApi, errorCode } from "./http";

interface World {
  eventA: string;
  eventB: string;
  adminA: { id: string; cookie: string };
}

async function world(): Promise<World> {
  const superadminId = await createUser({ role: "superadmin" });
  const eventA = await createEvent({ createdBy: superadminId, name: "Acara A" });
  const eventB = await createEvent({ createdBy: superadminId, name: "Acara B" });

  const adminAId = await createUser({ role: "event_admin" });
  await addMembership(eventA, adminAId, "event_admin");

  return {
    eventA,
    eventB,
    adminA: { id: adminAId, cookie: (await createSession(adminAId)).cookie },
  };
}

async function createViaApi(
  eventId: string,
  cookie: string,
  body: Record<string, unknown>,
): Promise<ParticipantDetailPayload["participant"]> {
  const response = await callApi(`/api/events/${eventId}/participants`, { cookie, body });
  if (response.status !== 201) {
    throw new Error(`create participant failed: ${response.status} ${response.text}`);
  }
  const payload = response.json<ParticipantDetailPayload>();
  if (!payload.ok) throw new Error("expected success");
  return payload.data.participant;
}

describe("participant attributes", () => {
  it("requires a category on create", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/participants`, {
      cookie: w.adminA.cookie,
      body: { fullName: "Siti" },
    });

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe("VALIDATION_ERROR");
    expect(response.text).toMatch(/categoryId/);
  });

  it("rejects a category that belongs to another Tema", async () => {
    const w = await world();
    const foreign = await createCategory(w.eventB, { name: "Kelas Lain" });

    const response = await callApi(`/api/events/${w.eventA}/participants`, {
      cookie: w.adminA.cookie,
      body: { fullName: "Siti", categoryId: foreign.id },
    });

    expect(response.status).toBe(404);
  });

  it("enforces required fields on create", async () => {
    const w = await world();
    const category = await createCategory(w.eventA, { name: "Kelas 7A" });
    await createCustomField(w.eventA, {
      key: "nisn",
      label: "NISN",
      type: "text",
      required: true,
    });

    const missing = await callApi(`/api/events/${w.eventA}/participants`, {
      cookie: w.adminA.cookie,
      body: { fullName: "Siti", categoryId: category.id },
    });
    expect(missing.status).toBe(422);
    expect(errorCode(missing)).toBe("BUSINESS_RULE");
    expect(missing.text).toMatch(/nisn/);

    const created = await createViaApi(w.eventA, w.adminA.cookie, {
      fullName: "Siti",
      categoryId: category.id,
      attributes: { nisn: "12345" },
    });
    expect(created.attributes).toEqual({ nisn: "12345" });
  });

  it("rejects a value whose type is wrong and reports the key", async () => {
    const w = await world();
    const category = await createCategory(w.eventA, { name: "Kelas 7A" });
    await createCustomField(w.eventA, { key: "tinggi", label: "Tinggi", type: "number" });

    const response = await callApi(`/api/events/${w.eventA}/participants`, {
      cookie: w.adminA.cookie,
      body: {
        fullName: "Siti",
        categoryId: category.id,
        attributes: { tinggi: "170" },
      },
    });

    expect(response.status).toBe(422);
    expect(response.text).toMatch(/tinggi/);
  });

  it("drops unknown and activity-scoped keys instead of storing them", async () => {
    const w = await world();
    const category = await createCategory(w.eventA, { name: "Kelas 7A" });
    await createCustomField(w.eventA, {
      key: "nomor_kursi",
      label: "Nomor kursi",
      scope: "activity",
    });

    const created = await createViaApi(w.eventA, w.adminA.cookie, {
      fullName: "Siti",
      categoryId: category.id,
      attributes: { nomor_kursi: "A1", tidak_ada: "x" },
    });

    expect(created.attributes).toEqual({});
  });

  it("merges a partial patch and removes an optional value with null", async () => {
    const w = await world();
    const category = await createCategory(w.eventA, { name: "Kelas 7A" });
    await createCustomField(w.eventA, { key: "nisn", label: "NISN" });
    await createCustomField(w.eventA, { key: "wali", label: "Wali" });
    const participant = await createViaApi(w.eventA, w.adminA.cookie, {
      fullName: "Siti",
      categoryId: category.id,
      attributes: { nisn: "123", wali: "Budi" },
    });

    const patched = await callApi(
      `/api/events/${w.eventA}/participants/${participant.id}`,
      {
        cookie: w.adminA.cookie,
        method: "PATCH",
        body: { attributes: { wali: null } },
      },
    );
    const payload = patched.json<ParticipantDetailPayload>();
    if (!payload.ok) throw new Error("expected success");
    expect(payload.data.participant.attributes).toEqual({ nisn: "123" });
  });

  it("refuses to clear a required value", async () => {
    const w = await world();
    const category = await createCategory(w.eventA, { name: "Kelas 7A" });
    await createCustomField(w.eventA, {
      key: "nisn",
      label: "NISN",
      required: true,
    });
    const participant = await createViaApi(w.eventA, w.adminA.cookie, {
      fullName: "Siti",
      categoryId: category.id,
      attributes: { nisn: "123" },
    });

    const response = await callApi(
      `/api/events/${w.eventA}/participants/${participant.id}`,
      {
        cookie: w.adminA.cookie,
        method: "PATCH",
        body: { attributes: { nisn: null } },
      },
    );

    expect(response.status).toBe(422);
  });

  it("does not force retroactive backfill of a newly required field", async () => {
    const w = await world();
    const category = await createCategory(w.eventA, { name: "Kelas 7A" });
    const participant = await createViaApi(w.eventA, w.adminA.cookie, {
      fullName: "Siti",
      categoryId: category.id,
    });
    await createCustomField(w.eventA, {
      key: "nisn",
      label: "NISN",
      required: true,
    });

    const response = await callApi(
      `/api/events/${w.eventA}/participants/${participant.id}`,
      {
        cookie: w.adminA.cookie,
        method: "PATCH",
        body: { note: "tanpa mengisi NISN" },
      },
    );

    expect(response.status).toBe(200);
  });

  it("records only changed attribute keys in the audit snapshot", async () => {
    const w = await world();
    const category = await createCategory(w.eventA, { name: "Kelas 7A" });
    await createCustomField(w.eventA, { key: "nisn", label: "NISN" });
    const participant = await createViaApi(w.eventA, w.adminA.cookie, {
      fullName: "Siti",
      categoryId: category.id,
      attributes: { nisn: "123" },
    });

    await callApi(`/api/events/${w.eventA}/participants/${participant.id}`, {
      cookie: w.adminA.cookie,
      method: "PATCH",
      body: { attributes: { nisn: "RAHASIA-456" } },
    });

    const { results } = await testEnv.DB.prepare(
      "SELECT after_json FROM audit_log WHERE entity_id = ? AND action = 'participant.updated'",
    )
      .bind(participant.id)
      .all<{ after_json: string }>();

    const latest = results[0]?.after_json ?? "";
    expect(latest).toContain("nisn");
    expect(latest).not.toContain("RAHASIA-456");
    expect(latest).not.toContain("Siti");
  });

  it("rejects a non-object attributes payload", async () => {
    const w = await world();
    const category = await createCategory(w.eventA, { name: "Kelas 7A" });

    const response = await callApi(`/api/events/${w.eventA}/participants`, {
      cookie: w.adminA.cookie,
      body: { fullName: "Siti", categoryId: category.id, attributes: ["nisn"] },
    });

    expect(response.status).toBe(400);
  });

  it("cannot store invalid JSON through the schema", async () => {
    const w = await world();
    const category = await createCategory(w.eventA, { name: "Kelas 7A" });
    const participant = await createParticipant(w.eventA, { categoryId: category.id });

    await expect(
      testEnv.DB.prepare("UPDATE participants SET attributes_json = ? WHERE id = ?")
        .bind("{bukan json", participant.id)
        .run(),
    ).rejects.toThrow(/CHECK/i);
  });
});
