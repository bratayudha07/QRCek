import type { ActivatePayload } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import { createEvent, createSession, createUser, loginViaInvite } from "./fixtures";
import { TEST_NOW, callApi, errorCode } from "./http";

/**
 * Recovery is the "lost device" path: it must hand back access while making
 * every old session useless. Anything less would mean a stolen phone keeps a
 * working session forever.
 */

async function world() {
  const superadmin = await createUser({ role: "superadmin" });
  const eventId = await createEvent({ createdBy: superadmin });
  return loginViaInvite("officer", eventId);
}

describe("POST /api/auth/recover", () => {
  it("issues a new session and a new recovery code", async () => {
    const { cookie, recoveryCode } = await world();

    const response = await callApi("/api/auth/recover", {
      body: { recoveryCode, label: "HP baru" },
    });

    expect(response.status).toBe(200);

    const body = response.json<ActivatePayload>();
    if (!body.ok) throw new Error("expected success");

    expect(body.data.user.role).toBe("officer");
    expect(body.data.recoveryCode).not.toBe(recoveryCode);
    expect(response.sessionCookie()).toContain("absensi_session=");

    const me = await callApi("/api/auth/me", { cookie: response.sessionCookie() });
    expect(me.status).toBe(200);

    // The old device is no longer trusted.
    const oldDevice = await callApi("/api/auth/me", { cookie });
    expect(oldDevice.status).toBe(401);
  });

  it("accepts the code typed with lowercase and spaces", async () => {
    const { recoveryCode } = await world();
    const messy = ` ${recoveryCode.toLowerCase().replace(/-/g, " ")} `;

    const response = await callApi("/api/auth/recover", { body: { recoveryCode: messy } });

    expect(response.status).toBe(200);
  });

  it("rejects a code that was already used", async () => {
    const { recoveryCode } = await world();

    const first = await callApi("/api/auth/recover", { body: { recoveryCode } });
    expect(first.status).toBe(200);

    const replay = await callApi("/api/auth/recover", { body: { recoveryCode } });

    expect(replay.status).toBe(401);
    expect(errorCode(replay)).toBe("UNAUTHENTICATED");
  });

  it("gives a used code the same answer as an unknown one", async () => {
    const { recoveryCode } = await world();

    // First use succeeds, which marks the code as used.
    expect((await callApi("/api/auth/recover", { body: { recoveryCode } })).status).toBe(200);

    const used = await callApi("/api/auth/recover", { body: { recoveryCode } });
    const unknown = await callApi("/api/auth/recover", {
      body: { recoveryCode: "ABCD-EFGH-IJKL-MNOP-QRST" },
    });

    expect(used.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(used.body).toEqual(unknown.body);
  });

  it("rate limits recovery attempts harder than activation", async () => {
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await callApi("/api/auth/recover", {
        body: { recoveryCode: "ABCD-EFGH-IJKL-MNOP-QRST" },
      });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 5)).toEqual(Array<number>(5).fill(401));
    expect(statuses[5]).toBe(429);
  });

  it("validates the code length before hitting the database", async () => {
    const response = await callApi("/api/auth/recover", { body: { recoveryCode: "short" } });

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/auth/recovery-code", () => {
  it("rotates the code and invalidates the previous one", async () => {
    const { cookie, recoveryCode: oldCode } = await world();

    const rotated = await callApi("/api/auth/recovery-code", { cookie, method: "POST" });
    expect(rotated.status).toBe(200);

    const body = rotated.json<{ recoveryCode: string }>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data.recoveryCode).not.toBe(oldCode);

    const oldCodeAttempt = await callApi("/api/auth/recover", { body: { recoveryCode: oldCode } });
    expect(oldCodeAttempt.status).toBe(401);

    const newCodeAttempt = await callApi("/api/auth/recover", {
      body: { recoveryCode: body.data.recoveryCode },
    });
    expect(newCodeAttempt.status).toBe(200);
  });

  it("requires a session", async () => {
    const response = await callApi("/api/auth/recovery-code", { method: "POST" });

    expect(response.status).toBe(401);
  });
});

describe("recovery does not touch other users", () => {
  it("only revokes the sessions of the recovering user", async () => {
    const { recoveryCode } = await world();

    const other = await createUser({ role: "officer" });
    const otherLogin = await createSession(other);

    const recovered = await callApi("/api/auth/recover", {
      body: { recoveryCode },
      now: TEST_NOW + 1000,
    });
    expect(recovered.status).toBe(200);

    const stillValid = await callApi("/api/auth/me", {
      cookie: otherLogin.cookie,
      now: TEST_NOW + 1000,
    });
    expect(stillValid.status).toBe(200);
  });
});
