import type {
  AttendanceDetailPayload,
  AttendanceListPayload,
  AttendanceRecord,
  ScanResultPayload,
  TransactionDetailPayload,
  TransactionListPayload,
} from "@absensi/shared";
import { describe, expect, it } from "vitest";

import {
  addMembership,
  addStaffAssignment,
  allowThemeDefault,
  countRows,
  createActivity,
  createActivitySession,
  createEvent,
  createParticipant,
  createSession,
  createUser,
  issueParticipantQr,
} from "../test/fixtures";
import { testEnv } from "../test/env";
import { TEST_NOW, callApi } from "../test/http";

/**
 * Scan, Manual Entry, Reversal, and Adjustment (DESAIN_API.md §7, Q5).
 *
 * Every test goes through the real router, CSRF, session lookup, D1 batch, and
 * partial unique indexes. The clock is fixed, so "duplicate" and lifecycle
 * results are reproducible.
 */

async function setEvent(
  eventId: string,
  input: { status?: string; startsAt?: number | null; endsAt?: number | null; allowManual?: number } = {},
): Promise<void> {
  await testEnv.DB.prepare(
    "UPDATE events SET status = ?, starts_at = ?, ends_at = ?, allow_manual = ? WHERE id = ?",
  )
    .bind(
      input.status ?? "active",
      input.startsAt ?? null,
      input.endsAt ?? null,
      input.allowManual ?? 0,
      eventId,
    )
    .run();
}

interface Scenario {
  adminId: string;
  adminCookie: string;
  officerId: string;
  officerCookie: string;
  eventId: string;
  activityId: string;
  participantId: string;
  qr: string;
}

async function scenario(
  options: {
    role?: "officer" | "event_admin";
    status?: string;
    sessionId?: string;
  } = {},
): Promise<Scenario> {
  const adminId = await createUser({ role: "event_admin", displayName: "Admin Acara" });
  const eventId = await createEvent({ createdBy: adminId, name: "Acara Scan" });
  await setEvent(eventId, { status: options.status ?? "active" });
  await addMembership(eventId, adminId, "event_admin");

  const activityId = await createActivity(eventId);
  await allowThemeDefault(eventId);

  const adminCookie = (await createSession(adminId)).cookie;

  const officerId = await createUser({ role: "officer", displayName: "Petugas Scan" });
  await addMembership(eventId, officerId, "officer");
  await addStaffAssignment(eventId, activityId, officerId, {
    sessionId: options.sessionId ?? null,
  });
  const officerCookie = (await createSession(officerId)).cookie;

  const participant = await createParticipant(eventId, { fullName: "Budi Peserta" });
  const qr = await issueParticipantQr(eventId, participant.id);

  return {
    adminId,
    adminCookie,
    officerId,
    officerCookie,
    eventId,
    activityId,
    participantId: participant.id,
    qr,
  };
}

function scan(
  cookie: string,
  eventId: string,
  qr: string,
  context: { now?: number; activityId?: string; sessionId?: string } = {},
) {
  return callApi(`/api/events/${eventId}/scan`, {
    method: "POST",
    body: {
      qr,
      ...(context.activityId ? { activityId: context.activityId } : {}),
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    },
    cookie,
    now: context.now ?? TEST_NOW,
  });
}

async function transactionCount(eventId: string): Promise<number> {
  const row = await testEnv.DB.prepare(
    "SELECT COUNT(*) AS n FROM transactions WHERE theme_id = ?",
  )
    .bind(eventId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function effectiveTransactionId(eventId: string): Promise<string> {
  const row = await testEnv.DB.prepare(
    `SELECT id FROM transactions
      WHERE theme_id = ? AND reversed_at IS NULL AND superseded_at IS NULL`,
  )
    .bind(eventId)
    .first<{ id: string }>();
  return row?.id as string;
}

describe("POST /api/events/:eventId/scan", () => {
  it("records one transaction, outbox row, and audit row atomically", async () => {
    const s = await scenario();
    const response = await scan(s.officerCookie, s.eventId, s.qr);

    expect(response.status).toBe(200);
    const body = response.json<ScanResultPayload>();
    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.result).toBe("SUCCESS");
    expect(body.data.reason).toBeNull();
    expect(body.data.participant?.fullName).toBe("Budi Peserta");
    expect(body.data.transaction?.activityId).toBe(s.activityId);
    expect(body.data.transaction?.occurredAt).toBe(TEST_NOW);

    expect(await transactionCount(s.eventId)).toBe(1);
    // Q5 writes only the new table; the legacy table stays untouched.
    expect(await countRows("attendance")).toBe(0);

    const outbox = await testEnv.DB.prepare(
      "SELECT status, participant_id FROM outbox WHERE event_id = ?",
    )
      .bind(s.eventId)
      .first<{ status: string; participant_id: string }>();
    expect(outbox).toEqual({ status: "pending", participant_id: s.participantId });

    const audit = await testEnv.DB.prepare(
      "SELECT action, actor_user_id, entity_type FROM audit_log WHERE event_id = ?",
    )
      .bind(s.eventId)
      .first<{ action: string; actor_user_id: string; entity_type: string }>();
    expect(audit).toEqual({
      action: "transaction.recorded",
      actor_user_id: s.officerId,
      entity_type: "transaction",
    });
  });

  it("reports a second scan as DUPLICATE and keeps one effective row", async () => {
    const s = await scenario();
    await scan(s.officerCookie, s.eventId, s.qr);

    const second = await scan(s.officerCookie, s.eventId, s.qr);
    const body = second.json<ScanResultPayload>();

    expect(second.status).toBe(200);
    expect(body.ok && body.data.result).toBe("DUPLICATE");
    expect(body.ok && body.data.reason).toBe("duplicate");
    expect(body.ok && body.data.transaction?.occurredAt).toBe(TEST_NOW);
    expect(await transactionCount(s.eventId)).toBe(1);

    // A duplicate must not leave an extra audit row claiming a new record.
    const auditCount = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE event_id = ? AND action = 'transaction.recorded'",
    )
      .bind(s.eventId)
      .first<{ n: number }>();
    expect(auditCount?.n).toBe(1);
  });

  it("never creates more than one effective row under 50 concurrent scans", async () => {
    const s = await scenario();

    const responses = await Promise.all(
      Array.from({ length: 50 }, () => scan(s.officerCookie, s.eventId, s.qr)),
    );

    const results = responses.map((response) => {
      const body = response.json<ScanResultPayload>();
      return body.ok ? body.data.result : "error";
    });

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(results.filter((result) => result === "SUCCESS")).toHaveLength(1);
    expect(results.filter((result) => result === "DUPLICATE")).toHaveLength(49);
    expect(await transactionCount(s.eventId)).toBe(1);

    const effective = await testEnv.DB.prepare(
      `SELECT COUNT(*) AS n FROM transactions
        WHERE theme_id = ? AND reversed_at IS NULL AND superseded_at IS NULL`,
    )
      .bind(s.eventId)
      .first<{ n: number }>();
    expect(effective?.n).toBe(1);
  });

  it("rejects an unknown or malformed payload as INVALID_QR", async () => {
    const s = await scenario();

    for (const qr of [
      "absensi:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "https://example.com/not-a-qr",
      "absensi:v2:short",
    ]) {
      const response = await scan(s.officerCookie, s.eventId, qr);
      const body = response.json<ScanResultPayload>();

      expect(response.status).toBe(200);
      expect(body.ok && body.data.result).toBe("INVALID_QR");
      expect(body.ok && body.data.reason).toBe("qr_invalid");
    }

    expect(await transactionCount(s.eventId)).toBe(0);
  });

  it("rejects a token from another Tema without leaking its owner", async () => {
    const a = await scenario();
    const b = await scenario();

    const response = await scan(a.officerCookie, a.eventId, b.qr);
    const body = response.json<ScanResultPayload>();

    expect(body.ok && body.data.result).toBe("INVALID_QR");
    expect(body.ok && body.data.participant).toBeUndefined();
    expect(await transactionCount(a.eventId)).toBe(0);

    const audit = await testEnv.DB.prepare(
      "SELECT action, after_json FROM audit_log WHERE event_id = ?",
    )
      .bind(a.eventId)
      .first<{ action: string; after_json: string }>();
    expect(audit?.action).toBe("attendance.wrong_theme");
    expect(audit?.after_json).not.toContain(b.qr);
  });

  it("refuses an inactive participant as NOT_ENTITLED", async () => {
    const s = await scenario();
    await testEnv.DB.prepare("UPDATE participants SET status = 'inactive' WHERE id = ?")
      .bind(s.participantId)
      .run();

    const response = await scan(s.officerCookie, s.eventId, s.qr);
    const body = response.json<ScanResultPayload>();

    expect(body.ok && body.data.result).toBe("NOT_ENTITLED");
    expect(body.ok && body.data.reason).toBe("participant_inactive");
    expect(await transactionCount(s.eventId)).toBe(0);
  });

  it("refuses a closed event and an event outside its window", async () => {
    const closed = await scenario({ status: "closed" });
    const closedBody = (await scan(closed.officerCookie, closed.eventId, closed.qr)).json<ScanResultPayload>();
    expect(closedBody.ok && closedBody.data.result).toBe("NOT_ENTITLED");
    expect(closedBody.ok && closedBody.data.reason).toBe("theme_not_active");

    const future = await scenario();
    await setEvent(future.eventId, { startsAt: TEST_NOW + 60_000 });
    const futureBody = (await scan(future.officerCookie, future.eventId, future.qr)).json<ScanResultPayload>();
    expect(futureBody.ok && futureBody.data.result).toBe("NOT_ENTITLED");
    expect(futureBody.ok && futureBody.data.reason).toBe("theme_not_active");

    const past = await scenario();
    await setEvent(past.eventId, { endsAt: TEST_NOW - 1 });
    const pastBody = (await scan(past.officerCookie, past.eventId, past.qr)).json<ScanResultPayload>();
    expect(pastBody.ok && pastBody.data.result).toBe("NOT_ENTITLED");
    expect(pastBody.ok && pastBody.data.reason).toBe("theme_not_active");
  });

  it("refuses a participant without an entitling rule", async () => {
    const s = await scenario();
    await testEnv.DB.prepare(
      "DELETE FROM entitlement_rules WHERE theme_id = ? AND activity_id IS NULL",
    )
      .bind(s.eventId)
      .run();

    const body = (await scan(s.officerCookie, s.eventId, s.qr)).json<ScanResultPayload>();
    expect(body.ok && body.data.result).toBe("NOT_ENTITLED");
    expect(body.ok && body.data.reason).toBe("entitlement_denied");
  });

  it("requires assignment for Petugas but not for the Tema Admin", async () => {
    const s = await scenario();
    const sessionId = await createActivitySession(s.activityId);

    const officerId = await createUser({ role: "officer", displayName: "Tanpa Tugas" });
    await addMembership(s.eventId, officerId, "officer");
    const officerCookie = (await createSession(officerId)).cookie;

    // URL parameters only preselect a context: they never grant access (FR-190).
    const unassigned = await scan(officerCookie, s.eventId, s.qr, {
      activityId: s.activityId,
      sessionId,
    });
    expect(unassigned.status).toBe(403);

    const admin = await scan(s.adminCookie, s.eventId, s.qr, {
      activityId: s.activityId,
      sessionId,
    });
    const body = admin.json<ScanResultPayload>();
    expect(body.ok && body.data.result).toBe("SUCCESS");
  });

  it("requires an explicit Sesi when the Aktivitas owns one", async () => {
    const s = await scenario();
    const sessionId = await createActivitySession(s.activityId);
    await addStaffAssignment(s.eventId, s.activityId, s.officerId, { sessionId });

    const missing = await scan(s.officerCookie, s.eventId, s.qr);
    expect(missing.status).toBe(422);

    const wrong = await scan(s.officerCookie, s.eventId, s.qr, {
      sessionId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    });
    expect(wrong.status).toBe(422);

    const valid = await scan(s.officerCookie, s.eventId, s.qr, {
      activityId: s.activityId,
      sessionId,
    });
    const body = valid.json<ScanResultPayload>();
    expect(body.ok && body.data.result).toBe("SUCCESS");
    expect(body.ok && body.data.transaction?.sessionId).toBe(sessionId);
  });

  it("accepts the same participant in a different Sesi of the same Aktivitas", async () => {
    const s = await scenario();
    const first = await createActivitySession(s.activityId, { name: "Sesi 1" });
    const second = await createActivitySession(s.activityId, { name: "Sesi 2" });

    const one = await scan(s.officerCookie, s.eventId, s.qr, {
      activityId: s.activityId,
      sessionId: first,
    });
    const two = await scan(s.officerCookie, s.eventId, s.qr, {
      activityId: s.activityId,
      sessionId: second,
    });

    const bodyOne = one.json<ScanResultPayload>();
    const bodyTwo = two.json<ScanResultPayload>();
    expect(bodyOne.ok && bodyOne.data.result).toBe("SUCCESS");
    expect(bodyTwo.ok && bodyTwo.data.result).toBe("SUCCESS");
    expect(await transactionCount(s.eventId)).toBe(2);
  });

  it("hides events the caller is not assigned to", async () => {
    const a = await scenario();
    const b = await scenario();

    const response = await scan(b.officerCookie, a.eventId, a.qr);
    expect(response.status).toBe(404);
    expect(await transactionCount(a.eventId)).toBe(0);
  });

  it("does not resolve an Aktivitas from another Tema", async () => {
    const a = await scenario();
    const b = await scenario();

    const response = await scan(a.officerCookie, a.eventId, a.qr, {
      activityId: b.activityId,
    });
    expect(response.status).toBe(404);
    expect(await transactionCount(a.eventId)).toBe(0);
  });

  it("forbids Super Admin from transactional scanning", async () => {
    const s = await scenario();
    const superadminId = await createUser({ role: "superadmin" });
    const superadminCookie = (await createSession(superadminId)).cookie;

    const response = await scan(superadminCookie, s.eventId, s.qr);
    expect(response.status).toBe(403);
    expect(await transactionCount(s.eventId)).toBe(0);
  });
});

describe("attendance history and corrections", () => {
  it("lists only the event's effective transactions and paginates", async () => {
    const s = await scenario();

    for (let index = 0; index < 3; index += 1) {
      const participant = await createParticipant(s.eventId, {
        fullName: `Peserta ${index}`,
      });
      const qr = await issueParticipantQr(s.eventId, participant.id);
      const response = await scan(s.officerCookie, s.eventId, qr, {
        now: TEST_NOW + index,
      });
      expect(response.status).toBe(200);
    }

    const page1 = await callApi(`/api/events/${s.eventId}/attendance?limit=2`, {
      cookie: s.officerCookie,
    });
    const body1 = page1.json<AttendanceListPayload>();
    expect(body1.ok && body1.data.items).toHaveLength(2);
    expect(body1.ok && body1.data.nextCursor).not.toBeNull();

    if (!body1.ok || !body1.data.nextCursor) return;

    const page2 = await callApi(
      `/api/events/${s.eventId}/attendance?limit=2&cursor=${encodeURIComponent(body1.data.nextCursor)}`,
      { cookie: s.officerCookie },
    );
    const body2 = page2.json<AttendanceListPayload>();
    expect(body2.ok && body2.data.items).toHaveLength(1);
    expect(body2.ok && body2.data.nextCursor).toBeNull();

    const allIds = [
      ...(body1.ok ? body1.data.items.map((item) => item.id) : []),
      ...(body2.ok ? body2.data.items.map((item) => item.id) : []),
    ];
    expect(new Set(allIds).size).toBe(3);
  });

  it("reverses as Admin only, keeps history, and frees the slot", async () => {
    const s = await scenario();
    await scan(s.officerCookie, s.eventId, s.qr);
    const transactionId = await effectiveTransactionId(s.eventId);

    const officer = await callApi(
      `/api/events/${s.eventId}/transactions/${transactionId}/reversal`,
      {
        method: "POST",
        body: { reason: "Salah pindai kartu" },
        cookie: s.officerCookie,
      },
    );
    expect(officer.status).toBe(403);

    const shortReason = await callApi(
      `/api/events/${s.eventId}/transactions/${transactionId}/reversal`,
      {
        method: "POST",
        body: { reason: "x" },
        cookie: s.adminCookie,
      },
    );
    expect(shortReason.status).toBe(400);

    const reversal = await callApi(
      `/api/events/${s.eventId}/transactions/${transactionId}/reversal`,
      {
        method: "POST",
        body: { reason: "Salah pindai kartu" },
        cookie: s.adminCookie,
      },
    );
    const body = reversal.json<TransactionDetailPayload>();
    expect(reversal.status).toBe(200);
    expect(body.ok && body.data.transaction.reversedAt).toBe(TEST_NOW);
    expect(body.ok && body.data.transaction.effective).toBe(false);

    // The original row and its correction remain.
    expect(await transactionCount(s.eventId)).toBe(1);
    const correction = await testEnv.DB.prepare(
      "SELECT operation, reason FROM transaction_corrections WHERE transaction_id = ?",
    )
      .bind(transactionId)
      .first<{ operation: string; reason: string }>();
    expect(correction).toEqual({ operation: "reversal", reason: "Salah pindai kartu" });

    const list = await callApi(`/api/events/${s.eventId}/attendance`, {
      cookie: s.officerCookie,
    });
    const listBody = list.json<AttendanceListPayload>();
    expect(listBody.ok && listBody.data.items).toHaveLength(0);

    // A reversal removes the row from the effective unique index.
    const again = await scan(s.officerCookie, s.eventId, s.qr);
    const againBody = again.json<ScanResultPayload>();
    expect(againBody.ok && againBody.data.result).toBe("SUCCESS");
    expect(await transactionCount(s.eventId)).toBe(2);
  });

  it("adjusts with an immutable replacement and never stores the note", async () => {
    const s = await scenario();
    await scan(s.officerCookie, s.eventId, s.qr);
    const originalId = await effectiveTransactionId(s.eventId);

    const response = await callApi(
      `/api/events/${s.eventId}/transactions/${originalId}/adjustment`,
      {
        method: "POST",
        body: {
          status: "excused",
          note: "Catatan rahasia peserta",
          reason: "Surat izin resmi diterima",
        },
        cookie: s.adminCookie,
      },
    );
    const body = response.json<TransactionDetailPayload>();
    expect(response.status).toBe(200);
    if (!body.ok) return;

    expect(body.data.transaction.status).toBe("excused");
    expect(body.data.transaction.adjustsTransactionId).toBe(originalId);
    expect(body.data.transaction.effective).toBe(true);

    const original = await testEnv.DB.prepare(
      "SELECT reversed_at, superseded_at FROM transactions WHERE id = ?",
    )
      .bind(originalId)
      .first<{ reversed_at: number | null; superseded_at: number | null }>();
    expect(original?.reversed_at).toBeNull();
    expect(original?.superseded_at).toBe(TEST_NOW);

    const correction = await testEnv.DB.prepare(
      `SELECT operation, before_json, after_json
         FROM transaction_corrections WHERE transaction_id = ?`,
    )
      .bind(originalId)
      .first<{ operation: string; before_json: string; after_json: string }>();
    expect(correction?.operation).toBe("adjustment");
    expect(JSON.parse(correction?.before_json ?? "{}")).toMatchObject({ status: "present" });
    expect(JSON.parse(correction?.after_json ?? "{}")).toMatchObject({ status: "excused" });

    const audit = await testEnv.DB.prepare(
      "SELECT before_json, after_json FROM audit_log WHERE event_id = ? AND action = 'transaction.adjustment'",
    )
      .bind(s.eventId)
      .first<{ before_json: string; after_json: string }>();
    expect(audit?.before_json).not.toContain("Catatan rahasia peserta");
    expect(audit?.after_json).not.toContain("Catatan rahasia peserta");
    expect(audit?.after_json).toContain("noteChanged");

    const list = await callApi(`/api/events/${s.eventId}/transactions`, {
      cookie: s.officerCookie,
    });
    const listBody = list.json<TransactionListPayload>();
    expect(listBody.ok && listBody.data.items).toHaveLength(1);
    expect(listBody.ok && listBody.data.items[0]?.status).toBe("excused");
  });

  it("refuses a second correction and a stale expectedUpdatedAt", async () => {
    const s = await scenario();
    await scan(s.officerCookie, s.eventId, s.qr);
    const transactionId = await effectiveTransactionId(s.eventId);

    const stale = await callApi(
      `/api/events/${s.eventId}/transactions/${transactionId}/reversal`,
      {
        method: "POST",
        body: { reason: "Alasan yang sah", expectedUpdatedAt: TEST_NOW - 1 },
        cookie: s.adminCookie,
      },
    );
    expect(stale.status).toBe(409);

    await callApi(`/api/events/${s.eventId}/transactions/${transactionId}/reversal`, {
      method: "POST",
      body: { reason: "Alasan yang sah" },
      cookie: s.adminCookie,
    });

    const again = await callApi(
      `/api/events/${s.eventId}/transactions/${transactionId}/reversal`,
      {
        method: "POST",
        body: { reason: "Alasan yang sah" },
        cookie: s.adminCookie,
      },
    );
    expect(again.status).toBe(409);
  });

  it("records manual attendance only when the event allows it", async () => {
    const s = await scenario();

    const blocked = await callApi(`/api/events/${s.eventId}/attendance/manual`, {
      method: "POST",
      body: { participantId: s.participantId, activityId: s.activityId },
      cookie: s.adminCookie,
    });
    expect(blocked.status).toBe(422);

    await setEvent(s.eventId, { allowManual: 1 });

    const created = await callApi(`/api/events/${s.eventId}/attendance/manual`, {
      method: "POST",
      body: { participantId: s.participantId, activityId: s.activityId },
      cookie: s.adminCookie,
    });
    const body = created.json<AttendanceDetailPayload>();
    expect(created.status).toBe(201);
    expect(body.ok && body.data.attendance.method).toBe("manual");
    expect(body.ok && body.data.attendance.status).toBe("present");

    const duplicate = await callApi(`/api/events/${s.eventId}/attendance/manual`, {
      method: "POST",
      body: { participantId: s.participantId, activityId: s.activityId },
      cookie: s.adminCookie,
    });
    expect(duplicate.status).toBe(409);
  });

  it("requires the assignment flag for officer Manual Check-in", async () => {
    const s = await scenario();
    await setEvent(s.eventId, { allowManual: 1 });

    const refused = await callApi(`/api/events/${s.eventId}/attendance/manual`, {
      method: "POST",
      body: { participantId: s.participantId, activityId: s.activityId },
      cookie: s.officerCookie,
    });
    expect(refused.status).toBe(403);

    await testEnv.DB.prepare(
      "UPDATE staff_assignments SET can_manual_check_in = 1 WHERE user_id = ? AND activity_id = ?",
    )
      .bind(s.officerId, s.activityId)
      .run();

    const allowed = await callApi(`/api/events/${s.eventId}/attendance/manual`, {
      method: "POST",
      body: { participantId: s.participantId, activityId: s.activityId },
      cookie: s.officerCookie,
    });
    expect(allowed.status).toBe(201);
  });

  it("forbids Super Admin from Manual Check-in and corrections", async () => {
    const s = await scenario();
    await setEvent(s.eventId, { allowManual: 1 });
    const superadminId = await createUser({ role: "superadmin" });
    const superadminCookie = (await createSession(superadminId)).cookie;

    const manual = await callApi(`/api/events/${s.eventId}/attendance/manual`, {
      method: "POST",
      body: { participantId: s.participantId, activityId: s.activityId },
      cookie: superadminCookie,
    });
    expect(manual.status).toBe(403);

    await scan(s.officerCookie, s.eventId, s.qr);
    const transactionId = await effectiveTransactionId(s.eventId);

    const reversal = await callApi(
      `/api/events/${s.eventId}/transactions/${transactionId}/reversal`,
      {
        method: "POST",
        body: { reason: "Alasan yang sah" },
        cookie: superadminCookie,
      },
    );
    expect(reversal.status).toBe(403);
  });

  it("scopes staff history to the recording officer", async () => {
    const s = await scenario();
    await scan(s.officerCookie, s.eventId, s.qr);

    const own = await callApi("/api/staff/attendance", { cookie: s.officerCookie });
    const ownBody = own.json<AttendanceListPayload>();
    expect(ownBody.ok && ownBody.data.items).toHaveLength(1);
    expect(ownBody.ok && ownBody.data.items[0]?.participantName).toBe("Budi Peserta");

    const otherId = await createUser({ role: "officer" });
    await addMembership(s.eventId, otherId, "officer");
    const otherCookie = (await createSession(otherId)).cookie;

    const other = await callApi("/api/staff/attendance", { cookie: otherCookie });
    const otherBody = other.json<AttendanceListPayload>();
    expect(otherBody.ok && otherBody.data.items).toHaveLength(0);
  });

  it("does not expose another Tema's transaction by id", async () => {
    const a = await scenario();
    const b = await scenario();
    await scan(b.officerCookie, b.eventId, b.qr);
    const foreignId = await effectiveTransactionId(b.eventId);

    const response = await callApi(
      `/api/events/${a.eventId}/transactions/${foreignId}/reversal`,
      {
        method: "POST",
        body: { reason: "Tidak boleh lintas Tema" },
        cookie: a.adminCookie,
      },
    );
    expect(response.status).toBe(404);
  });
});

describe("dashboard aggregates", () => {
  it("computes event totals and percentage from effective transactions", async () => {
    const s = await scenario();

    const second = await createParticipant(s.eventId, { fullName: "Siti Peserta" });
    await issueParticipantQr(s.eventId, second.id);

    // One of two participants attends.
    await scan(s.officerCookie, s.eventId, s.qr);

    const response = await callApi(`/api/events/${s.eventId}/dashboard`, {
      cookie: s.officerCookie,
    });
    const body = response.json<{
      totalParticipants: number;
      presentCount: number;
      notPresentCount: number;
      attendancePercentage: number;
      byStatus: Record<AttendanceRecord["status"], number>;
      recent: AttendanceRecord[];
    }>();

    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.totalParticipants).toBe(2);
    expect(body.data.presentCount).toBe(1);
    expect(body.data.notPresentCount).toBe(1);
    expect(body.data.attendancePercentage).toBe(50);
    expect(body.data.byStatus.present).toBe(1);
    expect(body.data.recent).toHaveLength(1);
  });

  it("scopes the global dashboard to accessible events", async () => {
    const a = await scenario();
    const b = await scenario();

    const officer = await callApi("/api/dashboard", { cookie: a.officerCookie });
    const officerBody = officer.json<{
      events: Array<{ id: string }>;
      totals: { events: number };
    }>();

    expect(officerBody.ok && officerBody.data.events.map((event) => event.id)).toEqual([
      a.eventId,
    ]);
    expect(officerBody.ok && officerBody.data.totals.events).toBe(1);

    const superadminId = await createUser({ role: "superadmin" });
    const superadminCookie = (await createSession(superadminId)).cookie;

    const all = await callApi("/api/dashboard", { cookie: superadminCookie });
    const allBody = all.json<{ events: Array<{ id: string }> }>();
    expect(allBody.ok && allBody.data.events.map((event) => event.id).sort()).toEqual(
      [a.eventId, b.eventId].sort(),
    );
  });
});
