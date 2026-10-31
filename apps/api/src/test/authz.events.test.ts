import type { InviteCreatedPayload, MemberListPayload, MePayload } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import {
  addMembership,
  createEvent,
  createSession,
  createUser,
  seedInvite,
} from "./fixtures";
import { TEST_NOW, callApi, errorCode } from "./http";
import { testEnv } from "./env";

/**
 * Event-scoped authorization, end to end.
 *
 * Two rules are tested repeatedly because they are the ones a real deployment
 * gets wrong: a non-member must not learn that an event exists (404, not 403),
 * and a member must not exceed their membership role (403).
 */

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

describe("GET /api/events/:id/members", () => {
  it("lets an event admin read their own event", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/members`, { cookie: w.adminA.cookie });

    expect(response.status).toBe(200);

    const body = response.json<MemberListPayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data.members.map((member) => member.displayName).sort()).toEqual([
      "Admin A",
      "Petugas A",
    ]);
  });

  it("lets a superadmin read any event", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventB}/members`, {
      cookie: w.superadmin.cookie,
    });

    expect(response.status).toBe(200);
  });

  it("returns 403 when a member has an insufficient role", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/members`, {
      cookie: w.officerA.cookie,
    });

    expect(response.status).toBe(403);
    expect(errorCode(response)).toBe("FORBIDDEN");
  });

  it("returns 404 instead of 403 for another event's admin (IDOR)", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/members`, { cookie: w.adminB.cookie });

    expect(response.status).toBe(404);
    expect(errorCode(response)).toBe("NOT_FOUND");
  });

  it("returns 404 for an event that does not exist", async () => {
    const w = await world();

    const response = await callApi("/api/events/01NOSUCHEVENT/members", {
      cookie: w.adminA.cookie,
    });

    expect(response.status).toBe(404);
  });
});

describe("POST /api/events/:id/invites", () => {
  it("creates a one-time invite and returns the token exactly once", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/invites`, {
      cookie: w.adminA.cookie,
      body: { role: "officer", invitedName: "Petugas Baru", expiresInHours: 24 },
    });

    expect(response.status).toBe(201);

    const body = response.json<InviteCreatedPayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data.token).toHaveLength(22); // 128 bits, base64url
    expect(body.data.activatePath).toBe(`/aktivasi#t=${body.data.token}`);
    expect(body.data.expiresAt).toBe(TEST_NOW + 24 * 60 * 60 * 1000);

    // Only the hash is stored.
    const row = await testEnv.DB.prepare("SELECT token_hash FROM invites WHERE id = ?")
      .bind(body.data.inviteId)
      .first<{ token_hash: string }>();
    expect(row?.token_hash).not.toBe(body.data.token);

    // Listing never returns the token again.
    const list = await callApi(`/api/events/${w.eventA}/invites`, { cookie: w.adminA.cookie });
    const text = JSON.stringify(await list.json());
    expect(text).not.toContain(body.data.token);
  });

  it("activates into the same event", async () => {
    const w = await world();

    const created = await callApi(`/api/events/${w.eventA}/invites`, {
      cookie: w.adminA.cookie,
      body: { role: "officer", invitedName: "Petugas Baru" },
    });
    const body = created.json<InviteCreatedPayload>();
    if (!body.ok) throw new Error("expected success");

    const activated = await callApi("/api/auth/activate", { body: { token: body.data.token } });
    const cookie = activated.sessionCookie();
    if (!cookie) throw new Error("no cookie");

    const me = await callApi("/api/auth/me", { cookie });
    const meBody = me.json<MePayload>();
    if (!meBody.ok) throw new Error("expected success");

    expect(meBody.data.memberships).toEqual([
      { eventId: w.eventA, eventName: "Acara A", role: "officer" },
    ]);
  });

  it("returns 403 for an officer", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/invites`, {
      cookie: w.officerA.cookie,
      body: { role: "officer" },
    });

    expect(response.status).toBe(403);
  });

  it("returns 404 for a non-member of the event", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventB}/invites`, {
      cookie: w.adminA.cookie,
      body: { role: "officer" },
    });

    expect(response.status).toBe(404);
  });

  it("rejects a superadmin role for an event invite", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/invites`, {
      cookie: w.adminA.cookie,
      body: { role: "superadmin" },
    });

    expect(response.status).toBe(400);
  });

  it("caps active invites at 50 per event", async () => {
    const w = await world();

    for (let i = 0; i < 50; i += 1) {
      await seedInvite({ role: "officer", eventId: w.eventA, createdBy: w.adminA.id });
    }

    const response = await callApi(`/api/events/${w.eventA}/invites`, {
      cookie: w.adminA.cookie,
      body: { role: "officer" },
    });

    expect(response.status).toBe(422);
    expect(errorCode(response)).toBe("BUSINESS_RULE");
  });
});

describe("DELETE /api/events/:id/invites/:inviteId", () => {
  it("deletes a pending invite", async () => {
    const w = await world();
    const invite = await seedInvite({ role: "officer", eventId: w.eventA, createdBy: w.adminA.id });

    const response = await callApi(`/api/events/${w.eventA}/invites/${invite.inviteId}`, {
      cookie: w.adminA.cookie,
      method: "DELETE",
    });

    expect(response.status).toBe(200);

    // The token no longer activates.
    const activation = await callApi("/api/auth/activate", { body: { token: invite.token } });
    expect(activation.status).toBe(401);
  });

  it("refuses to delete an invite from another event (IDOR)", async () => {
    const w = await world();
    const invite = await seedInvite({ role: "officer", eventId: w.eventB, createdBy: w.adminB.id });

    const response = await callApi(`/api/events/${w.eventA}/invites/${invite.inviteId}`, {
      cookie: w.adminA.cookie,
      method: "DELETE",
    });

    expect(response.status).toBe(404);

    const stillThere = await testEnv.DB.prepare("SELECT id FROM invites WHERE id = ?")
      .bind(invite.inviteId)
      .first<{ id: string }>();
    expect(stillThere?.id).toBe(invite.inviteId);
  });

  it("refuses to delete an invite that was already used", async () => {
    const w = await world();
    const invite = await seedInvite({ role: "officer", eventId: w.eventA, createdBy: w.adminA.id });

    await callApi("/api/auth/activate", { body: { token: invite.token } });

    const response = await callApi(`/api/events/${w.eventA}/invites/${invite.inviteId}`, {
      cookie: w.adminA.cookie,
      method: "DELETE",
    });

    expect(response.status).toBe(404);
  });
});

describe("POST /api/events/:id/members/:userId/revoke", () => {
  it("revokes the membership and kills the officer's session", async () => {
    const w = await world();

    const response = await callApi(
      `/api/events/${w.eventA}/members/${w.officerA.id}/revoke`,
      { cookie: w.adminA.cookie, method: "POST" },
    );

    expect(response.status).toBe(200);

    // Membership is gone from the list and from `me`.
    const members = await callApi(`/api/events/${w.eventA}/members`, { cookie: w.adminA.cookie });
    const body = members.json<MemberListPayload>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data.members.map((member) => member.userId)).not.toContain(w.officerA.id);

    // And the session no longer works anywhere.
    expect((await callApi("/api/auth/me", { cookie: w.officerA.cookie })).status).toBe(401);
  });

  it("refuses self-revocation", async () => {
    const w = await world();

    const response = await callApi(`/api/events/${w.eventA}/members/${w.adminA.id}/revoke`, {
      cookie: w.adminA.cookie,
      method: "POST",
    });

    expect(response.status).toBe(422);
    expect(errorCode(response)).toBe("BUSINESS_RULE");
  });

  it("returns 404 for someone who is not a member of that event", async () => {
    const w = await world();

    const response = await callApi(
      `/api/events/${w.eventA}/members/${w.adminB.id}/revoke`,
      { cookie: w.adminA.cookie, method: "POST" },
    );

    expect(response.status).toBe(404);
  });

  it("returns 404 when a non-member tries to revoke in another event", async () => {
    const w = await world();

    const response = await callApi(
      `/api/events/${w.eventB}/members/${w.adminB.id}/revoke`,
      { cookie: w.adminA.cookie, method: "POST" },
    );

    expect(response.status).toBe(404);
  });

  it("returns 403 when an officer tries to revoke a colleague", async () => {
    const w = await world();

    const response = await callApi(
      `/api/events/${w.eventA}/members/${w.adminA.id}/revoke`,
      { cookie: w.officerA.cookie, method: "POST" },
    );

    expect(response.status).toBe(403);
  });
});
