import type { ActivatePayload, EventDetailPayload } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import { createEvent, createUser, countRows, loginViaInvite } from "./fixtures";
import { callApi, errorCode } from "./http";
import { testEnv } from "./env";

/**
 * ADR-007: public self-service registration.
 *
 * The security property is not "the account is verified" (it is not — there is
 * no email in this system). It is "a self-registered account can only ever
 * touch events it created itself". Every test below asserts either that
 * boundary or the abuse limits around the public endpoint.
 */

describe("POST /api/auth/register", () => {
  it("creates an event_admin scoped to itself, with a session and one-time recovery code", async () => {
    const response = await callApi("/api/auth/register", {
      body: { displayName: "Sari" },
    });

    expect(response.status).toBe(201);

    const body = response.json<ActivatePayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data.user.displayName).toBe("Sari");
    expect(body.data.user.role).toBe("event_admin");
    // No memberships: registering grants no access to any existing event.
    expect(body.data.memberships).toEqual([]);
    expect(body.data.recoveryCode).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){4}$/);

    const cookie = response.rawSetCookie() ?? "";
    expect(cookie).toContain("absensi_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    const row = await testEnv.DB.prepare("SELECT role, created_via FROM users WHERE id = ?")
      .bind(body.data.user.id)
      .first<{ role: string; created_via: string }>();

    expect(row).toEqual({ role: "event_admin", created_via: "self_signup" });
  });

  it("never stores the raw recovery code or session token", async () => {
    const response = await callApi("/api/auth/register", { body: { displayName: "Sari" } });
    const body = response.json<ActivatePayload>();
    if (!body.ok) throw new Error("expected success");

    const stored = await testEnv.DB.prepare(
      "SELECT code_hash FROM recovery_codes WHERE user_id = ?",
    )
      .bind(body.data.user.id)
      .first<{ code_hash: string }>();

    expect(stored?.code_hash).toBeTruthy();
    expect(stored?.code_hash).not.toContain(body.data.recoveryCode);
    // base64url HMAC-SHA256: 32 bytes → 43 chars, never the plaintext code.
    expect(stored?.code_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("lets the new admin create its own event and become its admin", async () => {
    const registered = await callApi("/api/auth/register", {
      body: { displayName: "Sari" },
    });
    const cookie = registered.sessionCookie();
    if (!cookie) throw new Error("expected a session cookie");

    const created = await callApi("/api/events", {
      method: "POST",
      cookie,
      body: {
        name: "Seminar Sari",
        timezone: "Asia/Jakarta",
        allowManual: false,
      },
    });

    expect(created.status).toBe(201);

    const payload = created.json<EventDetailPayload>();
    if (!payload.ok) throw new Error("expected success");
    expect(payload.data.event.accessRole).toBe("event_admin");

    const me = await callApi("/api/auth/me", { cookie });
    const meBody = me.json<{ user: { role: string }; memberships: { role: string }[] }>();
    if (!meBody.ok) throw new Error("expected success");

    expect(meBody.data.memberships).toHaveLength(1);
    expect(meBody.data.memberships[0]?.role).toBe("event_admin");
  });

  it("cannot read an event created by someone else", async () => {
    const owner = await createUser({ role: "event_admin" });
    const foreignEventId = await createEvent({ createdBy: owner });

    const registered = await callApi("/api/auth/register", { body: { displayName: "Penyusup" } });
    const cookie = registered.sessionCookie();

    const response = await callApi(`/api/events/${foreignEventId}`, { cookie });

    // 404, not 403: the API must not confirm that someone else's event exists.
    expect(response.status).toBe(404);
    expect(errorCode(response)).toBe("NOT_FOUND");
  });

  it("sees an empty dashboard, not other people's events", async () => {
    const owner = await createUser({ role: "event_admin" });
    await createEvent({ createdBy: owner });

    const registered = await callApi("/api/auth/register", { body: { displayName: "Sari" } });
    const cookie = registered.sessionCookie();

    const response = await callApi("/api/dashboard", { cookie });

    expect(response.status).toBe(200);
    const body = response.json<{ events: unknown[] }>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data.events).toEqual([]);
  });

  it("ignores an attempt to pick a role", async () => {
    const response = await callApi("/api/auth/register", {
      body: { displayName: "Sari", role: "superadmin" },
    });

    // `.strict()` rejects unknown keys instead of silently dropping them.
    expect(response.status).toBe(400);
    expect(await countRows("users")).toBe(0);
  });

  it("rejects a display name that is too short", async () => {
    const response = await callApi("/api/auth/register", { body: { displayName: "x" } });

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe("VALIDATION_ERROR");
  });

  it("requires the CSRF header like every other non-GET request", async () => {
    const response = await callApi("/api/auth/register", {
      body: { displayName: "Sari" },
      csrf: false,
    });

    expect(response.status).toBe(403);
    expect(errorCode(response)).toBe("CSRF_FAILED");
    expect(await countRows("users")).toBe(0);
  });

  it("rate limits registration per client", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const ok = await callApi("/api/auth/register", { body: { displayName: `Akun ${attempt}` } });
      expect(ok.status).toBe(201);
    }

    const blocked = await callApi("/api/auth/register", { body: { displayName: "Akun 6" } });

    expect(blocked.status).toBe(429);
    expect(errorCode(blocked)).toBe("RATE_LIMITED");
    expect(await countRows("users")).toBe(5);
  });

  it("gives a registered admin a recovery code that works for the next login", async () => {
    const registered = await callApi("/api/auth/register", { body: { displayName: "Sari" } });
    const body = registered.json<ActivatePayload>();
    if (!body.ok) throw new Error("expected success");

    const login = await callApi("/api/auth/recover", {
      body: { recoveryCode: body.data.recoveryCode },
    });

    expect(login.status).toBe(200);
    const loginBody = login.json<ActivatePayload>();
    if (!loginBody.ok) throw new Error("expected success");
    expect(loginBody.data.user.id).toBe(body.data.user.id);
  });

  it("does not disturb the invite path", async () => {
    const eventId = await createEvent({ createdBy: await createUser({ role: "superadmin" }) });
    const session = await loginViaInvite("officer", eventId);

    const me = await callApi("/api/auth/me", { cookie: session.cookie });
    expect(me.status).toBe(200);
  });
});
