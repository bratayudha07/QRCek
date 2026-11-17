import type {
  ApiResponse,
  ConsumptionCategoryQuotaRulesPayload,
  ConsumptionQuotaDefaultPayload,
  ConsumptionQuotaPayload,
  ScanResultPayload,
  TransactionDetailPayload,
} from "@absensi/shared";
import { describe, expect, it } from "vitest";

import { testEnv } from "../test/env";
import {
  addMembership,
  addStaffAssignment,
  allowThemeDefault,
  createActivity,
  createActivitySession,
  createCategory,
  createEvent,
  createParticipant,
  createSession,
  createUser,
  issueParticipantQr,
} from "../test/fixtures";
import { TEST_NOW, callApi } from "../test/http";

/**
 * Consumption quota routes and the Consumption branches of scan/Manual Entry
 * (DESAIN_API.md §6–§7, Q7).
 *
 * Everything goes through the real router, CSRF, session lookup, D1 batch, and
 * triggers. The clock is fixed so slot numbers and "Sudah diambil" are
 * reproducible.
 */

/** Narrows the JSON envelope so assertions read the success payload directly. */
function payload<T>(body: ApiResponse<T>): T {
  if (!body.ok) {
    throw new Error(`expected a success response, got ${body.error.code}`);
  }

  return body.data;
}

async function setEvent(
  eventId: string,
  input: { status?: string; allowManual?: number } = {},
): Promise<void> {
  await testEnv.DB.prepare(
    "UPDATE events SET status = ?, allow_manual = ? WHERE id = ?",
  )
    .bind(input.status ?? "active", input.allowManual ?? 1, eventId)
    .run();
}

interface Scenario {
  adminId: string;
  adminCookie: string;
  officerId: string;
  officerCookie: string;
  eventId: string;
  activityId: string;
  attendanceActivityId: string;
  categoryId: string;
  participantId: string;
  qr: string;
  sessionId: string | null;
}

async function scenario(
  options: {
    quota?: number;
    officerAssigned?: boolean;
    officerCanManual?: boolean;
    officerMembership?: boolean;
  } = {},
): Promise<Scenario> {
  const adminId = await createUser({ role: "event_admin", displayName: "Admin Konsumsi" });
  const eventId = await createEvent({ createdBy: adminId, name: "Acara Konsumsi" });
  await setEvent(eventId);
  await addMembership(eventId, adminId, "event_admin");

  const activityId = await createActivity(eventId, {
    name: "Makan Siang",
    transactionType: "consumption",
    quota: options.quota ?? 1,
  });
  const attendanceActivityId = await createActivity(eventId, {
    name: "Absensi",
    transactionType: "attendance",
  });
  await allowThemeDefault(eventId);

  const adminCookie = (await createSession(adminId)).cookie;

  const officerId = await createUser({ role: "officer", displayName: "Petugas Konsumsi" });
  if (options.officerMembership !== false) {
    await addMembership(eventId, officerId, "officer");
  }
  if (options.officerAssigned !== false) {
    await addStaffAssignment(eventId, activityId, officerId, {
      canManualCheckIn: options.officerCanManual !== false,
    });
  }
  const officerCookie = (await createSession(officerId)).cookie;

  const category = await createCategory(eventId, { name: "Kelas Konsumsi" });
  const participant = await createParticipant(eventId, {
    categoryId: category.id,
    fullName: "Siti Peserta",
  });
  const qr = await issueParticipantQr(eventId, participant.id);

  const sessionRow = await testEnv.DB.prepare(
    "SELECT id FROM activity_sessions WHERE activity_id = ? ORDER BY created_at LIMIT 1",
  )
    .bind(activityId)
    .first<{ id: string }>();

  return {
    adminId,
    adminCookie,
    officerId,
    officerCookie,
    eventId,
    activityId,
    attendanceActivityId,
    categoryId: category.id,
    participantId: participant.id,
    qr,
    sessionId: sessionRow?.id ?? null,
  };
}

function quotaUrl(eventId: string, activityId: string, suffix = ""): string {
  return `/api/events/${eventId}/activities/${activityId}/quota${suffix}`;
}

function scan(s: Scenario, cookie: string) {
  return callApi(`/api/events/${s.eventId}/scan`, {
    method: "POST",
    body: {
      qr: s.qr,
      activityId: s.activityId,
      ...(s.sessionId ? { sessionId: s.sessionId } : {}),
    },
    cookie,
  });
}

async function transactionRows(eventId: string) {
  const { results } = await testEnv.DB.prepare(
    `SELECT id, type, source, status, slot_no, note, reversed_at, superseded_at
       FROM transactions
      WHERE theme_id = ? ORDER BY created_at, id`,
  )
    .bind(eventId)
    .all<{
      id: string;
      type: string;
      source: string;
      status: string | null;
      slot_no: number | null;
      note: string | null;
      reversed_at: number | null;
      superseded_at: number | null;
    }>();
  return results;
}

async function auditRows(eventId: string) {
  const { results } = await testEnv.DB.prepare(
    `SELECT action, entity_type, entity_id, before_json, after_json
       FROM audit_log WHERE event_id = ? ORDER BY created_at, id`,
  )
    .bind(eventId)
    .all<{
      action: string;
      entity_type: string;
      entity_id: string | null;
      before_json: string | null;
      after_json: string | null;
    }>();
  return results;
}

describe("GET/PUT activity quota", () => {
  it("returns the default, overrides, and effective usage", async () => {
    const s = await scenario({ quota: 2 });

    const empty = await callApi(quotaUrl(s.eventId, s.activityId), {
      cookie: s.adminCookie,
    });
    expect(empty.status).toBe(200);
    const emptyBody = empty.json<ConsumptionQuotaPayload>();
    expect(payload(emptyBody).defaultQuota).toBe(2);
    expect(payload(emptyBody).categoryOverrides).toEqual([]);
    expect(payload(emptyBody).usage).toEqual([]);

    const putCategory = await callApi(quotaUrl(s.eventId, s.activityId, "/categories"), {
      method: "PUT",
      body: { rules: [{ categoryId: s.categoryId, quota: 3 }] },
      cookie: s.adminCookie,
    });
    expect(putCategory.status).toBe(200);

    const putParticipant = await callApi(
      quotaUrl(s.eventId, s.activityId, "/participants"),
      {
        method: "PUT",
        body: { rules: [{ participantId: s.participantId, quota: 4 }] },
        cookie: s.adminCookie,
      },
    );
    expect(putParticipant.status).toBe(200);

    const scanned = await scan(s, s.adminCookie);
    expect(scanned.status).toBe(200);

    const filled = await callApi(quotaUrl(s.eventId, s.activityId), {
      cookie: s.adminCookie,
    });
    const filledBody = filled.json<ConsumptionQuotaPayload>();
    expect(payload(filledBody).categoryOverrides).toEqual([
      { categoryId: s.categoryId, quota: 3 },
    ]);
    expect(payload(filledBody).participantOverrides).toEqual([
      { participantId: s.participantId, quota: 4 },
    ]);
    expect(payload(filledBody).usage).toEqual([
      { participantId: s.participantId, used: 1 },
    ]);
  });

  it("rejects an attendance Aktivitas with a business rule", async () => {
    const s = await scenario();

    const response = await callApi(quotaUrl(s.eventId, s.attendanceActivityId), {
      cookie: s.adminCookie,
    });

    expect(response.status).toBe(422);
    expect(response.body.ok).toBe(false);
    if (!response.body.ok) expect(response.body.error.code).toBe("BUSINESS_RULE");
  });

  it("updates the default quota and audits before/after without PII", async () => {
    const s = await scenario({ quota: 1 });

    const response = await callApi(quotaUrl(s.eventId, s.activityId), {
      method: "PUT",
      body: { quota: 3 },
      cookie: s.adminCookie,
    });

    expect(response.status).toBe(200);
    const body = response.json<ConsumptionQuotaDefaultPayload>();
    expect(payload(body)).toEqual({ activityId: s.activityId, quota: 3 });

    const activity = await testEnv.DB.prepare(
      "SELECT quota FROM activities WHERE id = ?",
    )
      .bind(s.activityId)
      .first<{ quota: number }>();
    expect(activity?.quota).toBe(3);

    const audit = (await auditRows(s.eventId)).find(
      (row) => row.action === "activity.quota_updated",
    );
    expect(audit?.entity_type).toBe("activity");
    expect(JSON.parse(audit?.before_json as string)).toEqual({ quota: 1 });
    expect(JSON.parse(audit?.after_json as string)).toEqual({ quota: 3 });
    expect(audit?.after_json).not.toContain("Siti Peserta");
  });

  it("rejects a negative quota and an archived event", async () => {
    const s = await scenario();

    const negative = await callApi(quotaUrl(s.eventId, s.activityId), {
      method: "PUT",
      body: { quota: -1 },
      cookie: s.adminCookie,
    });
    expect(negative.status).toBe(400);

    await setEvent(s.eventId, { status: "archived" });
    const archived = await callApi(quotaUrl(s.eventId, s.activityId), {
      method: "PUT",
      body: { quota: 2 },
      cookie: s.adminCookie,
    });
    expect(archived.status).toBe(422);
  });

  it("makes an archived Aktivitas read-only", async () => {
    const s = await scenario();
    await testEnv.DB.prepare(
      "UPDATE activities SET status = 'archived', archived_at = ? WHERE id = ?",
    )
      .bind(TEST_NOW, s.activityId)
      .run();

    const response = await callApi(quotaUrl(s.eventId, s.activityId), {
      method: "PUT",
      body: { quota: 2 },
      cookie: s.adminCookie,
    });

    expect(response.status).toBe(422);
  });

  it("denies quota writes to a Petugas but allows the read", async () => {
    const s = await scenario();

    const read = await callApi(quotaUrl(s.eventId, s.activityId), {
      cookie: s.officerCookie,
    });
    expect(read.status).toBe(200);

    const write = await callApi(quotaUrl(s.eventId, s.activityId), {
      method: "PUT",
      body: { quota: 5 },
      cookie: s.officerCookie,
    });
    expect(write.status).toBe(403);
    expect(write.body.ok).toBe(false);
    if (!write.body.ok) expect(write.body.error.code).toBe("FORBIDDEN");
  });
});

describe("bulk quota overrides", () => {
  it("creates, updates, and removes category overrides with audit rows", async () => {
    const s = await scenario();
    const first = await createCategory(s.eventId, { name: "Kelas A" });
    const second = await createCategory(s.eventId, { name: "Kelas B" });

    const created = await callApi(quotaUrl(s.eventId, s.activityId, "/categories"), {
      method: "PUT",
      body: {
        rules: [
          { categoryId: first.id, quota: 2 },
          { categoryId: second.id, quota: 3 },
        ],
      },
      cookie: s.adminCookie,
    });
    expect(created.status).toBe(200);
    const createdBody = created.json<ConsumptionCategoryQuotaRulesPayload>();
    expect(payload(createdBody).rules).toEqual([
      { categoryId: first.id, quota: 2 },
      { categoryId: second.id, quota: 3 },
    ]);

    const updated = await callApi(quotaUrl(s.eventId, s.activityId, "/categories"), {
      method: "PUT",
      body: { rules: [{ categoryId: first.id, quota: 5 }, { categoryId: second.id, quota: null }] },
      cookie: s.adminCookie,
    });
    expect(updated.status).toBe(200);

    const { results } = await testEnv.DB.prepare(
      `SELECT category_id, quota FROM consumption_quotas
        WHERE activity_id = ? ORDER BY category_id`,
    )
      .bind(s.activityId)
      .all<{ category_id: string; quota: number }>();
    expect(results).toEqual([{ category_id: first.id, quota: 5 }]);

    const actions = (await auditRows(s.eventId))
      .filter((row) => row.entity_type === "consumption_quota")
      .map((row) => row.action);
    expect(actions).toContain("consumption_quota.created");
    expect(actions).toContain("consumption_quota.updated");
    expect(actions).toContain("consumption_quota.deleted");
  });

  it("creates, updates, and removes participant overrides", async () => {
    const s = await scenario();
    const other = await createParticipant(s.eventId, { fullName: "Peserta Lain" });

    const created = await callApi(
      quotaUrl(s.eventId, s.activityId, "/participants"),
      {
        method: "PUT",
        body: {
          rules: [
            { participantId: s.participantId, quota: 2 },
            { participantId: other.id, quota: 0 },
          ],
        },
        cookie: s.adminCookie,
      },
    );
    expect(created.status).toBe(200);

    const updated = await callApi(
      quotaUrl(s.eventId, s.activityId, "/participants"),
      {
        method: "PUT",
        body: {
          rules: [
            { participantId: s.participantId, quota: null },
            { participantId: other.id, quota: 1 },
          ],
        },
        cookie: s.adminCookie,
      },
    );
    expect(updated.status).toBe(200);

    const { results } = await testEnv.DB.prepare(
      `SELECT participant_id, quota FROM consumption_quotas
        WHERE activity_id = ? AND participant_id IS NOT NULL`,
    )
      .bind(s.activityId)
      .all<{ participant_id: string; quota: number }>();
    expect(results).toEqual([{ participant_id: other.id, quota: 1 }]);
  });

  it("rejects unknown and cross-Tema subjects, and more than 15 rules", async () => {
    const s = await scenario();
    const otherEventAdmin = await createUser({ role: "event_admin" });
    const otherEvent = await createEvent({ createdBy: otherEventAdmin });
    const foreignCategory = await createCategory(otherEvent, { name: "Lain" });

    const foreign = await callApi(quotaUrl(s.eventId, s.activityId, "/categories"), {
      method: "PUT",
      body: { rules: [{ categoryId: foreignCategory.id, quota: 2 }] },
      cookie: s.adminCookie,
    });
    expect(foreign.status).toBe(404);

    const foreignParticipant = await createParticipant(otherEvent, {
      fullName: "Peserta Tema Lain",
    });
    const foreignP = await callApi(
      quotaUrl(s.eventId, s.activityId, "/participants"),
      {
        method: "PUT",
        body: { rules: [{ participantId: foreignParticipant.id, quota: 2 }] },
        cookie: s.adminCookie,
      },
    );
    expect(foreignP.status).toBe(404);

    const tooMany = await callApi(quotaUrl(s.eventId, s.activityId, "/categories"), {
      method: "PUT",
      body: {
        rules: Array.from({ length: 16 }, (_, index) => ({
          categoryId: `cat_${String(index).padStart(12, "0")}`,
          quota: 1,
        })),
      },
      cookie: s.adminCookie,
    });
    expect(tooMany.status).toBe(400);
  });

  it("rejects an attendance Aktivitas for both bulk endpoints", async () => {
    const s = await scenario();

    const categories = await callApi(
      quotaUrl(s.eventId, s.attendanceActivityId, "/categories"),
      {
        method: "PUT",
        body: { rules: [{ categoryId: s.categoryId, quota: 1 }] },
        cookie: s.adminCookie,
      },
    );
    expect(categories.status).toBe(422);

    const participants = await callApi(
      quotaUrl(s.eventId, s.attendanceActivityId, "/participants"),
      {
        method: "PUT",
        body: { rules: [{ participantId: s.participantId, quota: 1 }] },
        cookie: s.adminCookie,
      },
    );
    expect(participants.status).toBe(422);
  });
});

describe("scan Consumption", () => {
  it("records a Consumption transaction with slot 1 and the Consumption copy", async () => {
    const s = await scenario({ quota: 1 });

    const response = await scan(s, s.adminCookie);

    expect(response.status).toBe(200);
    const body = response.json<ScanResultPayload>();
    expect(payload(body).result).toBe("SUCCESS");
    expect(payload(body).message).toBe("Konsumsi tercatat");
    expect(payload(body).transaction?.status).toBeNull();

    const rows = await transactionRows(s.eventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "consumption",
      source: "qr_scan",
      status: null,
      slot_no: 1,
    });

    const audit = (await auditRows(s.eventId)).find(
      (row) => row.action === "transaction.recorded",
    );
    expect(audit?.entity_type).toBe("transaction");
    expect(audit?.after_json).not.toContain(s.qr);
    expect(audit?.after_json).not.toContain("Siti Peserta");
    expect(audit?.after_json).toContain('"slotNo":1');
  });

  it("returns DUPLICATE/quota_exhausted with HTTP 200 and writes no second row", async () => {
    const s = await scenario({ quota: 1 });
    const first = await scan(s, s.adminCookie);
    const firstBody = first.json<ScanResultPayload>();

    const second = await scan(s, s.adminCookie);

    expect(second.status).toBe(200);
    const body = second.json<ScanResultPayload>();
    expect(payload(body).result).toBe("DUPLICATE");
    expect(payload(body).reason).toBe("quota_exhausted");
    expect(payload(body).message).toBe("Sudah diambil");
    expect(payload(body).transaction?.id).toBe(payload(firstBody).transaction?.id);
    expect(await transactionRows(s.eventId)).toHaveLength(1);
  });

  it("counts quota across Sesi (A1) and assigns the next slot", async () => {
    const s = await scenario({ quota: 2 });
    const firstSession = await createActivitySession(s.activityId, { name: "Sesi 1" });
    const secondSession = await createActivitySession(s.activityId, { name: "Sesi 2" });

    const scanIn = (sessionId: string) =>
      callApi(`/api/events/${s.eventId}/scan`, {
        method: "POST",
        body: { qr: s.qr, activityId: s.activityId, sessionId },
        cookie: s.adminCookie,
      });

    const first = await scanIn(firstSession);
    const second = await scanIn(secondSession);

    expect(first.status).toBe(200);
    expect(payload(first.json<ScanResultPayload>()).result).toBe("SUCCESS");
    expect(second.status).toBe(200);
    expect(payload(second.json<ScanResultPayload>()).result).toBe("SUCCESS");

    const rows = await transactionRows(s.eventId);
    expect(rows.map((row) => row.slot_no).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2]);

    // The Aktivitas quota is now used up, so a third Sesi is rejected.
    const thirdSession = await createActivitySession(s.activityId, { name: "Sesi 3" });
    const third = await scanIn(thirdSession);
    expect(payload(third.json<ScanResultPayload>()).reason).toBe("quota_exhausted");
  });

  it("reuses a slot freed by a partial Reversal instead of reporting a duplicate", async () => {
    const s = await scenario({ quota: 3 });

    const first = await scan(s, s.adminCookie);
    const second = await scan(s, s.adminCookie);
    const firstBody = payload(first.json<ScanResultPayload>());
    const secondBody = payload(second.json<ScanResultPayload>());

    expect(firstBody.transaction?.slotNo).toBe(1);
    expect(secondBody.transaction?.slotNo).toBe(2);

    const reversal = await callApi(
      `/api/events/${s.eventId}/transactions/${firstBody.transaction?.id}/reversal`,
      {
        method: "POST",
        body: { reason: "Porsi pertama batal" },
        cookie: s.adminCookie,
      },
    );
    expect(reversal.status).toBe(200);

    // Slot 1 is free again while slot 2 is still effective: the next exchange
    // must take slot 1, not collide with 2 and report a duplicate.
    const third = await scan(s, s.adminCookie);
    expect(third.status).toBe(200);
    const thirdBody = payload(third.json<ScanResultPayload>());
    expect(thirdBody.result).toBe("SUCCESS");
    expect(thirdBody.transaction?.slotNo).toBe(1);

    const effective = (await transactionRows(s.eventId)).filter(
      (row) => row.reversed_at === null && row.superseded_at === null,
    );
    expect(effective.map((row) => row.slot_no).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([
      1, 2,
    ]);
  });

  it("rejects a Petugas without an assignment to the Aktivitas", async () => {
    const s = await scenario({ officerAssigned: false });

    const response = await scan(s, s.officerCookie);

    expect(response.status).toBe(403);
    expect(await transactionRows(s.eventId)).toHaveLength(0);
  });
});

describe("Manual Entry Consumption (A5)", () => {
  function manual(s: Scenario, cookie: string, body: Record<string, unknown> = {}) {
    return callApi(`/api/events/${s.eventId}/consumption/manual`, {
      method: "POST",
      body: {
        participantId: s.participantId,
        activityId: s.activityId,
        ...(s.sessionId ? { sessionId: s.sessionId } : {}),
        ...body,
      },
      cookie,
    });
  }

  it("records a manual Consumption transaction for an assigned Petugas", async () => {
    const s = await scenario({ quota: 1, officerCanManual: true });

    const response = await manual(s, s.officerCookie, { note: "Kartu rusak" });

    expect(response.status).toBe(201);
    const body = response.json<TransactionDetailPayload>();
    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.transaction.type).toBe("consumption");
    expect(body.data.transaction.source).toBe("manual");
    expect(body.data.transaction.slotNo).toBe(1);
    expect(body.data.transaction.note).toBe("Kartu rusak");

    const audit = (await auditRows(s.eventId)).find(
      (row) => row.action === "transaction.manual",
    );
    expect(audit?.after_json).not.toContain("Kartu rusak");
    expect(audit?.after_json).not.toContain("Siti Peserta");
    expect(audit?.after_json).toContain('"noteChanged":true');
  });

  it("rejects a Petugas without the manual flag", async () => {
    const s = await scenario({ officerCanManual: false });

    const response = await manual(s, s.officerCookie);

    expect(response.status).toBe(403);
    expect(await transactionRows(s.eventId)).toHaveLength(0);
  });

  it("rejects a Petugas without an assignment", async () => {
    const s = await scenario({ officerAssigned: false });

    const response = await manual(s, s.officerCookie);

    expect(response.status).toBe(403);
    expect(await transactionRows(s.eventId)).toHaveLength(0);
  });

  it("rejects Super Admin explicitly (D-024/OQ-034)", async () => {
    const s = await scenario();
    const superId = await createUser({ role: "superadmin", displayName: "Super" });
    const superCookie = (await createSession(superId)).cookie;

    const response = await manual(s, superCookie);

    expect(response.status).toBe(403);
    expect(await transactionRows(s.eventId)).toHaveLength(0);
  });

  it("rejects an exhausted quota with BUSINESS_RULE", async () => {
    const s = await scenario({ quota: 1 });
    await scan(s, s.adminCookie);

    const response = await manual(s, s.adminCookie);

    expect(response.status).toBe(422);
    expect(response.body.ok).toBe(false);
    if (!response.body.ok) {
      expect(response.body.error.code).toBe("BUSINESS_RULE");
      expect(response.body.error.message).toBe("Sudah diambil");
      expect((response.body.error.details as { reason?: string }).reason).toBe(
        "quota_exhausted",
      );
    }
    expect(await transactionRows(s.eventId)).toHaveLength(1);
  });

  it("rejects a Consumption Aktivitas on the Attendance Manual Entry route and vice versa", async () => {
    const s = await scenario();

    const attendanceRoute = await callApi(
      `/api/events/${s.eventId}/attendance/manual`,
      {
        method: "POST",
        body: {
          participantId: s.participantId,
          activityId: s.activityId,
          status: "present",
        },
        cookie: s.adminCookie,
      },
    );
    expect(attendanceRoute.status).toBe(422);

    const consumptionRoute = await callApi(
      `/api/events/${s.eventId}/consumption/manual`,
      {
        method: "POST",
        body: {
          participantId: s.participantId,
          activityId: s.attendanceActivityId,
        },
        cookie: s.adminCookie,
      },
    );
    expect(consumptionRoute.status).toBe(422);

    expect(await transactionRows(s.eventId)).toHaveLength(0);
  });

  it("requires an explicit Aktivitas instead of guessing one", async () => {
    const s = await scenario();

    const response = await callApi(`/api/events/${s.eventId}/consumption/manual`, {
      method: "POST",
      body: { participantId: s.participantId },
      cookie: s.adminCookie,
    });

    expect(response.status).toBe(422);
    if (!response.body.ok) {
      expect((response.body.error.details as { reason?: string }).reason).toBe(
        "context_mismatch",
      );
    }
  });
});
