import type { ActivatePayload } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import {
  countRows,
  createEvent,
  createSession,
  createUser,
  loginViaInvite,
  seedInvite,
} from "./fixtures";
import { callApi, errorCode } from "./http";

/**
 * ADR-0013 / AC-050: public self-registration is gone.
 *
 * Admin Acara accounts are created only by claiming a Super Admin invitation.
 * The route is absent from the table, so it is a 404 — not a 403, and not an
 * endpoint kept alive behind a flag.
 */

describe("POST /api/auth/register", () => {
  it("is not a route and writes no user", async () => {
    const before = await countRows("users");

    const response = await callApi("/api/auth/register", {
      body: { displayName: "Sari" },
    });

    expect(response.status).toBe(404);
    expect(errorCode(response)).toBe("NOT_FOUND");
    expect(await countRows("users")).toBe(before);
  });

  it("does not create a session or recovery code either", async () => {
    await callApi("/api/auth/register", { body: { displayName: "Sari" } });

    expect(await countRows("sessions")).toBe(0);
    expect(await countRows("recovery_codes")).toBe(0);
  });
});

describe("AC-050: accounts come from invitations", () => {
  it("creates an event_admin only through an invite", async () => {
    const superadminId = await createUser({ role: "superadmin" });
    const eventId = await createEvent({ createdBy: superadminId });
    const invite = await seedInvite({
      role: "event_admin",
      eventId,
      invitedName: "Sari",
    });

    const response = await callApi("/api/auth/activate", {
      body: { token: invite.token },
    });

    expect(response.status).toBe(200);

    const body = response.json<ActivatePayload>();
    if (!body.ok) throw new Error("expected success");
    expect(body.data.user.role).toBe("event_admin");
  });

  it("revoking the membership kills the invitation session", async () => {
    const superadminId = await createUser({ role: "superadmin" });
    const eventId = await createEvent({ createdBy: superadminId });
    const superadminCookie = (await createSession(superadminId)).cookie;

    const officer = await loginViaInvite("officer", eventId);

    const revoked = await callApi(
      `/api/events/${eventId}/members/${officer.userId}/revoke`,
      { method: "POST", cookie: superadminCookie },
    );
    expect(revoked.status).toBe(200);

    const me = await callApi("/api/auth/me", { cookie: officer.cookie });
    expect(me.status).toBe(401);
    expect(errorCode(me)).toBe("UNAUTHENTICATED");
  });
});
