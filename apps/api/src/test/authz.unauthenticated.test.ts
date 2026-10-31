import { describe, expect, it } from "vitest";

import { ROUTES } from "../app";
import { TEST_NOW, callApi, errorCode } from "./http";

/**
 * Deny-by-default gate.
 *
 * The test iterates the real route table, so adding an endpoint without a
 * session guard (or accidentally marking it `public`) fails here instead of
 * shipping. This is the automated version of "Otorisasi selalu dievaluasi di
 * Worker pada setiap route".
 */

const PROTECTED = ROUTES.filter((route) => !route.public);
const PUBLIC = ROUTES.filter((route) => route.public);

function concretePath(pattern: string): string {
  return pattern.replace(/:[A-Za-z]+/g, "01TESTID");
}

describe("unauthenticated access", () => {
  it("has exactly the documented protected routes", () => {
    expect(PROTECTED.map((route) => `${route.method} ${route.pattern}`).sort()).toEqual(
      [
        "GET /api/auth/me",
        "GET /api/auth/sessions",
        "GET /api/events/:eventId/invites",
        "GET /api/events/:eventId/members",
        "POST /api/auth/logout",
        "POST /api/auth/recovery-code",
        "POST /api/auth/sessions/:sessionId/revoke",
        "POST /api/events/:eventId/invites",
        "POST /api/events/:eventId/members/:userId/revoke",
        "DELETE /api/events/:eventId/invites/:inviteId",
      ].sort(),
    );
  });

  it("rejects every protected route without a session", async () => {
    const failures: string[] = [];

    for (const route of PROTECTED) {
      const response = await callApi(concretePath(route.pattern), {
        method: route.method,
        body: route.method === "GET" ? undefined : {},
        now: TEST_NOW,
      });

      if (response.status !== 401 || errorCode(response) !== "UNAUTHENTICATED") {
        failures.push(`${route.method} ${route.pattern} → ${response.status} ${errorCode(response)}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("publishes exactly the three intended endpoints", () => {
    expect(PUBLIC.map((route) => `${route.method} ${route.pattern}`).sort()).toEqual([
      "GET /api/health",
      "POST /api/auth/activate",
      "POST /api/auth/recover",
    ]);
  });
});

describe("CSRF protection", () => {
  it("rejects a state-changing request without the CSRF header", async () => {
    const response = await callApi("/api/auth/logout", {
      method: "POST",
      csrf: false,
      cookie: "absensi_session=whatever",
    });

    expect(response.status).toBe(403);
    expect(errorCode(response)).toBe("CSRF_FAILED");
  });

  it("rejects a request whose Origin does not match the host", async () => {
    const response = await callApi("/api/auth/logout", {
      method: "POST",
      origin: "https://evil.example",
      cookie: "absensi_session=whatever",
    });

    expect(response.status).toBe(403);
    expect(errorCode(response)).toBe("CSRF_FAILED");
  });

  it("rejects a request with no Origin at all", async () => {
    const response = await callApi("/api/auth/logout", {
      method: "POST",
      origin: null,
      cookie: "absensi_session=whatever",
    });

    expect(response.status).toBe(403);
    expect(errorCode(response)).toBe("CSRF_FAILED");
  });

  it("checks CSRF before authentication, so a probe cannot learn if a session exists", async () => {
    const response = await callApi("/api/auth/logout", { method: "POST", csrf: false });

    expect(response.status).toBe(403);
    expect(errorCode(response)).toBe("CSRF_FAILED");
  });

  it("does not require CSRF headers on safe methods", async () => {
    const response = await callApi("/api/auth/me", { csrf: false });

    // 401, not 403: the request was allowed through to authentication.
    expect(response.status).toBe(401);
    expect(errorCode(response)).toBe("UNAUTHENTICATED");
  });

  it("does not accept a different CSRF header value", async () => {
    const response = await callApi("/api/auth/logout", {
      method: "POST",
      csrf: false,
      headers: { "x-absensi-csrf": "true" },
    });

    expect(response.status).toBe(403);
  });
});
