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
        "GET /api/admin/usage",
        "GET /api/dashboard",
        "GET /api/events",
        "GET /api/events/:eventId",
        "GET /api/events/:eventId/activities",
        "GET /api/events/:eventId/activities/:activityId",
        "GET /api/events/:eventId/activities/:activityId/entitlements",
        "GET /api/events/:eventId/activities/:activityId/entitlements/resolve",
        "GET /api/events/:eventId/activities/:activityId/sessions",
        "GET /api/events/:eventId/activities/:activityId/sessions/:sessionId",
        "GET /api/events/:eventId/assignments",
        "GET /api/events/:eventId/attendance",
        "GET /api/events/:eventId/attendance/export",
        "GET /api/events/:eventId/audit",
        "GET /api/events/:eventId/categories",
        "GET /api/events/:eventId/categories/:categoryId",
        "GET /api/events/:eventId/custom-fields",
        "GET /api/events/:eventId/custom-fields/:fieldId",
        "GET /api/events/:eventId/dashboard",
        "GET /api/events/:eventId/entitlements/default",
        "GET /api/events/:eventId/invites",
        "GET /api/events/:eventId/label-config",
        "GET /api/events/:eventId/members",
        "GET /api/events/:eventId/participants",
        "GET /api/events/:eventId/participants/:participantId",
        "GET /api/events/:eventId/participants/:participantId/qr",
        "GET /api/events/:eventId/participants/export",
        "GET /api/events/:eventId/participants/template",
        "GET /api/events/:eventId/summary",
        "GET /api/events/:eventId/sync",
        "GET /api/events/:eventId/sync/outbox",
        "GET /api/events/:eventId/transactions",
        "GET /api/staff/assignments",
        "GET /api/staff/attendance",
        "POST /api/auth/logout",
        "POST /api/auth/recovery-code",
        "POST /api/auth/sessions/:sessionId/revoke",
        "POST /api/events",
        "POST /api/events/:eventId/activities",
        "POST /api/events/:eventId/activities/:activityId/sessions",
        "POST /api/events/:eventId/activities/:activityId/sessions/:sessionId/archive",
        "POST /api/events/:eventId/activities/:activityId/sessions/:sessionId/duplicate",
        "POST /api/events/:eventId/activities/:activityId/sessions/:sessionId/status",
        "POST /api/events/:eventId/activities/:activityId/status",
        "POST /api/events/:eventId/assignments",
        "POST /api/events/:eventId/assignments/:assignmentId/revoke",
        "POST /api/events/:eventId/attendance/manual",
        "POST /api/events/:eventId/categories",
        "POST /api/events/:eventId/categories/:categoryId/status",
        "POST /api/events/:eventId/custom-fields",
        "POST /api/events/:eventId/custom-fields/:fieldId/status",
        "POST /api/events/:eventId/custom-fields/:fieldId/type",
        "POST /api/events/:eventId/invites",
        "POST /api/events/:eventId/members/:userId/revoke",
        "POST /api/events/:eventId/participants",
        "POST /api/events/:eventId/participants/import",
        "POST /api/events/:eventId/participants/qr-labels",
        "POST /api/events/:eventId/scan",
        "POST /api/events/:eventId/status",
        "POST /api/events/:eventId/sync/full",
        "POST /api/events/:eventId/sync/outbox/:outboxId/retry",
        "POST /api/events/:eventId/sync/run",
        "POST /api/events/:eventId/sync/test",
        "POST /api/events/:eventId/transactions/:transactionId/adjustment",
        "POST /api/events/:eventId/transactions/:transactionId/reversal",
        "PATCH /api/events/:eventId",
        "PATCH /api/events/:eventId/activities/:activityId",
        "PATCH /api/events/:eventId/activities/:activityId/sessions/:sessionId",
        "PATCH /api/events/:eventId/assignments/:assignmentId",
        "PATCH /api/events/:eventId/categories/:categoryId",
        "PATCH /api/events/:eventId/custom-fields/:fieldId",
        "PATCH /api/events/:eventId/participants/:participantId",
        "PUT /api/events/:eventId/label-config",
        "PUT /api/events/:eventId/participants/:participantId/qr/rotate",
        "PUT /api/events/:eventId/sync",
        "PUT /api/events/:eventId/entitlements/default",
        "PUT /api/events/:eventId/activities/:activityId/entitlements/categories",
        "PUT /api/events/:eventId/activities/:activityId/sessions/:sessionId/entitlements/categories",
        "PUT /api/events/:eventId/activities/:activityId/entitlements/participants/:participantId",
        "PUT /api/events/:eventId/activities/:activityId/sessions/:sessionId/entitlements/participants/:participantId",
        "DELETE /api/events/:eventId",
        "DELETE /api/events/:eventId/entitlements/default",
        "DELETE /api/events/:eventId/activities/:activityId/entitlements/participants/:participantId",
        "DELETE /api/events/:eventId/activities/:activityId/sessions/:sessionId/entitlements/participants/:participantId",
        "DELETE /api/events/:eventId/invites/:inviteId",
        "DELETE /api/events/:eventId/participants/:participantId",
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

  it("publishes exactly the four intended endpoints", () => {
    expect(PUBLIC.map((route) => `${route.method} ${route.pattern}`).sort()).toEqual([
      "GET /api/health",
      "GET /api/health/ready",
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

  /**
   * Regression: `assertCsrf` used to run only for non-public routes, so
   * `/api/auth/activate` and `/api/auth/recover` accepted cross-site POSTs
   * (login-CSRF). AGENTS.md and docs/adr/0002 require every non-GET
   * request to carry the header and a matching Origin, public route or not.
   */
  it.each([["/api/auth/activate"], ["/api/auth/recover"]])(
    "rejects %s without the CSRF header, even though the route is public",
    async (path) => {
      const response = await callApi(path, { method: "POST", csrf: false, body: {} });

      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe("CSRF_FAILED");
    },
  );

  it.each([["/api/auth/activate"], ["/api/auth/recover"]])(
    "rejects %s when Origin does not match the host",
    async (path) => {
      const response = await callApi(path, {
        method: "POST",
        body: {},
        origin: "https://evil.example",
      });

      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe("CSRF_FAILED");
    },
  );
});
