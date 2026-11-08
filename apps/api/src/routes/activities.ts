import { z } from "zod";

import type {
  Activity,
  ActivityDetailPayload,
  ActivityListPayload,
  ActivityStatusPayload,
} from "@absensi/shared";
import {
  ActivityCreateRequestSchema,
  ActivityIdSchema,
  ActivityStatusRequestSchema,
  ActivityUpdateRequestSchema,
  EventIdSchema,
  filterAuditFields,
} from "@absensi/shared";

import type { ActivityRow } from "../db/activities";
import {
  findActivity,
  insertActivityStatement,
  listActivities,
  updateActivityStatement,
  updateActivityStatusStatement,
} from "../db/activities";
import type { AuditEntry } from "../db/audit";
import {
  insertAuditAfterActivityUpdateStatement,
  insertAuditStatement,
} from "../db/audit";
import { newId } from "../domain/ids";
import {
  activityTransitionMessage,
  canTransitionActivity,
} from "../domain/lifecycle";
import { authOf, requireEventAccess, requireMutableEvent } from "../http/auth";
import { businessRule, conflict, notFound } from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { parseJsonBody, parsePathParams } from "../http/validate";

/**
 * Aktivitas management (DESAIN_API.md §6, Q1).
 *
 * Every query is scoped by `theme_id`, so an activity id from another Tema is
 * indistinguishable from a missing one (404). Mutations write their audit row in
 * the same `db.batch()` as the mutation; the audit statement re-checks
 * `updated_at` so a lost optimistic update writes no audit row.
 */

const EventParamsSchema = z.object({ eventId: EventIdSchema });
const ActivityParamsSchema = z.object({
  eventId: EventIdSchema,
  activityId: ActivityIdSchema,
});

function toActivity(row: ActivityRow): Activity {
  return {
    id: row.id,
    themeId: row.theme_id,
    name: row.name,
    description: row.description,
    transactionType: row.transaction_type,
    status: row.status,
    location: row.location,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function activitySnapshot(row: ActivityRow): Record<string, unknown> | null {
  return filterAuditFields("activity", {
    name: row.name,
    description: row.description,
    transactionType: row.transaction_type,
    status: row.status,
    location: row.location,
    sortOrder: row.sort_order,
    archivedAt: row.archived_at,
  });
}

function activityAudit(
  ctx: RouteContext,
  authUserId: string,
  eventId: string,
  action: string,
  activityId: string,
  snapshots: { before?: unknown; after?: unknown },
): AuditEntry {
  return {
    id: newId(ctx.now),
    eventId,
    actorUserId: authUserId,
    action,
    entityType: "activity",
    entityId: activityId,
    before: snapshots.before,
    after: snapshots.after,
    createdAt: ctx.now,
  };
}

async function listThemeActivities(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "event:read");

  const rows = await listActivities(ctx.env.DB, eventId);
  const payload: ActivityListPayload = { activities: rows.map(toActivity) };
  return { data: payload };
}

async function createActivity(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireMutableEvent(ctx.env, auth, eventId);
  const body = await parseJsonBody(ctx.request, ActivityCreateRequestSchema);

  const id = newId(ctx.now);
  const activity: ActivityRow = {
    id,
    theme_id: eventId,
    name: body.name,
    description: body.description ?? null,
    transaction_type: body.transactionType,
    status: "draft",
    location: body.location ?? null,
    sort_order: body.sortOrder,
    created_at: ctx.now,
    created_by: auth.user.id,
    updated_at: ctx.now,
    updated_by: auth.user.id,
    archived_at: null,
  };

  await ctx.env.DB.batch([
    insertActivityStatement(ctx.env.DB, {
      id,
      themeId: eventId,
      name: body.name,
      description: activity.description,
      transactionType: body.transactionType,
      location: activity.location,
      sortOrder: body.sortOrder,
      createdBy: auth.user.id,
      createdAt: ctx.now,
    }),
    insertAuditStatement(
      ctx.env.DB,
      activityAudit(ctx, auth.user.id, eventId, "activity.created", id, {
        after: activitySnapshot(activity),
      }),
    ),
  ]);

  const payload: ActivityDetailPayload = { activity: toActivity(activity) };
  return { status: 201, data: payload };
}

async function getActivity(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, activityId } = parsePathParams(ctx.params, ActivityParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "event:read");
  const row = await findActivity(ctx.env.DB, eventId, activityId);
  if (!row) throw notFound("Aktivitas tidak ditemukan");

  const payload: ActivityDetailPayload = { activity: toActivity(row) };
  return { data: payload };
}

async function patchActivity(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, activityId } = parsePathParams(ctx.params, ActivityParamsSchema);

  await requireMutableEvent(ctx.env, auth, eventId);
  const existing = await findActivity(ctx.env.DB, eventId, activityId);
  if (!existing) throw notFound("Aktivitas tidak ditemukan");
  if (existing.status === "archived") {
    throw businessRule("Aktivitas yang sudah diarsipkan tidak dapat diubah");
  }

  const body = await parseJsonBody(ctx.request, ActivityUpdateRequestSchema);
  const updated: ActivityRow = {
    ...existing,
    name: body.name ?? existing.name,
    description:
      body.description === undefined ? existing.description : body.description,
    location: body.location === undefined ? existing.location : body.location,
    sort_order: body.sortOrder ?? existing.sort_order,
    updated_at: ctx.now,
    updated_by: auth.user.id,
  };

  const results = await ctx.env.DB.batch([
    updateActivityStatement(ctx.env.DB, {
      themeId: eventId,
      activityId,
      update: body,
      actorUserId: auth.user.id,
      now: ctx.now,
      expectedUpdatedAt: existing.updated_at,
    }),
    insertAuditAfterActivityUpdateStatement(
      ctx.env.DB,
      activityAudit(ctx, auth.user.id, eventId, "activity.updated", activityId, {
        before: activitySnapshot(existing),
        after: activitySnapshot(updated),
      }),
      activityId,
      ctx.now,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw conflict("Aktivitas berubah di perangkat lain. Muat ulang lalu coba lagi.");
  }

  const row = await findActivity(ctx.env.DB, eventId, activityId);
  if (!row) throw notFound("Aktivitas tidak ditemukan");

  const payload: ActivityDetailPayload = { activity: toActivity(row) };
  return { data: payload };
}

async function changeActivityStatus(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, activityId } = parsePathParams(ctx.params, ActivityParamsSchema);

  await requireMutableEvent(ctx.env, auth, eventId);
  const existing = await findActivity(ctx.env.DB, eventId, activityId);
  if (!existing) throw notFound("Aktivitas tidak ditemukan");

  const body = await parseJsonBody(ctx.request, ActivityStatusRequestSchema);

  if (!canTransitionActivity(existing.status, body.status)) {
    throw businessRule(activityTransitionMessage(existing.status, body.status));
  }

  const updated: ActivityRow = {
    ...existing,
    status: body.status,
    archived_at: body.status === "archived" ? ctx.now : null,
    updated_at: ctx.now,
    updated_by: auth.user.id,
  };

  const results = await ctx.env.DB.batch([
    updateActivityStatusStatement(ctx.env.DB, {
      themeId: eventId,
      activityId,
      fromStatus: existing.status,
      status: body.status,
      actorUserId: auth.user.id,
      now: ctx.now,
      expectedUpdatedAt: existing.updated_at,
    }),
    insertAuditAfterActivityUpdateStatement(
      ctx.env.DB,
      activityAudit(
        ctx,
        auth.user.id,
        eventId,
        "activity.status_changed",
        activityId,
        {
          before: activitySnapshot(existing),
          after: activitySnapshot(updated),
        },
      ),
      activityId,
      ctx.now,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw conflict("Aktivitas berubah di perangkat lain. Muat ulang lalu coba lagi.");
  }

  const row = await findActivity(ctx.env.DB, eventId, activityId);
  if (!row) throw notFound("Aktivitas tidak ditemukan");

  const payload: ActivityStatusPayload = { activity: toActivity(row) };
  return { data: payload };
}

export const activityRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    pattern: "/api/events/:eventId/activities",
    public: false,
    handler: listThemeActivities,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/activities",
    public: false,
    handler: createActivity,
  },
  {
    method: "GET",
    pattern: "/api/events/:eventId/activities/:activityId",
    public: false,
    handler: getActivity,
  },
  {
    method: "PATCH",
    pattern: "/api/events/:eventId/activities/:activityId",
    public: false,
    handler: patchActivity,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/activities/:activityId/status",
    public: false,
    handler: changeActivityStatus,
  },
];
