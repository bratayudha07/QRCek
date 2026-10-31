import type { SessionListPayload } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import { createSession, createUser } from "./fixtures";
import { TEST_NOW, callApi, errorCode } from "./http";

/**
 * Device/session management (DESAIN_API.md §2). Every lookup is scoped by the
 * session's own `user_id`, so a valid session id belonging to another user must
 * look exactly like a nonexistent one.
 */

describe("GET /api/auth/sessions", () => {
  it("lists active sessions and marks the current one", async () => {
    const userId = await createUser({ role: "officer" });
    const current = await createSession(userId, { label: "HP kantor" });
    await createSession(userId, { label: "Tablet" });

    const response = await callApi("/api/auth/sessions", { cookie: current.cookie });

    expect(response.status).toBe(200);

    const body = response.json<SessionListPayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data.sessions).toHaveLength(2);
    expect(body.data.sessions.filter((session) => session.current)).toHaveLength(1);
    expect(body.data.sessions.find((session) => session.current)?.id).toBe(current.sessionId);
    expect(body.data.sessions.map((session) => session.label).sort()).toEqual(["HP kantor", "Tablet"]);
  });

  it("hides expired and revoked sessions", async () => {
    const userId = await createUser({ role: "officer" });
    const current = await createSession(userId);
    await createSession(userId, { expiresAt: TEST_NOW - 1 });
    await createSession(userId, { revokedAt: TEST_NOW - 1 });

    const response = await callApi("/api/auth/sessions", { cookie: current.cookie });
    const body = response.json<SessionListPayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data.sessions).toHaveLength(1);
  });
});

describe("POST /api/auth/sessions/:id/revoke", () => {
  it("revokes another session of the same user", async () => {
    const userId = await createUser({ role: "officer" });
    const current = await createSession(userId);
    const other = await createSession(userId);

    const response = await callApi(`/api/auth/sessions/${other.sessionId}/revoke`, {
      cookie: current.cookie,
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect((await callApi("/api/auth/me", { cookie: other.cookie })).status).toBe(401);
    expect((await callApi("/api/auth/me", { cookie: current.cookie })).status).toBe(200);
  });

  it("returns 404 for an unknown session id", async () => {
    const userId = await createUser({ role: "officer" });
    const current = await createSession(userId);

    const response = await callApi("/api/auth/sessions/01NOTAREALSESSION/revoke", {
      cookie: current.cookie,
      method: "POST",
    });

    expect(response.status).toBe(404);
    expect(errorCode(response)).toBe("NOT_FOUND");
  });

  it("refuses to revoke a session belonging to someone else (IDOR)", async () => {
    const attacker = await createUser({ role: "event_admin" });
    const victim = await createUser({ role: "officer" });

    const attackerSession = await createSession(attacker);
    const victimSession = await createSession(victim);

    const response = await callApi(`/api/auth/sessions/${victimSession.sessionId}/revoke`, {
      cookie: attackerSession.cookie,
      method: "POST",
    });

    expect(response.status).toBe(404);
    // The victim is still logged in: nothing leaked, nothing changed.
    expect((await callApi("/api/auth/me", { cookie: victimSession.cookie })).status).toBe(200);
  });
});
