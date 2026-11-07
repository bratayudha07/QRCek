import type {
  CustomFieldDetailPayload,
  CustomFieldListPayload,
  ParticipantDetailPayload,
} from "@absensi/shared";
import { describe, expect, it } from "vitest";

import { testEnv } from "./env";
import {
  addMembership,
  createCustomField,
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

async function createFieldViaApi(
  eventId: string,
  cookie: string,
  body: Record<string, unknown> = {},
): Promise<CustomFieldDetailPayload["field"]> {
  const response = await callApi(`/api/events/${eventId}/custom-fields`, {
    cookie,
    body: { key: "nisn", label: "NISN", type: "text", ...body },
  });

  if (response.status !== 201) {
    throw new Error(`create custom field failed: ${response.status} ${response.text}`);
  }

  const payload = response.json<CustomFieldDetailPayload>();
  if (!payload.ok) throw new Error("expected success");
  return payload.data.field;
}

async function auditAfterJson(entityId: string): Promise<string> {
  const { results } = await testEnv.DB.prepare(
    "SELECT after_json FROM audit_log WHERE entity_id = ? ORDER BY created_at, id",
  )
    .bind(entityId)
    .all<{ after_json: string | null }>();
  return results.map((row) => row.after_json ?? "").join("\n");
}

describe("custom field catalogue", () => {
  it("accepts all nine documented types", async () => {
    const w = await world();
    const types = [
      "text",
      "number",
      "email",
      "phone",
      "select",
      "multi_select",
      "date",
      "textarea",
      "checkbox",
    ] as const;

    for (const type of types) {
      const field = await createFieldViaApi(w.eventA, w.adminA.cookie, {
        key: `field_${type}`,
        label: type,
        type,
        ...(type === "select" || type === "multi_select"
          ? { options: ["A", "B"] }
          : {}),
      });
      expect(field.type).toBe(type);
    }
  });

  it("rejects an unknown type", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/custom-fields`, {
      cookie: w.adminA.cookie,
      body: { key: "aneh", label: "Aneh", type: "currency" },
    });

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe("VALIDATION_ERROR");
  });

  it("requires options for select types and rejects options elsewhere", async () => {
    const w = await world();

    const missing = await callApi(`/api/events/${w.eventA}/custom-fields`, {
      cookie: w.adminA.cookie,
      body: { key: "golongan", label: "Golongan", type: "select" },
    });
    expect(missing.status).toBe(400);

    const extra = await callApi(`/api/events/${w.eventA}/custom-fields`, {
      cookie: w.adminA.cookie,
      body: { key: "nama", label: "Nama", type: "text", options: ["A"] },
    });
    expect(extra.status).toBe(400);
  });

  it("rejects more than 100 options as a business rule", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/custom-fields`, {
      cookie: w.adminA.cookie,
      body: {
        key: "golongan",
        label: "Golongan",
        type: "select",
        options: Array.from({ length: 101 }, (_, index) => `Opsi ${index}`),
      },
    });

    expect(response.status).toBe(422);
    expect(errorCode(response)).toBe("BUSINESS_RULE");
  });

  it("rejects duplicate options", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/custom-fields`, {
      cookie: w.adminA.cookie,
      body: { key: "golongan", label: "Golongan", type: "select", options: ["A", "A"] },
    });

    expect(response.status).toBe(400);
  });

  it("enforces the 50 active-field limit, and archiving frees a slot", async () => {
    const w = await world();
    for (let index = 0; index < 50; index += 1) {
      await createCustomField(w.eventA, { key: `field_${index}`, label: `Field ${index}` });
    }

    const blocked = await callApi(`/api/events/${w.eventA}/custom-fields`, {
      cookie: w.adminA.cookie,
      body: { key: "field_50", label: "Field 50", type: "text" },
    });
    expect(blocked.status).toBe(422);
    expect(errorCode(blocked)).toBe("BUSINESS_RULE");

    const { results } = await testEnv.DB.prepare(
      "SELECT id FROM custom_fields WHERE theme_id = ? ORDER BY key LIMIT 1",
    )
      .bind(w.eventA)
      .all<{ id: string }>();
    const archived = await callApi(
      `/api/events/${w.eventA}/custom-fields/${results[0]?.id}/status`,
      { cookie: w.adminA.cookie, body: { status: "archived" } },
    );
    expect(archived.status).toBe(200);

    const allowed = await callApi(`/api/events/${w.eventA}/custom-fields`, {
      cookie: w.adminA.cookie,
      body: { key: "field_50", label: "Field 50", type: "text" },
    });
    expect(allowed.status).toBe(201);
  });

  it("rejects a duplicate key case-sensitively", async () => {
    const w = await world();
    await createFieldViaApi(w.eventA, w.adminA.cookie, { key: "nisn" });

    const response = await callApi(`/api/events/${w.eventA}/custom-fields`, {
      cookie: w.adminA.cookie,
      body: { key: "nisn", label: "NISN lagi", type: "text" },
    });
    expect(response.status).toBe(409);
  });

  it("treats a field from another Tema as not found", async () => {
    const w = await world();
    const field = await createFieldViaApi(w.eventB, w.adminB.cookie);

    const read = await callApi(`/api/events/${w.eventA}/custom-fields/${field.id}`, {
      cookie: w.adminA.cookie,
    });
    const patch = await callApi(`/api/events/${w.eventA}/custom-fields/${field.id}`, {
      cookie: w.adminA.cookie,
      method: "PATCH",
      body: { label: "Bocor" },
    });

    expect(read.status).toBe(404);
    expect(patch.status).toBe(404);
  });

  it("lets an officer read but not write", async () => {
    const w = await world();
    const field = await createFieldViaApi(w.eventA, w.adminA.cookie);

    const list = await callApi(`/api/events/${w.eventA}/custom-fields`, {
      cookie: w.officerA.cookie,
    });
    expect(list.status).toBe(200);

    const create = await callApi(`/api/events/${w.eventA}/custom-fields`, {
      cookie: w.officerA.cookie,
      body: { key: "lain", label: "Lain", type: "text" },
    });
    expect(create.status).toBe(403);

    const patch = await callApi(`/api/events/${w.eventA}/custom-fields/${field.id}`, {
      cookie: w.officerA.cookie,
      method: "PATCH",
      body: { label: "Baru" },
    });
    expect(patch.status).toBe(403);
  });

  it("does not allow key or type through PATCH", async () => {
    const w = await world();
    const field = await createFieldViaApi(w.eventA, w.adminA.cookie);

    const key = await callApi(`/api/events/${w.eventA}/custom-fields/${field.id}`, {
      cookie: w.adminA.cookie,
      method: "PATCH",
      body: { key: "lain" },
    });
    const type = await callApi(`/api/events/${w.eventA}/custom-fields/${field.id}`, {
      cookie: w.adminA.cookie,
      method: "PATCH",
      body: { type: "number" },
    });

    expect(key.status).toBe(400);
    expect(type.status).toBe(400);
  });

  it("keeps participant values when the label changes or the field is archived", async () => {
    const w = await world();
    const field = await createFieldViaApi(w.eventA, w.adminA.cookie, {
      key: "nisn",
      label: "NISN",
    });
    const participant = await createParticipant(w.eventA, {
      fullName: "Siti",
      attributes: { nisn: "12345" },
    });

    const renamed = await callApi(`/api/events/${w.eventA}/custom-fields/${field.id}`, {
      cookie: w.adminA.cookie,
      method: "PATCH",
      body: { label: "Nomor Induk" },
    });
    expect(renamed.status).toBe(200);

    const archived = await callApi(
      `/api/events/${w.eventA}/custom-fields/${field.id}/status`,
      { cookie: w.adminA.cookie, body: { status: "archived" } },
    );
    expect(archived.status).toBe(200);

    const detail = await callApi(
      `/api/events/${w.eventA}/participants/${participant.id}`,
      { cookie: w.adminA.cookie },
    );
    const payload = detail.json<ParticipantDetailPayload>();
    if (!payload.ok) throw new Error("expected success");
    expect(payload.data.participant.attributes).toEqual({ nisn: "12345" });

    const write = await callApi(`/api/events/${w.eventA}/participants/${participant.id}`, {
      cookie: w.adminA.cookie,
      method: "PATCH",
      body: { attributes: { nisn: "999" } },
    });
    expect(write.status).toBe(422);
  });

  it("blocks removing an option that a participant still uses", async () => {
    const w = await world();
    const field = await createFieldViaApi(w.eventA, w.adminA.cookie, {
      key: "golongan",
      label: "Golongan",
      type: "select",
      options: ["A", "B"],
    });
    await createParticipant(w.eventA, { attributes: { golongan: "A" } });

    const remove = await callApi(`/api/events/${w.eventA}/custom-fields/${field.id}`, {
      cookie: w.adminA.cookie,
      method: "PATCH",
      body: { options: ["B"] },
    });
    expect(remove.status).toBe(422);
    expect(errorCode(remove)).toBe("BUSINESS_RULE");

    const add = await callApi(`/api/events/${w.eventA}/custom-fields/${field.id}`, {
      cookie: w.adminA.cookie,
      method: "PATCH",
      body: { options: ["A", "B", "C"] },
    });
    expect(add.status).toBe(200);
  });

  it("changes type only when every stored value is compatible", async () => {
    const w = await world();
    const field = await createFieldViaApi(w.eventA, w.adminA.cookie, {
      key: "catatan",
      label: "Catatan",
      type: "text",
    });
    await createParticipant(w.eventA, { attributes: { catatan: "A" } });

    const valid = await callApi(`/api/events/${w.eventA}/custom-fields/${field.id}/type`, {
      cookie: w.adminA.cookie,
      body: { type: "select", options: ["A", "B"] },
    });
    expect(valid.status).toBe(200);

    const invalid = await callApi(`/api/events/${w.eventA}/custom-fields/${field.id}/type`, {
      cookie: w.adminA.cookie,
      body: { type: "select", options: ["B"] },
    });
    expect(invalid.status).toBe(422);

    const backToText = await callApi(
      `/api/events/${w.eventA}/custom-fields/${field.id}/type`,
      { cookie: w.adminA.cookie, body: { type: "text" } },
    );
    expect(backToText.status).toBe(200);

    const incompatible = await callApi(
      `/api/events/${w.eventA}/custom-fields/${field.id}/type`,
      { cookie: w.adminA.cookie, body: { type: "select", options: ["B"] } },
    );
    expect(incompatible.status).toBe(422);
    expect(errorCode(incompatible)).toBe("BUSINESS_RULE");

    const forbidden = await callApi(`/api/events/${w.eventA}/custom-fields/${field.id}/type`, {
      cookie: w.adminA.cookie,
      body: { type: "checkbox" },
    });
    expect(forbidden.status).toBe(422);
  });

  it("never writes option labels into the audit snapshot", async () => {
    const w = await world();
    const field = await createFieldViaApi(w.eventA, w.adminA.cookie, {
      key: "golongan",
      label: "Golongan",
      type: "select",
      options: ["RAHASIA-OPSI"],
    });

    const audit = await auditAfterJson(field.id);
    expect(audit).toContain("Golongan");
    expect(audit).not.toContain("RAHASIA-OPSI");
  });

  it("refuses every mutation when the Tema is archived", async () => {
    const w = await world();
    const field = await createFieldViaApi(w.eventA, w.adminA.cookie);

    for (const status of ["active", "closed", "archived"] as const) {
      await callApi(`/api/events/${w.eventA}/status`, {
        cookie: w.adminA.cookie,
        body: { status },
      });
    }

    const create = await callApi(`/api/events/${w.eventA}/custom-fields`, {
      cookie: w.adminA.cookie,
      body: { key: "lain", label: "Lain", type: "text" },
    });
    const patch = await callApi(`/api/events/${w.eventA}/custom-fields/${field.id}`, {
      cookie: w.adminA.cookie,
      method: "PATCH",
      body: { label: "Baru" },
    });
    const status = await callApi(
      `/api/events/${w.eventA}/custom-fields/${field.id}/status`,
      { cookie: w.adminA.cookie, body: { status: "archived" } },
    );
    const type = await callApi(
      `/api/events/${w.eventA}/custom-fields/${field.id}/type`,
      { cookie: w.adminA.cookie, body: { type: "textarea" } },
    );

    for (const response of [create, patch, status, type]) {
      expect(response.status).toBe(422);
      expect(errorCode(response)).toBe("BUSINESS_RULE");
    }
  });

  it("lists by scope and status", async () => {
    const w = await world();
    const participantField = await createFieldViaApi(w.eventA, w.adminA.cookie, {
      key: "nisn",
      label: "NISN",
    });
    await createFieldViaApi(w.eventA, w.adminA.cookie, {
      key: "nomor_kursi",
      label: "Nomor kursi",
      scope: "activity",
    });
    await callApi(`/api/events/${w.eventA}/custom-fields/${participantField.id}/status`, {
      cookie: w.adminA.cookie,
      body: { status: "archived" },
    });

    const response = await callApi(
      `/api/events/${w.eventA}/custom-fields?scope=participant&status=archived`,
      { cookie: w.adminA.cookie },
    );
    const payload = response.json<CustomFieldListPayload>();
    if (!payload.ok) throw new Error("expected success");
    expect(payload.data.fields.map((row) => row.key)).toEqual(["nisn"]);
  });

  it("does not accept activity-scoped values on a participant", async () => {
    const w = await world();
    await createFieldViaApi(w.eventA, w.adminA.cookie, {
      key: "nomor_kursi",
      label: "Nomor kursi",
      scope: "activity",
    });

    const response = await callApi(`/api/events/${w.eventA}/participants`, {
      cookie: w.adminA.cookie,
      body: {
        fullName: "Siti",
        category: "Kelas Uji",
        attributes: { nomor_kursi: "A1" },
      },
    });

    expect(response.status).toBe(201);
    const payload = response.json<ParticipantDetailPayload>();
    if (!payload.ok) throw new Error("expected success");
    expect(payload.data.participant.attributes).toEqual({});
  });
});
