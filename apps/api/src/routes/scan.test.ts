import type {
  AttendanceDetailPayload,
  AttendanceListPayload,
  AttendanceRecord,
  ScanResultPayload,
} from "@absensi/shared";
import { describe, expect, it } from "vitest";

import {
  addMembership,
  createEvent,
  createParticipant,
  createSession,
  createUser,
  issueParticipantQr,
} from "../test/fixtures";
import { testEnv } from "../test/env";
import { TEST_NOW, callApi } from "../test/http";

/**
 * Scan + attendance API (DESAIN_API.md §6).
 *
 * Every test goes through the real router, CSRF, session lookup, D1 batch, and
 * unique constraint. The clock is fixed, so "duplicate" and "window" results
 * are reproducible.
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
  participantId: string;
  qr: string;
}

async function scenario(options: { role?: "officer" | "event_admin"; status?: string } = {}): Promise<Scenario> {
  const adminId = await createUser({ role: "event_admin", displayName: "Admin Acara" });
  const eventId = await createEvent({ createdBy: adminId, name: "Acara Scan" });
  await setEvent(eventId, { status: options.status ?? "active" });
  await addMembership(eventId, adminId, "event_admin");

  const adminCookie = (await createSession(adminId)).cookie;

  const officerId = await createUser({ role: "officer", displayName: "Petugas Scan" });
  await addMembership(eventId, officerId, "officer");
  const officerCookie = (await createSession(officerId)).cookie;

  const participant = await createParticipant(eventId, { fullName: "Budi Peserta" });
  const qr = await issueParticipantQr(eventId, participant.id);

  return {
    adminId,
    adminCookie,
    officerId,
    officerCookie,
    eventId,
    participantId: participant.id,
    qr,
  };
}

function scan(cookie: string, eventId: string, qr: string, now = TEST_NOW) {
  return callApi(`/api/events/${eventId}/scan`, {
    method: "POST",
    body: { qr },
    cookie,
    now,
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

describe("POST /api/events/:eventId/scan", () => {
  it("records attendance, outbox, and audit atomically", async () => {
    const s = await scenario();
    const response = await scan(s.officerCookie, s.eventId, s.qr);

    expect(response.status).toBe(200);
    const body = response.json<ScanResultPayload>();
    expect(body.ok).toBe(true);
    if (!body.ok) return;

    expect(body.data.result).toBe("present");
    expect(body.data.participant?.fullName).toBe("Budi Peserta");
    expect(body.data.attendance?.checkedInAt).toBe(TEST_NOW);

    expect(await attendanceCount(s.eventId)).toBe(1);

    const outbox = await testEnv.DB.prepare(
      "SELECT status, participant_id FROM outbox WHERE event_id = ?",
    )
      .bind(s.eventId)
      .first<{ status: string; participant_id: string }>();
    expect(outbox).toEqual({ status: "pending", participant_id: s.participantId });

    const audit = await testEnv.DB.prepare(
      "SELECT action, actor_user_id, entity_id FROM audit_log WHERE event_id = ?",
    )
      .bind(s.eventId)
      .first<{ action: string; actor_user_id: string; entity_id: string }>();
    expect(audit?.action).toBe("attendance.recorded");
    expect(audit?.actor_user_id).toBe(s.officerId);
  });

  it("reports a second scan as duplicate and keeps one row", async () => {
    const s = await scenario();
    await scan(s.officerCookie, s.eventId, s.qr);

    const second = await scan(s.officerCookie, s.eventId, s.qr);
    const body = second.json<ScanResultPayload>();

    expect(second.status).toBe(200);
    expect(body.ok && body.data.result).toBe("duplicate");
    expect(body.ok && body.data.attendance?.checkedInAt).toBe(TEST_NOW);
    expect(await attendanceCount(s.eventId)).toBe(1);
  });

  it("never creates more than one row under concurrent scans", async () => {
    const s = await scenario();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => scan(s.officerCookie, s.eventId, s.qr)),
    );

    const results = responses.map((response) => {
      const body = response.json<ScanResultPayload>();
      return body.ok ? body.data.result : "error";
    });

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(results.filter((result) => result === "present")).toHaveLength(1);
    expect(results.filter((result) => result === "duplicate")).toHaveLength(4);
    expect(await attendanceCount(s.eventId)).toBe(1);
  });

  it("rejects an unknown or malformed payload as not_found", async () => {
    const s = await scenario();

    for (const qr of [
      "absensi:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "https://example.com/not-a-qr",
      "absensi:v2:short",
    ]) {
      const response = await scan(s.officerCookie, s.eventId, qr);
      const body = response.json<ScanResultPayload>();

      expect(response.status).toBe(200);
      expect(body.ok && body.data.result).toBe("not_found");
    }
  });

  it("rejects a token from another event and audits the attempt", async () => {
    const a = await scenario();
    const b = await scenario();

    const response = await scan(a.officerCookie, a.eventId, b.qr);
    const body = response.json<ScanResultPayload>();

    expect(body.ok && body.data.result).toBe("wrong_event");
    expect(body.ok && body.data.participant).toBeUndefined();
    expect(await attendanceCount(a.eventId)).toBe(0);

    const audit = await testEnv.DB.prepare(
      "SELECT action, after_json FROM audit_log WHERE event_id = ?",
    )
      .bind(a.eventId)
      .first<{ action: string; after_json: string }>();
    expect(audit?.action).toBe("attendance.wrong_event");
    expect(audit?.after_json).not.toContain(b.qr);
  });

  it("refuses an inactive participant", async () => {
    const s = await scenario();
    await testEnv.DB.prepare("UPDATE participants SET status = 'inactive' WHERE id = ?")
      .bind(s.participantId)
      .run();

    const response = await scan(s.officerCookie, s.eventId, s.qr);
    const body = response.json<ScanResultPayload>();

    expect(body.ok && body.data.result).toBe("participant_inactive");
    expect(await attendanceCount(s.eventId)).toBe(0);
  });

  it("refuses a closed event and an event outside its window", async () => {
    const closed = await scenario({ status: "closed" });
    const closedBody = (await scan(closed.officerCookie, closed.eventId, closed.qr)).json<ScanResultPayload>();
    expect(closedBody.ok && closedBody.data.result).toBe("event_closed");
    expect(closedBody.ok && closedBody.data.eventName).toBe("Acara Scan");

    const future = await scenario();
    await setEvent(future.eventId, { startsAt: TEST_NOW + 60_000 });
    const futureBody = (await scan(future.officerCookie, future.eventId, future.qr)).json<ScanResultPayload>();
    expect(futureBody.ok && futureBody.data.result).toBe("event_closed");

    const past = await scenario();
    await setEvent(past.eventId, { endsAt: TEST_NOW - 1 });
    const pastBody = (await scan(past.officerCookie, past.eventId, past.qr)).json<ScanResultPayload>();
    expect(pastBody.ok && pastBody.data.result).toBe("event_closed");
  });

  it("hides events the caller is not assigned to", async () => {
    const a = await scenario();
    const b = await scenario();

    const response = await scan(b.officerCookie, a.eventId, a.qr);
    expect(response.status).toBe(404);
    expect(await attendanceCount(a.eventId)).toBe(0);
  });
});

describe("attendance history and correction", () => {
  it("lists only the event's attendance and paginates", async () => {
    const s = await scenario();

    for (let index = 0; index < 3; index += 1) {
      const participant = await createParticipant(s.eventId, {
        fullName: `Peserta ${index}`,
      });
      const qr = await issueParticipantQr(s.eventId, participant.id);
      const response = await scan(s.officerCookie, s.eventId, qr, TEST_NOW + index);
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

  it("requires an admin and a reason, then audits the correction", async () => {
    const s = await scenario();
    await scan(s.officerCookie, s.eventId, s.qr);

    const row = await testEnv.DB.prepare(
      "SELECT id FROM attendance WHERE event_id = ?",
    )
      .bind(s.eventId)
      .first<{ id: string }>();
    expect(row).not.toBeNull();
    const attendanceId = row?.id as string;

    const officer = await callApi(
      `/api/events/${s.eventId}/attendance/${attendanceId}/correction`,
      {
        method: "POST",
        body: { status: "excused", reason: "Surat izin resmi diterima" },
        cookie: s.officerCookie,
      },
    );
    expect(officer.status).toBe(403);

    const shortReason = await callApi(
      `/api/events/${s.eventId}/attendance/${attendanceId}/correction`,
      {
        method: "POST",
        body: { status: "excused", reason: "izin" },
        cookie: s.adminCookie,
      },
    );
    expect(shortReason.status).toBe(400);

    const correction = await callApi(
      `/api/events/${s.eventId}/attendance/${attendanceId}/correction`,
      {
        method: "POST",
        body: { status: "excused", reason: "Surat izin resmi diterima" },
        cookie: s.adminCookie,
      },
    );
    const body = correction.json<AttendanceDetailPayload>();
    expect(correction.status).toBe(200);
    expect(body.ok && body.data.attendance.status).toBe("excused");

    const audit = await testEnv.DB.prepare(
      "SELECT reason, before_json, after_json FROM audit_log WHERE event_id = ? AND action = 'attendance.corrected'",
    )
      .bind(s.eventId)
      .first<{ reason: string; before_json: string; after_json: string }>();

    expect(audit?.reason).toBe("Surat izin resmi diterima");
    expect(JSON.parse(audit?.before_json ?? "{}")).toMatchObject({ status: "present" });
    expect(JSON.parse(audit?.after_json ?? "{}")).toMatchObject({ status: "excused" });

    const outboxCount = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM outbox WHERE event_id = ?",
    )
      .bind(s.eventId)
      .first<{ n: number }>();
    expect(outboxCount?.n).toBe(1);
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

  it("records manual attendance only when the event allows it", async () => {
    const s = await scenario();

    const blocked = await callApi(`/api/events/${s.eventId}/attendance/manual`, {
      method: "POST",
      body: { participantId: s.participantId },
      cookie: s.adminCookie,
    });
    expect(blocked.status).toBe(422);

    await setEvent(s.eventId, { allowManual: 1 });

    const created = await callApi(`/api/events/${s.eventId}/attendance/manual`, {
      method: "POST",
      body: { participantId: s.participantId },
      cookie: s.adminCookie,
    });
    const body = created.json<AttendanceDetailPayload>();
    expect(created.status).toBe(201);
    expect(body.ok && body.data.attendance.method).toBe("manual");
    expect(body.ok && body.data.attendance.status).toBe("present");

    const duplicate = await callApi(`/api/events/${s.eventId}/attendance/manual`, {
      method: "POST",
      body: { participantId: s.participantId },
      cookie: s.adminCookie,
    });
    expect(duplicate.status).toBe(409);
  });

  it("does not expose another event's attendance by id", async () => {
    const a = await scenario();
    const b = await scenario();
    await scan(b.officerCookie, b.eventId, b.qr);

    const foreign = await testEnv.DB.prepare(
      "SELECT id FROM attendance WHERE event_id = ?",
    )
      .bind(b.eventId)
      .first<{ id: string }>();

    const response = await callApi(
      `/api/events/${a.eventId}/attendance/${foreign?.id}/correction`,
      {
        method: "POST",
        body: { status: "excused", reason: "Tidak boleh lintas acara" },
        cookie: a.adminCookie,
      },
    );
    expect(response.status).toBe(404);
  });
});

describe("dashboard aggregates", () => {
  it("computes event totals and percentage from the database", async () => {
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
