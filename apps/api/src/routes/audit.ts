import { AuditListQuerySchema, EventIdSchema } from "@absensi/shared";
import { z } from "zod";

import { listAuditEntries } from "../db/audit";
import { decodeCursor, encodeCursor } from "../domain/cursor";
import { authOf, requireEventAccess } from "../http/auth";
import { validationError } from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { parsePathParams, parseQuery } from "../http/validate";

const ParamsSchema = z.object({ eventId: EventIdSchema });

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

async function listEventAudit(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, ParamsSchema);
  await requireEventAccess(ctx.env, auth, eventId, "audit:read");

  const query = parseQuery(ctx.request, AuditListQuerySchema);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (query.cursor && !cursor) throw validationError("Cursor audit tidak valid");

  const rows = await listAuditEntries(ctx.env.DB, {
    eventId,
    action: query.action,
    cursor: cursor ? { createdAt: cursor.createdAt, id: cursor.id } : null,
    limit: query.limit,
  });
  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const last = items.at(-1);

  return {
    data: {
      items: items.map((row) => ({
        id: row.id,
        eventId: row.event_id,
        actorUserId: row.actor_user_id,
        actorName: row.actor_name,
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id,
        before: parseJson(row.before_json),
        after: parseJson(row.after_json),
        reason: row.reason,
        createdAt: row.created_at,
      })),
      nextCursor:
        hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
    },
  };
}

export const auditRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    pattern: "/api/events/:eventId/audit",
    public: false,
    handler: listEventAudit,
  },
];
