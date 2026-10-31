import type { ActivatePayload, MePayload } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import { randomToken } from "../domain/token";
import { addMembership, countRows, createEvent, createSession, createUser, seedInvite } from "./fixtures";
import { DAY_MS, TEST_NOW, callApi, errorCode } from "./http";
import { testEnv } from "./env";

/**
 * Invite activation is the only login path in the system (ADR-002). Every test
 * here asserts observable behaviour through the HTTP surface, not internals.
 */

describe("POST /api/auth/activate", () => {
  it("exchanges a valid invite for a session, membership, and one-time recovery code", async () => {
    const superadmin = await createUser({ role: "superadmin" });
    const eventId = await createEvent({ createdBy: superadmin });
    const invite = await seedInvite({ role: "officer", eventId, invitedName: "Budi" });

    const response = await callApi("/api/auth/activate", {
      body: { token: invite.token, label: "HP Budi" },
    });

    expect(response.status).toBe(200);

    const body = response.json<ActivatePayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data.user.displayName).toBe("Budi");
    expect(body.data.user.role).toBe("officer");
    expect(body.data.memberships).toEqual([
      { eventId, eventName: "Acara Uji", role: "officer" },
    ]);
    expect(body.data.recoveryCode).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){4}$/);

    const cookie = response.sessionCookie();
    expect(cookie).toContain("absensi_session=");

    const attributes = response.rawSetCookie() ?? "";
    expect(attributes).toContain("HttpOnly");
    expect(attributes).toContain("SameSite=Lax");
    expect(attributes).toContain("Path=/");
    expect(attributes).toContain("Max-Age=2592000");
  });

  it("never stores the raw invite token or session token", async () => {
    const eventId = await createEvent({ createdBy: await createUser({ role: "superadmin" }) });
    const invite = await seedInvite({ role: "officer", eventId });

    const response = await callApi("/api/auth/activate", { body: { token: invite.token } });
    const cookie = response.sessionCookie();
    const sessionToken = decodeURIComponent(cookie?.split("=")[1] ?? "");

    const sessions = await testEnv.DB.prepare("SELECT token_hash FROM sessions").all<{
      token_hash: string;
    }>();
    const invites = await testEnv.DB.prepare("SELECT token_hash FROM invites").all<{
      token_hash: string;
    }>();

    expect(sessions.results.map((row) => row.token_hash)).not.toContain(invite.token);
    expect(sessions.results.map((row) => row.token_hash)).not.toContain(sessionToken);
    expect(invites.results.map((row) => row.token_hash)).not.toContain(invite.token);
    // HMAC-SHA256, base64url: 43 characters.
    expect(sessions.results[0]?.token_hash).toHaveLength(43);
  });

  it("authenticates the new session immediately", async () => {
    const eventId = await createEvent({ createdBy: await createUser({ role: "superadmin" }) });
    const invite = await seedInvite({ role: "event_admin", eventId, invitedName: "Sari" });

    const activated = await callApi("/api/auth/activate", { body: { token: invite.token } });
    const cookie = activated.sessionCookie();
    if (!cookie) throw new Error("no cookie issued");

    const me = await callApi("/api/auth/me", { cookie });

    expect(me.status).toBe(200);

    const body = me.json<MePayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data.user.displayName).toBe("Sari");
    expect(body.data.memberships).toHaveLength(1);
    expect(body.data.memberships[0]?.role).toBe("event_admin");
  });

  it("rejects a replayed invite without writing a second user", async () => {
    const eventId = await createEvent({ createdBy: await createUser({ role: "superadmin" }) });
    const invite = await seedInvite({ role: "officer", eventId, invitedName: "Budi" });

    const first = await callApi("/api/auth/activate", { body: { token: invite.token } });
    expect(first.status).toBe(200);

    const usersAfterFirst = await countRows("users");

    const second = await callApi("/api/auth/activate", { body: { token: invite.token } });

    expect(second.status).toBe(401);
    expect(errorCode(second)).toBe("UNAUTHENTICATED");
    expect(await countRows("users")).toBe(usersAfterFirst);
    expect(await countRows("sessions")).toBe(1);
  });

  it("marks the invite as used with the activating user", async () => {
    const eventId = await createEvent({ createdBy: await createUser({ role: "superadmin" }) });
    const invite = await seedInvite({ role: "officer", eventId });

    const response = await callApi("/api/auth/activate", { body: { token: invite.token } });
    const body = response.json<ActivatePayload>();
    if (!body.ok) throw new Error("expected success");

    const row = await testEnv.DB.prepare("SELECT used_at, used_by FROM invites WHERE id = ?")
      .bind(invite.inviteId)
      .first<{ used_at: number | null; used_by: string | null }>();

    expect(row?.used_at).toBe(TEST_NOW);
    expect(row?.used_by).toBe(body.data.user.id);
  });

  it("rejects an expired invite", async () => {
    const eventId = await createEvent({ createdBy: await createUser({ role: "superadmin" }) });
    const invite = await seedInvite({
      role: "officer",
      eventId,
      expiresAt: TEST_NOW - 1,
    });

    const response = await callApi("/api/auth/activate", { body: { token: invite.token } });

    expect(response.status).toBe(401);
    expect(await countRows("users")).toBe(1); // only the superadmin fixture
  });

  it("gives an unknown token the same answer as an expired one", async () => {
    const eventId = await createEvent({ createdBy: await createUser({ role: "superadmin" }) });
    const expired = await seedInvite({ role: "officer", eventId, expiresAt: TEST_NOW - 1 });

    const expiredResponse = await callApi("/api/auth/activate", { body: { token: expired.token } });
    const unknownResponse = await callApi("/api/auth/activate", {
      body: { token: randomToken(16) },
    });

    expect(expiredResponse.status).toBe(unknownResponse.status);
    expect(expiredResponse.body).toEqual(unknownResponse.body);
  });

  it("rejects a token that is one character off", async () => {
    const eventId = await createEvent({ createdBy: await createUser({ role: "superadmin" }) });
    const invite = await seedInvite({ role: "officer", eventId });
    const tampered = `${invite.token.slice(0, -1)}${invite.token.endsWith("A") ? "B" : "A"}`;

    const response = await callApi("/api/auth/activate", { body: { token: tampered } });

    expect(response.status).toBe(401);
  });

  it("validates the body with field-level errors", async () => {
    const response = await callApi("/api/auth/activate", { body: { token: "" } });

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe("VALIDATION_ERROR");
    if (response.body.ok) throw new Error("expected failure");
    expect(response.body.error.details).toMatchObject({ fieldErrors: { token: expect.any(Array) } });
  });

  it("rate limits repeated attempts per client", async () => {
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await callApi("/api/auth/activate", {
        body: { token: randomToken(16) },
      });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 10)).toEqual(Array<number>(10).fill(401));
    expect(statuses[10]).toBe(429);

    const limited = await callApi("/api/auth/activate", { body: { token: randomToken(16) } });
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });
});

describe("session lifetime", () => {
  it("rejects a session past its expiry", async () => {
    const userId = await createUser({ role: "officer" });
    const session = await createSession(userId, { expiresAt: TEST_NOW + DAY_MS });

    const fresh = await callApi("/api/auth/me", { cookie: session.cookie });
    expect(fresh.status).toBe(200);

    const later = await callApi("/api/auth/me", { cookie: session.cookie, now: TEST_NOW + DAY_MS });

    expect(later.status).toBe(401);
    expect(errorCode(later)).toBe("UNAUTHENTICATED");
  });

  it("rejects a revoked session", async () => {
    const userId = await createUser({ role: "officer" });
    const session = await createSession(userId, { revokedAt: TEST_NOW - 1000 });

    const response = await callApi("/api/auth/me", { cookie: session.cookie });

    expect(response.status).toBe(401);
  });

  it("rejects a tampered cookie instead of falling back to an anonymous session", async () => {
    const userId = await createUser({ role: "officer" });
    const session = await createSession(userId);

    const response = await callApi("/api/auth/me", {
      cookie: `absensi_session=${session.token}tampered`,
    });

    expect(response.status).toBe(401);
  });

  it("rejects a valid session belonging to a suspended user", async () => {
    const userId = await createUser({ role: "officer", status: "suspended" });
    const session = await createSession(userId);

    const response = await callApi("/api/auth/me", { cookie: session.cookie });

    expect(response.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  it("revokes the active session and clears the cookie", async () => {
    const userId = await createUser({ role: "officer" });
    const session = await createSession(userId);

    const logout = await callApi("/api/auth/logout", { cookie: session.cookie, method: "POST" });

    expect(logout.status).toBe(200);
    expect(logout.rawSetCookie()).toContain("Max-Age=0");

    const after = await callApi("/api/auth/me", { cookie: session.cookie });
    expect(after.status).toBe(401);
  });

  it("does not revoke a different session of the same user", async () => {
    const userId = await createUser({ role: "officer" });
    const first = await createSession(userId);
    const second = await createSession(userId);

    await callApi("/api/auth/logout", { cookie: first.cookie, method: "POST" });

    const revoked = await callApi("/api/auth/me", { cookie: first.cookie });
    expect(revoked.status).toBe(401);

    const stillValid = await callApi("/api/auth/me", { cookie: second.cookie });
    expect(stillValid.status).toBe(200);
  });
});

/** Membership row created but never used: proves activation does not require it. */
describe("activation edge cases", () => {
  it("creates the membership row exactly once for an event invite", async () => {
    const eventId = await createEvent({ createdBy: await createUser({ role: "superadmin" }) });
    const invite = await seedInvite({ role: "officer", eventId });

    await callApi("/api/auth/activate", { body: { token: invite.token } });

    expect(await countRows("event_memberships")).toBe(1);
  });

  it("supports the bootstrap superadmin invite that has no event", async () => {
    const invite = await seedInvite({ role: "superadmin", invitedName: "Pemilik" });

    const response = await callApi("/api/auth/activate", { body: { token: invite.token } });
    const body = response.json<ActivatePayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data.user.role).toBe("superadmin");
    expect(body.data.memberships).toEqual([]);
    expect(await countRows("event_memberships")).toBe(0);
  });

  it("re-activates an existing user through a targeted invite", async () => {
    const eventId = await createEvent({ createdBy: await createUser({ role: "superadmin" }) });
    const officerId = await createUser({ role: "officer", displayName: "Petugas Lama" });
    await addMembership(eventId, officerId, "officer");

    const invite = await seedInvite({ role: "officer", eventId, targetUserId: officerId });
    const response = await callApi("/api/auth/activate", { body: { token: invite.token } });

    expect(response.status).toBe(200);
    expect(await countRows("users")).toBe(2);
    expect(await countRows("event_memberships")).toBe(1);
  });
});
