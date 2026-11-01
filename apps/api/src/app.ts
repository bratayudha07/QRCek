import type { HealthPayload } from "@absensi/shared";
import { API_VERSION } from "@absensi/shared";

import type { Env } from "./env";
import { apiNotFound, dispatchRoutes } from "./http/router";
import type { RouteContext, RouteDefinition, RouteResult } from "./http/router";
import { authRoutes } from "./routes/auth";
import { attendanceRoutes } from "./routes/attendance";
import { dashboardRoutes } from "./routes/dashboard";
import { eventRoutes } from "./routes/events";
import { labelRoutes } from "./routes/labels";
import { participantRoutes } from "./routes/participants";
import { scanRoutes } from "./routes/scan";
import { syncRoutes } from "./routes/sync";

/**
 * Route table.
 *
 * Every route is authenticated by the dispatcher unless `public: true` is set,
 * so a new endpoint is deny-by-default. Security tests iterate this array, which
 * means adding a route without a session guard fails the test suite.
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

export const ROUTES: readonly RouteDefinition[] = [
  { method: "GET", pattern: "/api/health", public: true, handler: health },
  ...authRoutes,
  ...eventRoutes,
  ...participantRoutes,
  ...labelRoutes,
  ...scanRoutes,
  ...attendanceRoutes,
  ...dashboardRoutes,
  ...syncRoutes,
];

export interface HandleOptions {
  /** Injected clock. Tests pass a controllable function; production uses Date.now. */
  now?: () => number;
}

export async function handleRequest(
  request: Request,
  env: Env,
  options: HandleOptions = {},
): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname.startsWith("/api/")) {
    const now = (options.now ?? Date.now)();
    return (await dispatchRoutes(ROUTES, request, env, now)) ?? apiNotFound();
  }

  // Everything else is the SPA (Workers Static Assets, ADR-001).
  return env.ASSETS.fetch(request);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
