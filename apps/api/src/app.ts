import type { Env } from "./env";
import { apiNotFound, dispatchRoutes } from "./http/router";
import type { RouteDefinition } from "./http/router";
import { withSecurityHeaders } from "./http/security-headers";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { attendanceRoutes } from "./routes/attendance";
import { auditRoutes } from "./routes/audit";
import { dashboardRoutes } from "./routes/dashboard";
import { eventRoutes } from "./routes/events";
import { healthRoutes } from "./routes/health";
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
export const ROUTES: readonly RouteDefinition[] = [
  ...healthRoutes,
  ...authRoutes,
  ...eventRoutes,
  ...participantRoutes,
  ...labelRoutes,
  ...scanRoutes,
  ...attendanceRoutes,
  ...auditRoutes,
  ...dashboardRoutes,
  ...syncRoutes,
  ...adminRoutes,
];

/** Content blockers may block XHR paths named `/api/events`; expose a neutral alias. */
const ROUTES_WITH_CALENDAR_ALIAS: readonly RouteDefinition[] = [
  ...ROUTES,
  ...ROUTES.filter(
    (route) => route.pattern === "/api/events" || route.pattern.startsWith("/api/events/"),
  ).map((route) => ({
    ...route,
    pattern: route.pattern.replace("/api/events", "/api/calendar"),
  })),
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
    return (await dispatchRoutes(ROUTES_WITH_CALENDAR_ALIAS, request, env, now)) ?? apiNotFound();
  }

  // Everything else is the SPA (Workers Static Assets, ADR-001). Production
  // serves assets without invoking the Worker; this branch covers `wrangler dev`
  // and tests, so the headers are applied here too.
  return withSecurityHeaders(await env.ASSETS.fetch(request));
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
