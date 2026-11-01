import type { LabelConfigPayload, QrLabelPayload } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import { parseQrPayload } from "../domain/qr-token";
import { hashQrToken } from "../domain/qr-token";
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
 * API tests for `POST /participants/qr-labels` and the per-event label config.
 *
 * Every call goes through the real router, session cookie, CSRF check, D1
 * binding, and the real secrets in `wrangler.test.jsonc` — only the clock is
 * injected (AGENTS.md §Pengujian).
 */

interface CredentialRow {
  qr_token_hash: string | null;
  qr_token_ciphertext: string | null;
  qr_token_nonce: string | null;
  qr_key_version: number | null;
  qr_issued_at: number | null;
}

interface AuditRow {
  actor_user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  after_json: string;
}

interface World {
  eventA: string;
  eventB: string;
  adminA: { id: string; cookie: string };
  officerA: { id: string; cookie: string };
  adminB: { id: string; cookie: string };
}

const labelsPath = (eventId: string) => `/api/events/${eventId}/participants/qr-labels`;
const configPath = (eventId: string) => `/api/events/${eventId}/label-config`;

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

  const [adminA, officerA, adminB] = await Promise.all([
    createSession(adminAId),
    createSession(officerAId),
    createSession(adminBId),
  ]);

  return {
    eventA,
    eventB,
    adminA: { id: adminAId, cookie: adminA.cookie },
    officerA: { id: officerAId, cookie: officerA.cookie },
    adminB: { id: adminBId, cookie: adminB.cookie },
  };
}

async function credentialOf(participantId: string): Promise<CredentialRow | null> {
  return testEnv.DB.prepare(
    `SELECT qr_token_hash, qr_token_ciphertext, qr_token_nonce, qr_key_version, qr_issued_at
       FROM participants WHERE id = ?`,
  )
    .bind(participantId)
    .first<CredentialRow>();
}

async function audits(eventId: string): Promise<AuditRow[]> {
  const { results } = await testEnv.DB.prepare(
    `SELECT actor_user_id, action, entity_type, entity_id, after_json
       FROM audit_log WHERE event_id = ? AND action = 'qr.labels_exported'`,
  )
    .bind(eventId)
    .all<AuditRow>();

  return results;
}

describe("POST /participants/qr-labels", () => {
  it("issues a credential for every active participant and stores only encrypted data", async () => {
    const { eventA, adminA } = await world();
    const first = await createParticipant(eventA, { fullName: "Siti", externalRef: "A-1" });
    await createParticipant(eventA, { fullName: "Budi", category: "Kelas 7" });

    expect((await credentialOf(first.id))?.qr_token_hash).toBeNull();

    const response = await callApi(labelsPath(eventA), {
      method: "POST",
      cookie: adminA.cookie,
      body: {},
    });

    expect(response.status).toBe(200);
    const payload = response.json<QrLabelPayload>();
    if (!payload.ok) throw new Error("expected success");

    expect(payload.data.labels).toHaveLength(2);
    expect(payload.data.event).toEqual({ id: eventA, name: "Acara A" });
    expect(payload.data.fields).toEqual(["fullName", "externalRef", "category"]);

    for (const label of payload.data.labels) {
      expect(Object.keys(label).sort()).toEqual(["participantId", "qr", "values"]);
      expect(label.qr.startsWith("absensi:v1:")).toBe(true);

      const token = parseQrPayload(label.qr);
      expect(token).not.toBeNull();

      const stored = await credentialOf(label.participantId);
      expect(stored?.qr_token_hash).toBe(await hashQrToken(testEnv.QR_PEPPER, token as string));
      expect(stored?.qr_token_ciphertext).toHaveLength(79);
      expect(stored?.qr_token_nonce).toHaveLength(16);
      expect(stored?.qr_key_version).toBe(1);
      expect(stored?.qr_issued_at).toBeGreaterThan(0);
      // Plaintext never reaches D1: neither the token nor its payload is a column.
      expect(JSON.stringify(stored)).not.toContain(token as string);
    }

    const siti = payload.data.labels.find((label) => label.participantId === first.id);
    expect(siti?.values.fullName).toBe("Siti");
    expect(siti?.values.externalRef).toBe("A-1");
    expect(siti?.values.category).toBeUndefined();
  });

  it("rejects unauthenticated, under-privileged, and cross-event callers", async () => {
    const { eventA, eventB, adminB, officerA } = await world();
    await createParticipant(eventA, { fullName: "Siti" });

    const anonymous = await callApi(labelsPath(eventA), { method: "POST", body: {} });
    expect(anonymous.status).toBe(401);
    expect(errorCode(anonymous)).toBe("UNAUTHENTICATED");

    const officer = await callApi(labelsPath(eventA), {
      method: "POST",
      cookie: officerA.cookie,
      body: {},
    });
    expect(officer.status).toBe(403);
    expect(errorCode(officer)).toBe("FORBIDDEN");

    const foreign = await callApi(labelsPath(eventA), {
      method: "POST",
      cookie: adminB.cookie,
      body: {},
    });
    expect(foreign.status).toBe(404);

    // A superadmin is allowed, but an id from another event still cannot be
    // printed through this event's endpoint.
    const foreignParticipant = await createParticipant(eventB, { fullName: "Peserta B" });
    const superadmin = await createSession(
      await createUser({ role: "superadmin", displayName: "Super" }),
    );
    const mixed = await callApi(labelsPath(eventA), {
      method: "POST",
      cookie: superadmin.cookie,
      body: { participantIds: [foreignParticipant.id] },
    });

    expect(mixed.status).toBe(200);
    const mixedBody = mixed.json<QrLabelPayload>();
    if (!mixedBody.ok) throw new Error("expected success");
    expect(mixedBody.data.labels).toEqual([]);
  });

  it("excludes inactive participants from both selection modes", async () => {
    const { eventA, adminA } = await world();
    await createParticipant(eventA, { fullName: "Aktif" });
    const inactive = await createParticipant(eventA, {
      fullName: "Nonaktif",
      status: "inactive",
    });

    const all = await callApi(labelsPath(eventA), {
      method: "POST",
      cookie: adminA.cookie,
      body: {},
    });
    const allBody = all.json<QrLabelPayload>();
    if (!allBody.ok) throw new Error("expected success");
    expect(allBody.data.labels.map((label) => label.participantId)).not.toContain(inactive.id);
    expect(allBody.data.labels).toHaveLength(1);

    const explicit = await callApi(labelsPath(eventA), {
      method: "POST",
      cookie: adminA.cookie,
      body: { participantIds: [inactive.id] },
    });
    const explicitBody = explicit.json<QrLabelPayload>();
    if (!explicitBody.ok) throw new Error("expected success");
    expect(explicitBody.data.labels).toEqual([]);
    expect((await credentialOf(inactive.id))?.qr_token_hash).toBeNull();
  });

  it("reuses the exact same QR credential on reprint", async () => {
    const { eventA, adminA } = await world();
    const participant = await createParticipant(eventA, { fullName: "Siti" });

    const first = await callApi(labelsPath(eventA), {
      method: "POST",
      cookie: adminA.cookie,
      body: {},
    });
    const firstBody = first.json<QrLabelPayload>();
    if (!firstBody.ok) throw new Error("expected success");

    const stored = await credentialOf(participant.id);

    const second = await callApi(labelsPath(eventA), {
      method: "POST",
      cookie: adminA.cookie,
      body: {},
    });
    const secondBody = second.json<QrLabelPayload>();
    if (!secondBody.ok) throw new Error("expected success");

    expect(secondBody.data.labels[0]?.qr).toBe(firstBody.data.labels[0]?.qr);
    expect(await credentialOf(participant.id)).toEqual(stored);

    const rows = await audits(eventA);
    const metadata = rows.map((row) => JSON.parse(row.after_json) as Record<string, number>);
    expect(metadata.some((row) => row.issued === 1 && row.reused === 0)).toBe(true);
    expect(metadata.some((row) => row.issued === 0 && row.reused === 1)).toBe(true);
  });

  it("requires the CSRF header and a matching Origin", async () => {
    const { eventA, adminA } = await world();
    await createParticipant(eventA, { fullName: "Siti" });

    const noHeader = await callApi(labelsPath(eventA), {
      method: "POST",
      cookie: adminA.cookie,
      body: {},
      csrf: false,
    });
    expect(noHeader.status).toBe(403);
    expect(errorCode(noHeader)).toBe("CSRF_FAILED");

    const wrongOrigin = await callApi(labelsPath(eventA), {
      method: "POST",
      cookie: adminA.cookie,
      body: {},
      origin: "https://evil.test",
    });
    expect(wrongOrigin.status).toBe(403);
    expect(errorCode(wrongOrigin)).toBe("CSRF_FAILED");
  });

  it("paginates active participants without missing or duplicating anyone", async () => {
    const { eventA, adminA } = await world();

    const expected = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const participant = await createParticipant(eventA, { fullName: `Peserta ${i}` });
      expected.add(participant.id);
    }

    const seen: string[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < 10; page += 1) {
      const response = await callApi(labelsPath(eventA), {
        method: "POST",
        cookie: adminA.cookie,
        body: { limit: 2, ...(cursor ? { cursor } : {}) },
      });
      expect(response.status).toBe(200);

      const payload = response.json<QrLabelPayload>();
      if (!payload.ok) throw new Error("expected success");

      seen.push(...payload.data.labels.map((label) => label.participantId));
      cursor = payload.data.nextCursor;
      if (cursor === null) break;
    }

    expect(seen).toHaveLength(expected.size);
    expect(new Set(seen)).toEqual(expected);
    expect(cursor).toBeNull();
  });

  it("rejects invalid cursors and a page larger than the batch limit", async () => {
    const { eventA, adminA } = await world();

    const badCursor = await callApi(labelsPath(eventA), {
      method: "POST",
      cookie: adminA.cookie,
      body: { cursor: "not-a-cursor" },
    });
    expect(badCursor.status).toBe(400);
    expect(errorCode(badCursor)).toBe("VALIDATION_ERROR");

    const tooMany = await callApi(labelsPath(eventA), {
      method: "POST",
      cookie: adminA.cookie,
      body: { limit: 51 },
    });
    expect(tooMany.status).toBe(400);

    const tooManyIds = await callApi(labelsPath(eventA), {
      method: "POST",
      cookie: adminA.cookie,
      body: { participantIds: Array.from({ length: 51 }, (_, i) => `p-${i}`) },
    });
    expect(tooManyIds.status).toBe(400);
  });

  it("records an audit row without tokens, hashes, or ciphertext", async () => {
    const { eventA, adminA } = await world();
    const participant = await createParticipant(eventA, { fullName: "Siti" });

    const response = await callApi(labelsPath(eventA), {
      method: "POST",
      cookie: adminA.cookie,
      body: { format: "sticker" },
    });
    expect(response.status).toBe(200);

    const payload = response.json<QrLabelPayload>();
    if (!payload.ok) throw new Error("expected success");

    const token = parseQrPayload(payload.data.labels[0]?.qr ?? "");
    const stored = await credentialOf(participant.id);
    const rows = await audits(eventA);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_user_id: adminA.id,
      action: "qr.labels_exported",
      entity_type: "event",
      entity_id: eventA,
    });

    const serialised = JSON.stringify(rows[0]);
    expect(serialised).not.toContain(token as string);
    expect(serialised).not.toContain(stored?.qr_token_hash as string);
    expect(serialised).not.toContain(stored?.qr_token_ciphertext as string);

    const metadata = JSON.parse(rows[0]?.after_json ?? "{}") as Record<string, unknown>;
    expect(metadata.count).toBe(1);
    expect(metadata.format).toBe("sticker");
    expect(metadata.selection).toBe("all");
  });
});

describe("label configuration", () => {
  it("returns the sensible default before anything is saved", async () => {
    const { eventA, adminA } = await world();

    const response = await callApi(configPath(eventA), { cookie: adminA.cookie });
    expect(response.status).toBe(200);

    const payload = response.json<LabelConfigPayload>();
    if (!payload.ok) throw new Error("expected success");
    expect(payload.data).toEqual({
      fields: ["fullName", "externalRef", "category"],
      showEventName: true,
    });
  });

  it("saves an event-specific field order and applies it to the next print", async () => {
    const { eventA, adminA } = await world();
    await createParticipant(eventA, {
      fullName: "Siti",
      externalRef: "A-1",
      category: "Kelas 7",
    });

    const saved = await callApi(configPath(eventA), {
      method: "PUT",
      cookie: adminA.cookie,
      body: { fields: ["category", "fullName"], showEventName: false },
    });
    expect(saved.status).toBe(200);

    const payload = saved.json<LabelConfigPayload>();
    if (!payload.ok) throw new Error("expected success");
    expect(payload.data).toEqual({ fields: ["category", "fullName"], showEventName: false });

    const printed = await callApi(labelsPath(eventA), {
      method: "POST",
      cookie: adminA.cookie,
      body: {},
    });
    const printedBody = printed.json<QrLabelPayload>();
    if (!printedBody.ok) throw new Error("expected success");

    expect(printedBody.data.fields).toEqual(["category", "fullName"]);
    expect(printedBody.data.showEventName).toBe(false);
    expect(printedBody.data.labels[0]?.values).toEqual({
      category: "Kelas 7",
      fullName: "Siti",
    });
  });

  it("hides empty values instead of printing blank lines", async () => {
    const { eventA, adminA } = await world();
    await createParticipant(eventA, { fullName: "Siti" });

    const response = await callApi(labelsPath(eventA), {
      method: "POST",
      cookie: adminA.cookie,
      body: {},
    });
    const payload = response.json<QrLabelPayload>();
    if (!payload.ok) throw new Error("expected success");

    expect(payload.data.labels[0]?.values).toEqual({ fullName: "Siti" });
  });

  it("rejects unsupported fields, duplicates, and more than four fields", async () => {
    const { eventA, adminA } = await world();

    for (const fields of [
      ["password"],
      ["fullName", "fullName"],
      ["fullName", "externalRef", "category", "phone", "email"],
      [],
    ]) {
      const response = await callApi(configPath(eventA), {
        method: "PUT",
        cookie: adminA.cookie,
        body: { fields },
      });
      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe("VALIDATION_ERROR");
    }
  });

  it("is writable by event admins only and is frozen for archived events", async () => {
    const { eventA, officerA, adminA } = await world();

    const officerRead = await callApi(configPath(eventA), { cookie: officerA.cookie });
    expect(officerRead.status).toBe(200);

    const officerWrite = await callApi(configPath(eventA), {
      method: "PUT",
      cookie: officerA.cookie,
      body: { fields: ["fullName"] },
    });
    expect(officerWrite.status).toBe(403);

    await testEnv.DB.prepare("UPDATE events SET status = 'archived' WHERE id = ?")
      .bind(eventA)
      .run();

    const archivedWrite = await callApi(configPath(eventA), {
      method: "PUT",
      cookie: adminA.cookie,
      body: { fields: ["fullName"] },
    });
    expect(archivedWrite.status).toBe(422);
    expect(errorCode(archivedWrite)).toBe("BUSINESS_RULE");
  });
});
