import { z } from "zod";

import type {
  ActivitySession,
  ActivitySessionDetailPayload,
  ActivitySessionListPayload,
  ActivitySessionStatusPayload,
} from "@absensi/shared";
import {
  ActivityIdSchema,
  ActivitySessionCreateRequestSchema,
  ActivitySessionIdSchema,
  ActivitySessionStatusRequestSchema,
  ActivitySessionUpdateRequestSchema,
  EventIdSchema,
  filterAuditFields,
} from "@absensi/shared";

import type { ActivitySessionRow } from "../db/activity-sessions";
import {
  archiveActivitySessionStatement,
  duplicateActivitySessionStatement,
  findActivitySession,
  insertActivitySessionStatement,
  listActivitySessions,
  updateActivitySessionStatement,
  updateActivitySessionStatusStatement,
} from "../db/activity-sessions";
import { findActivity } from "../db/activities";
import type { AuditEntry } from "../db/audit";
import {
  insertAuditAfterSessionUpdateStatement,
  insertAuditStatement,
} from "../db/audit";
import { newId } from "../domain/ids";
import {
  canArchiveSession,
  canTransitionSession,
  sessionArchiveMessage,
  sessionTransitionMessage,
} from "../domain/lifecycle";
import { authOf, requireEventAccess, requireMutableEvent } from "../http/auth";
import { businessRule, conflict, notFound, validationError } from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { parseJsonBody, parsePathParams } from "../http/validate";

/**
 * Sesi management (DESAIN_API.md §6, Q1).
 *
 * A Sesi is always resolved through its Aktivitas, and the Aktivitas through its
 * Tema: `findActivity` and `findActivitySession` are both scoped, so an id from
 * another Tema/activity is a 404, never a cross-theme write.
 *
 * Archive is `archived_at`, not a status value (FR-206, BR-078). The operational
 * status stays `completed`/`disabled` after archiving.
 */

const ActivityParamsSchema = z.object({
  eventId: EventIdSchema,
  activityId: ActivityIdSchema,
});
const SessionParamsSchema = z.object({
  eventId: EventIdSchema,
  activityId: ActivityIdSchema,
  sessionId: ActivitySessionIdSchema,
});

function toSession(row: ActivitySessionRow): ActivitySession {
  return {
    id: row.id,
    activityId: row.activity_id,
    name: row.name,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sessionSnapshot(row: ActivitySessionRow): Record<string, unknown> | null {
  return filterAuditFields("session", {
    name: row.name,
    location: row.location,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    archivedAt: row.archived_at,
  });
}

function sessionAudit(
  ctx: RouteContext,
  authUserId: string,
  eventId: string,
  action: string,
  sessionId: string,
  snapshots: { before?: unknown; after?: unknown },
): AuditEntry {
  return {
    id: newId(ctx.now),
    eventId,
    actorUserId: authUserId,
    action,
    entityType: "session",
    entityId: sessionId,
    before: snapshots.before,
    after: snapshots.after,
    createdAt: ctx.now,
  };
}

function assertTimeOrder(startsAt: number | null, endsAt: number | null): void {
  if (startsAt !== null && endsAt !== null && endsAt < startsAt) {
    throw validationError("Waktu selesai tidak boleh sebelum waktu mulai", {
      fieldErrors: { endsAt: ["Waktu selesai tidak boleh sebelum waktu mulai"] },
    });
  }
}

/**
 * Resolves Tema → Aktivitas for a read. The access check is explicit here so a
 * forgotten guard cannot be hidden by the activity lookup.
 */
async function requireActivityForRead(
  ctx: RouteContext,
  eventId: string,
  activityId: string,
): Promise<void> {
  const auth = authOf(ctx);
  await requireEventAccess(ctx.env, auth, eventId, "event:read");

  const activity = await findActivity(ctx.env.DB, eventId, activityId);
  if (!activity) throw notFound("Aktivitas tidak ditemukan");
}

async function requireActivityForWrite(
  ctx: RouteContext,
  eventId: string,
  activityId: string,
): Promise<void> {
  const auth = authOf(ctx);
  await requireMutableEvent(ctx.env, auth, eventId);

  const activity = await findActivity(ctx.env.DB, eventId, activityId);
  if (!activity) throw notFound("Aktivitas tidak ditemukan");
}

async function listSessions(ctx: RouteContext): Promise<RouteResult> {
  const { eventId, activityId } = parsePathParams(ctx.params, ActivityParamsSchema);
  await requireActivityForRead(ctx, eventId, activityId);

  const rows = await listActivitySessions(ctx.env.DB, activityId);
  const payload: ActivitySessionListPayload = { sessions: rows.map(toSession) };
  return { data: payload };
}

async function createSession(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, activityId } = parsePathParams(ctx.params, ActivityParamsSchema);
  await requireActivityForWrite(ctx, eventId, activityId);

  const body = await parseJsonBody(ctx.request, ActivitySessionCreateRequestSchema);
  const id = newId(ctx.now);

  const session: ActivitySessionRow = {
    id,
    activity_id: activityId,
    name: body.name,
    location: body.location ?? null,
    starts_at: body.startsAt ?? null,
    ends_at: body.endsAt ?? null,
    status: "scheduled",
    archived_at: null,
    created_at: ctx.now,
    created_by: auth.user.id,
    updated_at: ctx.now,
    updated_by: auth.user.id,
  };

  await ctx.env.DB.batch([
    insertActivitySessionStatement(ctx.env.DB, {
      id,
      activityId,
      name: session.name,
      location: session.location,
      startsAt: session.starts_at,
      endsAt: session.ends_at,
      createdBy: auth.user.id,
      createdAt: ctx.now,
    }),
    insertAuditStatement(
      ctx.env.DB,
      sessionAudit(ctx, auth.user.id, eventId, "session.created", id, {
        after: sessionSnapshot(session),
      }),
    ),
  ]);

  const payload: ActivitySessionDetailPayload = { session: toSession(session) };
  return { status: 201, data: payload };
}

async function getSession(ctx: RouteContext): Promise<RouteResult> {
  const { eventId, activityId, sessionId } = parsePathParams(ctx.params, SessionParamsSchema);
  await requireActivityForRead(ctx, eventId, activityId);

  const row = await findActivitySession(ctx.env.DB, activityId, sessionId);
  if (!row) throw notFound("Sesi tidak ditemukan");

  const payload: ActivitySessionDetailPayload = { session: toSession(row) };
  return { data: payload };
}

async function patchSession(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, activityId, sessionId } = parsePathParams(ctx.params, SessionParamsSchema);
  await requireActivityForWrite(ctx, eventId, activityId);

  const existing = await findActivitySession(ctx.env.DB, activityId, sessionId);
  if (!existing) throw notFound("Sesi tidak ditemukan");
  if (existing.archived_at !== null) {
    throw businessRule("Sesi yang sudah diarsipkan tidak dapat diubah");
  }

  const body = await parseJsonBody(ctx.request, ActivitySessionUpdateRequestSchema);

  const startsAt = body.startsAt === undefined ? existing.starts_at : body.startsAt;
  const endsAt = body.endsAt === undefined ? existing.ends_at : body.endsAt;
  assertTimeOrder(startsAt, endsAt);

  const updated: ActivitySessionRow = {
    ...existing,
    name: body.name ?? existing.name,
    location: body.location === undefined ? existing.location : body.location,
    starts_at: startsAt,
    ends_at: endsAt,
    updated_at: ctx.now,
    updated_by: auth.user.id,
  };

  const results = await ctx.env.DB.batch([
    updateActivitySessionStatement(ctx.env.DB, {
      activityId,
      sessionId,
      update: body,
      actorUserId: auth.user.id,
      now: ctx.now,
      expectedUpdatedAt: existing.updated_at,
    }),
    insertAuditAfterSessionUpdateStatement(
      ctx.env.DB,
      sessionAudit(ctx, auth.user.id, eventId, "session.updated", sessionId, {
        before: sessionSnapshot(existing),
        after: sessionSnapshot(updated),
      }),
      sessionId,
      ctx.now,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw conflict("Sesi berubah di perangkat lain. Muat ulang lalu coba lagi.");
  }

  const row = await findActivitySession(ctx.env.DB, activityId, sessionId);
  if (!row) throw notFound("Sesi tidak ditemukan");

  const payload: ActivitySessionDetailPayload = { session: toSession(row) };
  return { data: payload };
}

async function changeSessionStatus(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, activityId, sessionId } = parsePathParams(ctx.params, SessionParamsSchema);
  await requireActivityForWrite(ctx, eventId, activityId);

  const existing = await findActivitySession(ctx.env.DB, activityId, sessionId);
  if (!existing) throw notFound("Sesi tidak ditemukan");
  if (existing.archived_at !== null) {
    throw businessRule("Sesi yang sudah diarsipkan bersifat final");
  }

  const body = await parseJsonBody(ctx.request, ActivitySessionStatusRequestSchema);
  if (!canTransitionSession(existing.status, body.status)) {
    throw businessRule(sessionTransitionMessage(existing.status, body.status));
  }

  const updated: ActivitySessionRow = {
    ...existing,
    status: body.status,
    updated_at: ctx.now,
    updated_by: auth.user.id,
  };

  const results = await ctx.env.DB.batch([
    updateActivitySessionStatusStatement(ctx.env.DB, {
      activityId,
      sessionId,
      fromStatus: existing.status,
      status: body.status,
      actorUserId: auth.user.id,
      now: ctx.now,
      expectedUpdatedAt: existing.updated_at,
    }),
    insertAuditAfterSessionUpdateStatement(
      ctx.env.DB,
      sessionAudit(ctx, auth.user.id, eventId, "session.status_changed", sessionId, {
        before: sessionSnapshot(existing),
        after: sessionSnapshot(updated),
      }),
      sessionId,
      ctx.now,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw conflict("Sesi berubah di perangkat lain. Muat ulang lalu coba lagi.");
  }

  const row = await findActivitySession(ctx.env.DB, activityId, sessionId);
  if (!row) throw notFound("Sesi tidak ditemukan");

  const payload: ActivitySessionStatusPayload = { session: toSession(row) };
  return { data: payload };
}

async function archiveSession(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, activityId, sessionId } = parsePathParams(ctx.params, SessionParamsSchema);
  await requireActivityForWrite(ctx, eventId, activityId);

  const existing = await findActivitySession(ctx.env.DB, activityId, sessionId);
  if (!existing) throw notFound("Sesi tidak ditemukan");
  if (existing.archived_at !== null || !canArchiveSession(existing.status)) {
    throw businessRule(sessionArchiveMessage(existing.status));
  }

  const updated: ActivitySessionRow = {
    ...existing,
    archived_at: ctx.now,
    updated_at: ctx.now,
    updated_by: auth.user.id,
  };

  const results = await ctx.env.DB.batch([
    archiveActivitySessionStatement(ctx.env.DB, {
      activityId,
      sessionId,
      actorUserId: auth.user.id,
      now: ctx.now,
      expectedUpdatedAt: existing.updated_at,
    }),
    insertAuditAfterSessionUpdateStatement(
      ctx.env.DB,
      sessionAudit(ctx, auth.user.id, eventId, "session.archived", sessionId, {
        before: sessionSnapshot(existing),
        after: sessionSnapshot(updated),
      }),
      sessionId,
      ctx.now,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw conflict("Sesi berubah di perangkat lain. Muat ulang lalu coba lagi.");
  }

  const row = await findActivitySession(ctx.env.DB, activityId, sessionId);
  if (!row) throw notFound("Sesi tidak ditemukan");

  const payload: ActivitySessionDetailPayload = { session: toSession(row) };
  return { data: payload };
}

async function duplicateSession(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, activityId, sessionId } = parsePathParams(ctx.params, SessionParamsSchema);
  await requireActivityForWrite(ctx, eventId, activityId);

  const source = await findActivitySession(ctx.env.DB, activityId, sessionId);
  if (!source) throw notFound("Sesi tidak ditemukan");

  const id = newId(ctx.now);
  const copy: ActivitySessionRow = {
    ...source,
    id,
    status: "scheduled",
    archived_at: null,
    created_at: ctx.now,
    created_by: auth.user.id,
    updated_at: ctx.now,
    updated_by: auth.user.id,
  };

  const results = await ctx.env.DB.batch([
    duplicateActivitySessionStatement(ctx.env.DB, {
      id,
      activityId,
      sourceSessionId: sessionId,
      actorUserId: auth.user.id,
      now: ctx.now,
    }),
    insertAuditAfterSessionUpdateStatement(
      ctx.env.DB,
      sessionAudit(ctx, auth.user.id, eventId, "session.duplicated", id, {
        before: sessionSnapshot(source),
        after: sessionSnapshot(copy),
      }),
      id,
      ctx.now,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw conflict("Sesi sumber berubah. Muat ulang lalu coba lagi.");
  }

  const row = await findActivitySession(ctx.env.DB, activityId, id);
  if (!row) throw notFound("Sesi tidak ditemukan setelah diduplikasi");

  const payload: ActivitySessionDetailPayload = { session: toSession(row) };
  return { status: 201, data: payload };
}

export const activitySessionRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    pattern: "/api/events/:eventId/activities/:activityId/sessions",
    public: false,
    handler: listSessions,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/activities/:activityId/sessions",
    public: false,
    handler: createSession,
  },
  {
    method: "GET",
    pattern: "/api/events/:eventId/activities/:activityId/sessions/:sessionId",
    public: false,
    handler: getSession,
  },
  {
    method: "PATCH",
    pattern: "/api/events/:eventId/activities/:activityId/sessions/:sessionId",
    public: false,
    handler: patchSession,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/activities/:activityId/sessions/:sessionId/status",
    public: false,
    handler: changeSessionStatus,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/activities/:activityId/sessions/:sessionId/archive",
    public: false,
    handler: archiveSession,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/activities/:activityId/sessions/:sessionId/duplicate",
    public: false,
    handler: duplicateSession,
  },
];
