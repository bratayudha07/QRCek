import type {
  StaffAssignmentDetailPayload,
  StaffAssignmentListPayload,
  StaffContextListPayload,
} from "@absensi/shared";
import { describe, expect, it } from "vitest";

import {
  addMembership,
  addStaffAssignment,
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
 * Petugas assignment management (DESAIN_API.md §4/§7, Q6).
 *
 * T-101, T-105, T-106, T-107 go through the real router, session cookie, CSRF,
 * D1 batch, and the partial unique indexes. Audit assertions are scoped by the
 * event id because `audit_log` is append-only across tests.
 */

interface World {
  adminId: string;
  adminCookie: string;
  officerId: string;
  officerCookie: string;
  otherOfficerId: string;
  eventId: string;
  activityId: string;
}

async function world(): Promise<World> {
  const adminId = await createUser({ role: "event_admin", displayName: "Admin Acara" });
  const eventId = await createEvent({ createdBy: adminId, name: "Acara Tugas" });
  await testEnv.DB.prepare("UPDATE events SET status = 'active' WHERE id = ?")
    .bind(eventId)
    .run();
  await addMembership(eventId, adminId, "event_admin");

  const activityId = await createActivity(eventId);

  const officerId = await createUser({ role: "officer", displayName: "Petugas Satu" });
  await addMembership(eventId, officerId, "officer");

  const otherOfficerId = await createUser({ role: "officer", displayName: "Petugas Dua" });
  await addMembership(eventId, otherOfficerId, "officer");

  return {
    adminId,
    adminCookie: (await createSession(adminId)).cookie,
    officerId,
    officerCookie: (await createSession(officerId)).cookie,
    otherOfficerId,
    eventId,
    activityId,
  };
}

function createAssignment(
  cookie: string,
  eventId: string,
  body: Record<string, unknown>,
) {
  return callApi(`/api/events/${eventId}/assignments`, {
    method: "POST",
    body,
    cookie,
  });
}

async function auditActions(eventId: string, action: string): Promise<number> {
  const row = await testEnv.DB.prepare(
    "SELECT COUNT(*) AS n FROM audit_log WHERE event_id = ? AND action = ?",
  )
    .bind(eventId, action)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("assignment management", () => {
  it("creates an assignment and audits it in the same batch", async () => {
    const w = await world();

    const response = await createAssignment(w.adminCookie, w.eventId, {
      userId: w.officerId,
      activityId: w.activityId,
    });
    const body = response.json<StaffAssignmentDetailPayload>();

    expect(response.status).toBe(201);
    if (!body.ok) return;

    expect(body.data.assignment).toMatchObject({
      themeId: w.eventId,
      userId: w.officerId,
      userDisplayName: "Petugas Satu",
      activityId: w.activityId,
      sessionId: null,
      canManualCheckIn: false,
      status: "active",
    });

    const audit = await testEnv.DB.prepare(
      "SELECT actor_user_id, entity_type, entity_id, after_json, before_json FROM audit_log WHERE event_id = ? AND action = 'assignment.created'",
    )
      .bind(w.eventId)
      .first<{
        actor_user_id: string;
        entity_type: string;
        entity_id: string;
        after_json: string;
        before_json: string | null;
      }>();

    expect(audit?.actor_user_id).toBe(w.adminId);
    expect(audit?.entity_type).toBe("staff_assignment");
    expect(audit?.entity_id).toBe(body.data.assignment.id);
    expect(audit?.before_json).toBeNull();
    expect(audit?.after_json).toContain(w.officerId);
    // Display names and PII never enter the audit snapshot.
    expect(audit?.after_json).not.toContain("Petugas Satu");
  });

  it("forbids Petugas from managing assignments, including their own", async () => {
    const w = await world();

    const created = await createAssignment(w.officerCookie, w.eventId, {
      userId: w.officerId,
      activityId: w.activityId,
    });
    expect(created.status).toBe(403);

    const assignmentId = await addStaffAssignment(w.eventId, w.activityId, w.officerId);

    const patch = await callApi(
      `/api/events/${w.eventId}/assignments/${assignmentId}`,
      { method: "PATCH", body: { canManualCheckIn: true }, cookie: w.officerCookie },
    );
    expect(patch.status).toBe(403);

    const revoke = await callApi(
      `/api/events/${w.eventId}/assignments/${assignmentId}/revoke`,
      { method: "POST", cookie: w.officerCookie },
    );
    expect(revoke.status).toBe(403);

    expect(await auditActions(w.eventId, "assignment.created")).toBe(0);
    expect(await auditActions(w.eventId, "assignment.revoked")).toBe(0);
  });

  it("rejects a target who is not an active Petugas of the Tema", async () => {
    const w = await world();

    const nonMemberId = await createUser({ role: "officer" });
    const nonMember = await createAssignment(w.adminCookie, w.eventId, {
      userId: nonMemberId,
      activityId: w.activityId,
    });
    expect(nonMember.status).toBe(422);

    const adminTargetId = await createUser({ role: "event_admin" });
    await addMembership(w.eventId, adminTargetId, "event_admin");
    const adminTarget = await createAssignment(w.adminCookie, w.eventId, {
      userId: adminTargetId,
      activityId: w.activityId,
    });
    expect(adminTarget.status).toBe(422);

    const suspendedId = await createUser({ role: "officer", status: "suspended" });
    await addMembership(w.eventId, suspendedId, "officer");
    const suspended = await createAssignment(w.adminCookie, w.eventId, {
      userId: suspendedId,
      activityId: w.activityId,
    });
    expect(suspended.status).toBe(422);
  });

  it("rejects cross-Tema Aktivitas and a Sesi that belongs to another Aktivitas", async () => {
    const w = await world();
    const other = await world();

    const crossTheme = await createAssignment(w.adminCookie, w.eventId, {
      userId: w.officerId,
      activityId: other.activityId,
    });
    expect(crossTheme.status).toBe(404);

    const secondActivity = await createActivity(w.eventId, { name: "Konsumsi" });
    const foreignSession = await createActivitySession(secondActivity);

    const mismatch = await createAssignment(w.adminCookie, w.eventId, {
      userId: w.officerId,
      activityId: w.activityId,
      sessionId: foreignSession,
    });
    expect(mismatch.status).toBe(404);

    const validSession = await createActivitySession(w.activityId);
    const valid = await createAssignment(w.adminCookie, w.eventId, {
      userId: w.officerId,
      activityId: w.activityId,
      sessionId: validSession,
    });
    expect(valid.status).toBe(201);
  });

  it("refuses an archived Aktivitas or Sesi", async () => {
    const w = await world();
    const archivedActivity = await createActivity(w.eventId, {
      name: "Lama",
      status: "archived",
    });

    const activity = await createAssignment(w.adminCookie, w.eventId, {
      userId: w.officerId,
      activityId: archivedActivity,
    });
    expect(activity.status).toBe(422);

    const sessionId = await createActivitySession(w.activityId, {
      status: "completed",
      archivedAt: TEST_NOW,
    });
    const session = await createAssignment(w.adminCookie, w.eventId, {
      userId: w.officerId,
      activityId: w.activityId,
      sessionId,
    });
    expect(session.status).toBe(422);
  });

  it("returns 409 for a duplicate active assignment, including concurrent creates", async () => {
    const w = await world();

    const first = await createAssignment(w.adminCookie, w.eventId, {
      userId: w.officerId,
      activityId: w.activityId,
    });
    expect(first.status).toBe(201);

    const duplicate = await createAssignment(w.adminCookie, w.eventId, {
      userId: w.officerId,
      activityId: w.activityId,
    });
    expect(duplicate.status).toBe(409);
    expect(await auditActions(w.eventId, "assignment.created")).toBe(1);

    const otherId = await createUser({ role: "officer" });
    await addMembership(w.eventId, otherId, "officer");
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        createAssignment(w.adminCookie, w.eventId, {
          userId: otherId,
          activityId: w.activityId,
        }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409, 409, 409, 409,
    ]);
    expect(await auditActions(w.eventId, "assignment.created")).toBe(2);
  });

  it("revokes without deleting history and hides it from the default list", async () => {
    const w = await world();

    const created = await createAssignment(w.adminCookie, w.eventId, {
      userId: w.officerId,
      activityId: w.activityId,
    });
    const body = created.json<StaffAssignmentDetailPayload>();
    if (!body.ok) throw new Error("create failed");

    const assignmentId = body.data.assignment.id;

    const revoked = await callApi(
      `/api/events/${w.eventId}/assignments/${assignmentId}/revoke`,
      { method: "POST", cookie: w.adminCookie },
    );
    const revokedBody = revoked.json<StaffAssignmentDetailPayload>();
    expect(revoked.status).toBe(200);
    expect(revokedBody.ok && revokedBody.data.assignment.status).toBe("revoked");
    expect(revokedBody.ok && revokedBody.data.assignment.revokedAt).toBe(TEST_NOW);

    const again = await callApi(
      `/api/events/${w.eventId}/assignments/${assignmentId}/revoke`,
      { method: "POST", cookie: w.adminCookie },
    );
    expect(again.status).toBe(404);

    const active = await callApi(`/api/events/${w.eventId}/assignments`, {
      cookie: w.adminCookie,
    });
    const activeBody = active.json<StaffAssignmentListPayload>();
    expect(activeBody.ok && activeBody.data.assignments).toHaveLength(0);

    const all = await callApi(`/api/events/${w.eventId}/assignments?status=all`, {
      cookie: w.adminCookie,
    });
    const allBody = all.json<StaffAssignmentListPayload>();
    expect(allBody.ok && allBody.data.assignments).toHaveLength(1);
    expect(allBody.ok && allBody.data.assignments[0]?.status).toBe("revoked");

    expect(await auditActions(w.eventId, "assignment.revoked")).toBe(1);
  });

  it("keeps historical transactions after the assignment is revoked (T-101)", async () => {
    const w = await world();
    await testEnv.DB.prepare(
      `INSERT INTO entitlement_rules
         (id, theme_id, activity_id, session_id, participant_id, category_id,
          status, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, NULL, NULL, NULL, NULL, 'allowed', ?, NULL, ?, NULL)`,
    )
      .bind("rule-default", w.eventId, TEST_NOW, TEST_NOW)
      .run();

    const participant = await createParticipant(w.eventId, { fullName: "Budi" });
    const qr = await issueParticipantQr(w.eventId, participant.id);
    await addStaffAssignment(w.eventId, w.activityId, w.officerId);

    const scan = await callApi(`/api/events/${w.eventId}/scan`, {
      method: "POST",
      body: { qr, activityId: w.activityId },
      cookie: w.officerCookie,
    });
    expect(scan.status).toBe(200);

    const assignment = await testEnv.DB.prepare(
      "SELECT id FROM staff_assignments WHERE user_id = ? AND activity_id = ?",
    )
      .bind(w.officerId, w.activityId)
      .first<{ id: string }>();
    if (!assignment) throw new Error("assignment missing");

    const revoked = await callApi(
      `/api/events/${w.eventId}/assignments/${assignment.id}/revoke`,
      { method: "POST", cookie: w.adminCookie },
    );
    expect(revoked.status).toBe(200);

    const transactions = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM transactions WHERE theme_id = ?",
    )
      .bind(w.eventId)
      .first<{ n: number }>();
    expect(transactions?.n).toBe(1);

    const history = await callApi(`/api/events/${w.eventId}/attendance`, {
      cookie: w.adminCookie,
    });
    const historyBody = history.json<{ items: unknown[] }>();
    expect(historyBody.ok && historyBody.data.items).toHaveLength(1);

    const blocked = await callApi(`/api/events/${w.eventId}/scan`, {
      method: "POST",
      body: { qr, activityId: w.activityId },
      cookie: w.officerCookie,
    });
    expect(blocked.status).toBe(403);
  });

  it("scopes assignment management to Admins of the Tema", async () => {
    const a = await world();
    const b = await world();

    const otherThemes = await callApi(`/api/events/${b.eventId}/assignments`, {
      cookie: a.adminCookie,
    });
    expect(otherThemes.status).toBe(404);

    const superadminId = await createUser({ role: "superadmin" });
    const superadminCookie = (await createSession(superadminId)).cookie;

    const created = await createAssignment(superadminCookie, b.eventId, {
      userId: b.officerId,
      activityId: b.activityId,
    });
    expect(created.status).toBe(201);
  });
});

describe("Manual Check-in flag", () => {
  it("is toggled by an Admin and used by the effective assignment (T-107)", async () => {
    const w = await world();
    await testEnv.DB.prepare(
      `INSERT INTO entitlement_rules
         (id, theme_id, activity_id, session_id, participant_id, category_id,
          status, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, NULL, NULL, NULL, NULL, 'allowed', ?, NULL, ?, NULL)`,
    )
      .bind("rule-manual", w.eventId, TEST_NOW, TEST_NOW)
      .run();
    await testEnv.DB.prepare("UPDATE events SET allow_manual = 1 WHERE id = ?")
      .bind(w.eventId)
      .run();

    const participant = await createParticipant(w.eventId, { fullName: "Siti" });
    const created = await createAssignment(w.adminCookie, w.eventId, {
      userId: w.officerId,
      activityId: w.activityId,
    });
    const body = created.json<StaffAssignmentDetailPayload>();
    if (!body.ok) throw new Error("create failed");

    const blocked = await callApi(`/api/events/${w.eventId}/attendance/manual`, {
      method: "POST",
      body: { participantId: participant.id, activityId: w.activityId },
      cookie: w.officerCookie,
    });
    expect(blocked.status).toBe(403);

    const patch = await callApi(
      `/api/events/${w.eventId}/assignments/${body.data.assignment.id}`,
      {
        method: "PATCH",
        body: { canManualCheckIn: true },
        cookie: w.adminCookie,
      },
    );
    const patched = patch.json<StaffAssignmentDetailPayload>();
    expect(patch.status).toBe(200);
    expect(patched.ok && patched.data.assignment.canManualCheckIn).toBe(true);
    expect(await auditActions(w.eventId, "assignment.updated")).toBe(1);

    const allowed = await callApi(`/api/events/${w.eventId}/attendance/manual`, {
      method: "POST",
      body: { participantId: participant.id, activityId: w.activityId },
      cookie: w.officerCookie,
    });
    expect(allowed.status).toBe(201);
  });

  it("is idempotent and writes no audit when the value does not change", async () => {
    const w = await world();
    const assignmentId = await addStaffAssignment(w.eventId, w.activityId, w.officerId);

    const response = await callApi(
      `/api/events/${w.eventId}/assignments/${assignmentId}`,
      { method: "PATCH", body: { canManualCheckIn: false }, cookie: w.adminCookie },
    );

    expect(response.status).toBe(200);
    expect(await auditActions(w.eventId, "assignment.updated")).toBe(0);
  });
});

describe("GET /api/staff/assignments", () => {
  it("returns only the caller's active, non-archived contexts", async () => {
    const w = await world();
    const mine = await addStaffAssignment(w.eventId, w.activityId, w.officerId);
    await addStaffAssignment(w.eventId, w.activityId, w.otherOfficerId);

    const response = await callApi("/api/staff/assignments", { cookie: w.officerCookie });
    const body = response.json<StaffContextListPayload>();

    expect(response.status).toBe(200);
    if (!body.ok) return;

    expect(body.data.contexts).toHaveLength(1);
    expect(body.data.contexts[0]).toMatchObject({
      assignmentId: mine,
      themeName: "Acara Tugas",
      activityId: w.activityId,
      activityName: "Absensi",
      sessionId: null,
      activityStatus: "active",
      canManualCheckIn: false,
    });

    const other = await callApi("/api/staff/assignments", {
      cookie: w.officerCookie.replace("absensi_session=", "absensi_session=other"),
    });
    // A forged cookie is simply unauthenticated; nothing leaks.
    expect(other.status).toBe(401);
  });

  it("expands Activity-level assignments per Sesi and hides archived Sesi", async () => {
    const w = await world();
    const first = await createActivitySession(w.activityId, { name: "Pagi" });
    const second = await createActivitySession(w.activityId, { name: "Siang" });
    await createActivitySession(w.activityId, {
      name: "Arsip",
      status: "completed",
      archivedAt: TEST_NOW,
    });
    await addStaffAssignment(w.eventId, w.activityId, w.officerId);

    const response = await callApi("/api/staff/assignments", { cookie: w.officerCookie });
    const body = response.json<StaffContextListPayload>();
    if (!body.ok) return;

    expect(body.data.contexts.map((context) => context.sessionId).sort()).toEqual(
      [first, second].sort(),
    );
    expect(body.data.contexts.every((context) => context.sessionName !== "Arsip")).toBe(true);
  });

  it("returns an empty list for a user without assignments", async () => {
    await world();
    const unassignedId = await createUser({ role: "officer" });
    const cookie = (await createSession(unassignedId)).cookie;

    const response = await callApi("/api/staff/assignments", { cookie });
    const body = response.json<StaffContextListPayload>();

    expect(response.status).toBe(200);
    expect(body.ok && body.data.contexts).toEqual([]);
  });
});
