import type { AdminUsagePayload } from "@absensi/shared";

import { readUsage } from "../db/admin";
import { authOf, requireGlobalAction } from "../http/auth";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";

/**
 * Cross-event operational data (DESAIN_API.md §10).
 *
 * Superadmin only: counts describe every tenant at once, so an event admin must
 * not see them. `requireGlobalAction` keeps the rule in `domain/permissions.ts`
 * instead of a hand-written role comparison here.
 */

async function usage(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  requireGlobalAction(auth, "admin:usage");

  const snapshot = await readUsage(ctx.env.DB, ctx.now);
  const payload: AdminUsagePayload = { generatedAt: ctx.now, ...snapshot };

  return { data: payload };
}

export const adminRoutes: readonly RouteDefinition[] = [
  { method: "GET", pattern: "/api/admin/usage", public: false, handler: usage },
];
