import type {
  QrIdentityMetadataPayload,
  QrLabelPayload,
  QrRotatePayload,
  ScanResultPayload,
} from "@absensi/shared";
import { describe, expect, it } from "vitest";

import { testEnv } from "./env";
import {
  addMembership,
  createEvent,
  createParticipant,
  createSession,
  createUser,
  seedLegacyParticipantQr,
} from "./fixtures";
import { TEST_NOW, callApi, errorCode } from "./http";

/**
 * T-Q4 API behaviour (ADR-0017, AC-015–AC-018):
 * rotation authority, mandatory reason, old-token invalidation, unchanged
 * history, audit without credentials, and metadata that never returns a token.
 */

interface World {
  eventA: string;
  eventB: string;
  adminA: { id: string; cookie: string };
  officerA: { id: string; cookie: string };
  adminB: { id: string; cookie: string };
  superadmin: { id: string; cookie: string };
}

const labelsPath = (eventId: string) => `/api/events/${eventId}/participants/qr-labels`;
const rotatePath = (eventId: string, participantId: string) =>
  `/api/events/${eventId}/participants/${participantId}/qr/rotate`;
const metadataPath = (eventId: string, participantId: string) =>
  `/api/events/${eventId}/participants/${participantId}/qr`;

async function setEvent(eventId: string, status: string): Promise<void> {
  await testEnv.DB.prepare("UPDATE events SET status = ? WHERE id = ?")
    .bind(status, eventId)
    .run();
}

async function world(): Promise<World> {
  const superadminId = await createUser({ role: "superadmin" });
  const eventA = await createEvent({ createdBy: superadminId, name: "Acara A" });
  const eventB = await createEvent({ createdBy: superadminId, name: "Acara B" });
  await setEvent(eventA, "active");
  await setEvent(eventB, "active");

  const adminAId = await createUser({ role: "event_admin", displayName: "Admin A" });
  await addMembership(eventA, adminAId, "event_admin");

  const officerAId = await createUser({ role: "officer", displayName: "Petugas A" });
  await addMembership(eventA, officerAId, "officer");

  const adminBId = await createUser({ role: "event_admin", displayName: "Admin B" });
  await addMembership(eventB, adminBId, "event_admin");

  const [adminA, officerA, adminB, superadmin] = await Promise.all([
    createSession(adminAId),
    createSession(officerAId),
    createSession(adminBId),
    createSession(superadminId),
  ]);

  return {
    eventA,
    eventB,
    adminA: { id: adminAId, cookie: adminA.cookie },
    officerA: { id: officerAId, cookie: officerA.cookie },
    adminB: { id: adminBId, cookie: adminB.cookie },
    superadmin: { id: superadminId, cookie: superadmin.cookie },
  };
}

async function print(
  eventId: string,
  cookie: string,
  participantId: string,
): Promise<QrLabelPayload> {
  const response = await callApi(labelsPath(eventId), {
    method: "POST",
    cookie,
    body: { participantIds: [participantId] },
  });
  expect(response.status).toBe(200);

  const payload = response.json<QrLabelPayload>();
  if (!payload.ok) throw new Error("expected success");
  return payload.data;
}

function rotate(
  eventId: string,
  participantId: string,
  cookie: string,
  body: unknown = { reason: "Kartu peserta hilang" },
) {
  return callApi(rotatePath(eventId, participantId), { method: "PUT", cookie, body });
}

function scan(cookie: string, eventId: string, qr: string) {
  return callApi(`/api/events/${eventId}/scan`, {
    method: "POST",
    cookie,
    body: { qr },
  });
}

async function attendanceCount(eventId: string): Promise<number> {
  const row = await testEnv.DB.prepare(
    "SELECT COUNT(*) AS n FROM attendance WHERE event_id = ?",
  )
    .bind(eventId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("PUT /participants/:participantId/qr/rotate", () => {
  it("enforces authentication, role, and Tema scope", async () => {
    const w = await world();
    const participant = await createParticipant(w.eventA, { fullName: "Siti" });
    await print(w.eventA, w.adminA.cookie, participant.id);

    const anonymous = await callApi(rotatePath(w.eventA, participant.id), {
      method: "PUT",
      body: { reason: "Kartu peserta hilang" },
    });
    expect(anonymous.status).toBe(401);
    expect(errorCode(anonymous)).toBe("UNAUTHENTICATED");

    const officer = await rotate(w.eventA, participant.id, w.officerA.cookie);
    expect(officer.status).toBe(403);
    expect(errorCode(officer)).toBe("FORBIDDEN");

    const foreign = await rotate(w.eventA, participant.id, w.adminB.cookie);
    expect(foreign.status).toBe(404);

    const admin = await rotate(w.eventA, participant.id, w.adminA.cookie);
    expect(admin.status).toBe(200);

    const superadmin = await rotate(w.eventA, participant.id, w.superadmin.cookie);
    expect(superadmin.status).toBe(200);
  });

  it("requires a meaningful reason and rejects unknown fields", async () => {
    const w = await world();
    const participant = await createParticipant(w.eventA, { fullName: "Siti" });
    await print(w.eventA, w.adminA.cookie, participant.id);

    for (const body of [{}, { reason: "" }, { reason: "   " }, { reason: "ab" }]) {
      const response = await rotate(w.eventA, participant.id, w.adminA.cookie, body);
      expect(response.status).toBe(400);
      expect(errorCode(response)).toBe("VALIDATION_ERROR");
    }

    const unknown = await rotate(w.eventA, participant.id, w.adminA.cookie, {
      reason: "Kartu peserta hilang",
      token: "x",
    });
    expect(unknown.status).toBe(400);
  });

  it("returns 404 when no credential has ever been issued", async () => {
    const w = await world();
    const participant = await createParticipant(w.eventA, { fullName: "Belum Dicetak" });

    const response = await rotate(w.eventA, participant.id, w.adminA.cookie);
    expect(response.status).toBe(404);
    expect(errorCode(response)).toBe("NOT_FOUND");

    const row = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM qr_identities WHERE participant_id = ?",
    )
      .bind(participant.id)
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("invalidates the old token, issues a new one, and keeps history intact", async () => {
    const w = await world();
    const participant = await createParticipant(w.eventA, { fullName: "Siti" });
    const before = await print(w.eventA, w.adminA.cookie, participant.id);
    const oldQr = before.labels[0]?.qr as string;

    const firstScan = await scan(w.officerA.cookie, w.eventA, oldQr);
    expect(firstScan.json<ScanResultPayload>().ok && firstScan.status).toBe(200);
    expect(await attendanceCount(w.eventA)).toBe(1);

    const response = await rotate(w.eventA, participant.id, w.adminA.cookie);
    expect(response.status).toBe(200);

    const body = response.json<QrRotatePayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data.participantId).toBe(participant.id);
    expect(body.data.rotationCount).toBe(1);
    expect(body.data.rotatedAt).toBe(TEST_NOW);
    expect(body.data.qr.startsWith("absensi:v1:")).toBe(true);
    expect(body.data.qr).not.toBe(oldQr);

    // History is untouched: same attendance count and row.
    expect(await attendanceCount(w.eventA)).toBe(1);

    const oldToken = await scan(w.officerA.cookie, w.eventA, oldQr);
    const oldBody = oldToken.json<ScanResultPayload>();
    expect(oldBody.ok && oldBody.data.result).toBe("not_found");

    const newToken = await scan(w.officerA.cookie, w.eventA, body.data.qr);
    const newBody = newToken.json<ScanResultPayload>();
    expect(newBody.ok && newBody.data.result).toBe("duplicate");
  });

  it("writes an audit row with the reason but no credential material", async () => {
    const w = await world();
    const participant = await createParticipant(w.eventA, { fullName: "Siti" });
    const printed = await print(w.eventA, w.adminA.cookie, participant.id);
    const oldQr = printed.labels[0]?.qr as string;

    const response = await rotate(w.eventA, participant.id, w.adminA.cookie, {
      reason: "  Kartu rusak  ",
    });
    expect(response.status).toBe(200);

    const body = response.json<QrRotatePayload>();
    if (!body.ok) throw new Error("expected success");

    const row = await testEnv.DB.prepare(
      `SELECT actor_user_id, action, entity_type, entity_id, before_json, after_json, reason
         FROM audit_log WHERE event_id = ? AND action = 'qr.identity_rotated'`,
    )
      .bind(w.eventA)
      .first<{
        actor_user_id: string;
        action: string;
        entity_type: string;
        entity_id: string;
        before_json: string | null;
        after_json: string;
        reason: string;
      }>();

    expect(row?.actor_user_id).toBe(w.adminA.id);
    expect(row?.entity_type).toBe("qr_identity");
    expect(row?.reason).toBe("Kartu rusak");
    expect(row?.before_json).toBeNull();

    const snapshot = JSON.parse(row?.after_json ?? "{}") as Record<string, unknown>;
    expect(snapshot).toMatchObject({
      themeId: w.eventA,
      participantId: participant.id,
      keyVersion: 1,
      rotationCount: 1,
    });

    const serialised = JSON.stringify(row);
    const token = oldQr.slice("absensi:v1:".length);
    expect(serialised).not.toContain(token);
    expect(serialised).not.toContain(body.data.qr);
  });

  it("promotes a legacy credential and rotates it in one step", async () => {
    const w = await world();
    const participant = await createParticipant(w.eventA, { fullName: "Siti" });
    const legacyQr = await seedLegacyParticipantQr(w.eventA, participant.id);

    const response = await rotate(w.eventA, participant.id, w.adminA.cookie);
    expect(response.status).toBe(200);

    const body = response.json<QrRotatePayload>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data.qr).not.toBe(legacyQr);

    const old = await scan(w.officerA.cookie, w.eventA, legacyQr);
    expect(old.json<ScanResultPayload>().ok && old.status).toBe(200);
    expect((old.json<ScanResultPayload>() as { data: ScanResultPayload }).data.result).toBe(
      "not_found",
    );
  });

  it("serialises concurrent rotations so exactly one wins", async () => {
    const w = await world();
    const participant = await createParticipant(w.eventA, { fullName: "Siti" });
    await print(w.eventA, w.adminA.cookie, participant.id);

    const responses = await Promise.all([
      rotate(w.eventA, participant.id, w.adminA.cookie),
      rotate(w.eventA, participant.id, w.superadmin.cookie),
    ]);

    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409]);

    const identity = await testEnv.DB.prepare(
      "SELECT rotation_count FROM qr_identities WHERE participant_id = ?",
    )
      .bind(participant.id)
      .first<{ rotation_count: number }>();
    expect(identity?.rotation_count).toBe(1);

    const audits = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE event_id = ? AND action = 'qr.identity_rotated'",
    )
      .bind(w.eventA)
      .first<{ n: number }>();
    expect(audits?.n).toBe(1);
  });

  it("refuses to mutate an archived Tema", async () => {
    const w = await world();
    const participant = await createParticipant(w.eventA, { fullName: "Siti" });
    await print(w.eventA, w.adminA.cookie, participant.id);
    await setEvent(w.eventA, "archived");

    const response = await rotate(w.eventA, participant.id, w.adminA.cookie);
    expect(response.status).toBe(422);
    expect(errorCode(response)).toBe("BUSINESS_RULE");
  });
});

describe("QR scan scope", () => {
  it("rejects a token from another Tema without writing attendance", async () => {
    const w = await world();
    const participant = await createParticipant(w.eventA, { fullName: "Siti" });
    const printed = await print(w.eventA, w.adminA.cookie, participant.id);
    const qr = printed.labels[0]?.qr as string;

    const response = await scan(w.adminB.cookie, w.eventB, qr);
    const body = response.json<ScanResultPayload>();
    expect(body.ok && body.data.result).toBe("wrong_event");
    expect(await attendanceCount(w.eventB)).toBe(0);

    const audit = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE event_id = ? AND action = 'attendance.wrong_event'",
    )
      .bind(w.eventB)
      .first<{ n: number }>();
    expect(audit?.n).toBe(1);
  });
});

describe("GET /participants/:participantId/qr", () => {
  it("returns metadata before and after issuance, never the token", async () => {
    const w = await world();
    const participant = await createParticipant(w.eventA, { fullName: "Siti" });

    const before = await callApi(metadataPath(w.eventA, participant.id), {
      cookie: w.adminA.cookie,
    });
    const beforeBody = before.json<QrIdentityMetadataPayload>();
    expect(before.status).toBe(200);
    expect(beforeBody.ok && beforeBody.data.identity).toBeNull();

    const printed = await print(w.eventA, w.adminA.cookie, participant.id);
    const token = (printed.labels[0]?.qr as string).slice("absensi:v1:".length);

    const after = await callApi(metadataPath(w.eventA, participant.id), {
      cookie: w.adminA.cookie,
    });
    const afterBody = after.json<QrIdentityMetadataPayload>();
    if (!afterBody.ok || !afterBody.data.identity) throw new Error("expected identity");

    expect(afterBody.data.identity).toMatchObject({
      participantId: participant.id,
      rotationCount: 0,
      rotatedAt: null,
      keyVersion: 1,
    });
    expect(JSON.stringify(afterBody.data)).not.toContain(token);
  });

  it("is scoped by Tema and by the print permission", async () => {
    const w = await world();
    const participant = await createParticipant(w.eventA, { fullName: "Siti" });

    const anonymous = await callApi(metadataPath(w.eventA, participant.id));
    expect(anonymous.status).toBe(401);

    const officer = await callApi(metadataPath(w.eventA, participant.id), {
      cookie: w.officerA.cookie,
    });
    expect(officer.status).toBe(403);

    const foreign = await callApi(metadataPath(w.eventA, participant.id), {
      cookie: w.adminB.cookie,
    });
    expect(foreign.status).toBe(404);
  });
});
