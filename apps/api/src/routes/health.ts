import { API_VERSION } from "@absensi/shared";
import type { HealthPayload, ReadyPayload } from "@absensi/shared";

import { dbUnavailable } from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";

/**
 * Liveness and readiness (DESAIN_API.md §9).
 *
 * `/api/health` stays DB-free on purpose: it answers "is the Worker deployed?",
 * so it must not fail when D1 is having a bad minute. `/api/health/ready` does
 * one `SELECT 1` and reports 503 when the binding is unusable, which is what an
 * external monitor should page on.
 */

function health(ctx: RouteContext): RouteResult {
  const payload: HealthPayload = {
    service: "absensi-api",
    version: API_VERSION,
    status: "ok",
    timestamp: ctx.now,
  };

  return { data: payload };
}

async function readiness(ctx: RouteContext): Promise<RouteResult> {
  try {
    await ctx.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  } catch (error) {
    // The probe failed, so the failure itself is expected. Log the class only:
    // a message could echo a binding name or connection detail.
    console.error("readiness_db_unreachable", {
      reason: error instanceof Error ? error.name : "unknown",
    });

    throw dbUnavailable();
  }

  const payload: ReadyPayload = {
    service: "absensi-api",
    version: API_VERSION,
    status: "ready",
    database: "ok",
    timestamp: ctx.now,
  };

  return { data: payload };
}

export const healthRoutes: readonly RouteDefinition[] = [
  { method: "GET", pattern: "/api/health", public: true, handler: health },
  { method: "GET", pattern: "/api/health/ready", public: true, handler: readiness },
];
