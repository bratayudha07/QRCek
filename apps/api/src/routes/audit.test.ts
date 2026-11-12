import { describe, expect, it } from "vitest";

import {
  addMembership,
  addStaffAssignment,
  allowThemeDefault,
  createActivity,
  createEvent,
  createParticipant,
  createSession,
  createUser,
  issueParticipantQr,
} from "../test/fixtures";
import { testEnv } from "../test/env";
import { TEST_NOW, callApi } from "../test/http";

describe("event audit and attendance export", () => {
  it("allows event admins to read scoped audit entries without private IP hashes", async () => {
    const adminId = await createUser({ role: "event_admin", displayName: "Admin" });
    const eventId = await createEvent({ createdBy: adminId, name: "Acara Audit" });
    await addMembership(eventId, adminId, "event_admin");
    const adminCookie = (await createSession(adminId)).cookie;

    const participant = await createParticipant(eventId, { fullName: "Peserta Audit" });
    const qr = await issueParticipantQr(eventId, participant.id);
    const officerId = await createUser({ role: "officer", displayName: "Petugas" });
    await addMembership(eventId, officerId, "officer");
    const officerCookie = (await createSession(officerId)).cookie;
    await testEnv.DB.prepare("UPDATE events SET status = 'active' WHERE id = ?").bind(eventId).run();
    const activityId = await createActivity(eventId);
    await allowThemeDefault(eventId);
    await addStaffAssignment(eventId, activityId, officerId);
    await callApi(`/api/events/${eventId}/scan`, {
      method: "POST",
      body: { qr, activityId },
      cookie: officerCookie,
      now: TEST_NOW,
    });

    const response = await callApi(`/api/events/${eventId}/audit?limit=1`, { cookie: adminCookie });
    expect(response.status).toBe(200);
    expect(response.text).not.toContain("ip_hash");
    expect(response.text).not.toContain("qr_token");
    expect(response.text).toContain("transaction.recorded");

    const forbidden = await callApi(`/api/events/${eventId}/audit`, { cookie: officerCookie });
    expect(forbidden.status).toBe(403);
  });

  it("exports event attendance as CSV only for admins", async () => {
    const adminId = await createUser({ role: "event_admin", displayName: "Admin" });
    const eventId = await createEvent({ createdBy: adminId, name: "Acara Laporan" });
    await addMembership(eventId, adminId, "event_admin");
    const adminCookie = (await createSession(adminId)).cookie;
    const participant = await createParticipant(eventId, { fullName: "Peserta CSV" });
    const qr = await issueParticipantQr(eventId, participant.id);
    const officerId = await createUser({ role: "officer" });
    await addMembership(eventId, officerId, "officer");
    const officerCookie = (await createSession(officerId)).cookie;
    await testEnv.DB.prepare("UPDATE events SET status = 'active' WHERE id = ?").bind(eventId).run();
    const activityId = await createActivity(eventId);
    await allowThemeDefault(eventId);
    await addStaffAssignment(eventId, activityId, officerId);
    await callApi(`/api/events/${eventId}/scan`, {
      method: "POST",
      body: { qr, activityId },
      cookie: officerCookie,
      now: TEST_NOW,
    });

    const response = await callApi(`/api/events/${eventId}/attendance/export`, { cookie: adminCookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.text).toContain("nama_peserta");
    expect(response.text).toContain("Peserta CSV");
    expect(response.text).toContain("present");

    const forbidden = await callApi(`/api/events/${eventId}/attendance/export`, { cookie: officerCookie });
    expect(forbidden.status).toBe(403);
  });
});
