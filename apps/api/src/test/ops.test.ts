import type { AdminUsagePayload, ApiResponse, ReadyPayload } from "@absensi/shared";
import { SECURITY_HEADERS } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import { handleRequest } from "../app";
import type { Env } from "../env";
import { createEvent, createParticipant, createSession, createUser } from "./fixtures";
import { TEST_NOW, callApi, errorCode } from "./http";
import { testEnv } from "./env";

/**
 * Fase 6 operational surface: readiness probe, usage snapshot, and the security
 * headers that must ride on every response (DESAIN_API.md §9, ADR-008).
 */

describe("GET /api/health/ready", () => {
  it("proves the D1 binding works and is reachable without a session", async () => {
    const response = await callApi("/api/health/ready");

    expect(response.status).toBe(200);

    const body = response.json<ReadyPayload>();
    expect(body.ok).toBe(true);
    if (!body.ok) throw new Error("unreachable");

    expect(body.data.status).toBe("ready");
    expect(body.data.database).toBe("ok");
    expect(body.data.timestamp).toBe(TEST_NOW);
  });

  it("answers 503 DB_UNAVAILABLE when the database rejects the probe", async () => {
    const brokenEnv = {
      ...testEnv,
      DB: {
        prepare() {
          throw new Error("D1_ERROR: connection refused");
        },
      },
    } as unknown as Env;

    const response = await handleRequest(
      new Request("https://absensi.test/api/health/ready"),
      brokenEnv,
      { now: () => TEST_NOW },
    );

    expect(response.status).toBe(503);

    const body = (await response.json()) as ApiResponse<never>;
    expect(body.ok).toBe(false);
    if (body.ok) throw new Error("unreachable");
    expect(body.error.code).toBe("DB_UNAVAILABLE");
  });
});

describe("GET /api/admin/usage", () => {
  it("returns counts for a superadmin", async () => {
    const superadminId = await createUser({ role: "superadmin" });
    const session = await createSession(superadminId);
    await createEvent({ createdBy: superadminId });

    const response = await callApi("/api/admin/usage", {
      cookie: session.cookie,
      now: TEST_NOW,
    });

    expect(response.status).toBe(200);

    const body = response.json<AdminUsagePayload>();
    if (!body.ok) throw new Error(JSON.stringify(body));

    expect(body.data.generatedAt).toBe(TEST_NOW);
    expect(body.data.counts.users).toBe(1);
    expect(body.data.counts.events).toBe(1);
    expect(body.data.counts.activeSessions).toBe(1);
    expect(body.data.counts.participants).toBe(0);
    expect(body.data.counts.outbox).toEqual({ queued: 0, failed: 0, dead: 0 });
  });

  it.each([["event_admin"], ["officer"]] as const)(
    "refuses an %s, who may not see cross-tenant counters",
    async (role) => {
      const userId = await createUser({ role });
      const session = await createSession(userId);

      const response = await callApi("/api/admin/usage", { cookie: session.cookie });

      expect(response.status).toBe(403);
      expect(errorCode(response)).toBe("FORBIDDEN");
    },
  );

  it("counts queued outbox rows as pending plus inflight", async () => {
    const superadminId = await createUser({ role: "superadmin" });
    const session = await createSession(superadminId);
    const eventId = await createEvent({ createdBy: superadminId });
    const participant = await createParticipant(eventId);

    await testEnv.DB.prepare(
      `INSERT INTO outbox
         (id, event_id, participant_id, kind, status, attempts, next_attempt_at, created_at, updated_at)
       VALUES (?, ?, ?, 'attendance', 'pending', 0, ?, ?, ?)`,
    )
      .bind("OUTBOX-PENDING", eventId, participant.id, TEST_NOW, TEST_NOW, TEST_NOW)
      .run();

    const response = await callApi("/api/admin/usage", { cookie: session.cookie });

    const body = response.json<AdminUsagePayload>();
    if (!body.ok) throw new Error(JSON.stringify(body));

    expect(body.data.counts.outbox.queued).toBe(1);
  });
});

describe("security headers", () => {
  it("rides on successful API responses", async () => {
    const response = await callApi("/api/health");

    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
  });

  it("rides on error responses too", async () => {
    const response = await callApi("/api/auth/me"); // 401

    expect(response.status).toBe(401);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("rides on the unmatched-endpoint 404", async () => {
    const response = await callApi("/api/nope");

    expect(response.status).toBe(404);
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("allows the camera only for this origin, because the scanner needs it", () => {
    expect(SECURITY_HEADERS["permissions-policy"]).toContain("camera=(self)");
    expect(SECURITY_HEADERS["permissions-policy"]).toContain("geolocation=()");
  });
});
