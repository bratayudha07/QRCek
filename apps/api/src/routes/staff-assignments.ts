import { z } from "zod";

import type {
  StaffAssignment,
  StaffAssignmentDetailPayload,
  StaffAssignmentListPayload,
  StaffContextListPayload,
} from "@absensi/shared";
import {
  AssignmentIdSchema,
  EventIdSchema,
  StaffAssignmentCreateRequestSchema,
  StaffAssignmentListQuerySchema,
  StaffAssignmentUpdateRequestSchema,
  filterAuditFields,
} from "@absensi/shared";

import { findActivity } from "../db/activities";
import { findActivitySession } from "../db/activity-sessions";
import type { AuditEntry } from "../db/audit";
import { insertAuditAfterStaffAssignmentUpdateStatement } from "../db/audit";
import type { StaffAssignmentJoinedRow } from "../db/staff-assignments";
import {
  findAssignmentById,
  insertStaffAssignmentStatement,
  listThemeAssignments,
  listUserContexts,
  revokeStaffAssignmentStatement,
  updateAssignmentManualFlagStatement,
} from "../db/staff-assignments";
import { findActiveMembership, findActiveUserById } from "../db/users";
import { newId } from "../domain/ids";
import { expandStaffContexts } from "../domain/staff-context";
import { authOf, requireEventAccess, requireMutableEvent } from "../http/auth";
import { businessRule, conflict, notFound } from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { parseJsonBody, parsePathParams, parseQuery } from "../http/validate";

/**
 * Petugas assignment management and the caller's scanner contexts
 * (DESAIN_API.md §4/§7, ADR-0021; Q6).
 *
 * Writes are Tema-scoped and audited in the same `db.batch()` as the mutation.
 * Revoking never deletes a row and never touches `transactions`, so history
 * survives assignment changes (BR-052, FR-104).
 */

const EventParamsSchema = z.object({ eventId: EventIdSchema });
const AssignmentParamsSchema = z.object({
  eventId: EventIdSchema,
  assignmentId: AssignmentIdSchema,
});

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function toAssignment(row: StaffAssignmentJoinedRow): StaffAssignment {
  return {
    id: row.id,
    themeId: row.theme_id,
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    activityId: row.activity_id,
    activityName: row.activity_name,
    sessionId: row.session_id,
    sessionName: row.session_name,
    canManualCheckIn: row.can_manual_check_in === 1,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at,
  };
}

function assignmentSnapshot(row: {
  theme_id: string;
  activity_id: string;
  session_id: string | null;
  user_id: string;
  can_manual_check_in: number;
  status: string;
  revoked_at: number | null;
}): Record<string, unknown> | null {
  return filterAuditFields("staff_assignment", {
    themeId: row.theme_id,
    activityId: row.activity_id,
    sessionId: row.session_id,
    userId: row.user_id,
    canManualCheckIn: row.can_manual_check_in === 1,
    status: row.status,
    revokedAt: row.revoked_at,
  });
}

function assignmentAudit(
  ctx: RouteContext,
  actorUserId: string,
  eventId: string,
  action: string,
  assignmentId: string,
  snapshots: { before?: unknown; after?: unknown },
): AuditEntry {
  return {
    id: newId(ctx.now),
    eventId,
    actorUserId,
    action,
    entityType: "staff_assignment",
    entityId: assignmentId,
    before: snapshots.before,
    after: snapshots.after,
    createdAt: ctx.now,
  };
}

async function loadAssignment(
  ctx: RouteContext,
  eventId: string,
  assignmentId: string,
): Promise<StaffAssignmentJoinedRow> {
  const row = await findAssignmentById(ctx.env.DB, eventId, assignmentId);
  if (!row) throw notFound("Penugasan tidak ditemukan");
  return row;
}

async function listAssignments(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);
  await requireEventAccess(ctx.env, auth, eventId, "assignment:manage");

  const query = parseQuery(ctx.request, StaffAssignmentListQuerySchema);
  const rows = await listThemeAssignments(ctx.env.DB, eventId, query.status);

  const payload: StaffAssignmentListPayload = { assignments: rows.map(toAssignment) };
  return { data: payload };
}

async function createAssignment(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);
  await requireMutableEvent(ctx.env, auth, eventId, "assignment:manage");

  const body = await parseJsonBody(ctx.request, StaffAssignmentCreateRequestSchema);

  const targetUser = await findActiveUserById(ctx.env.DB, body.userId);
  if (!targetUser) throw businessRule("Pengguna tidak ditemukan atau tidak aktif");

  const targetMembership = await findActiveMembership(ctx.env.DB, eventId, body.userId);
  if (targetMembership !== "officer") {
    throw businessRule("Penugasan hanya untuk Petugas aktif pada acara ini");
  }

  const activity = await findActivity(ctx.env.DB, eventId, body.activityId);
  if (!activity) throw notFound("Aktivitas tidak ditemukan pada acara ini");
  if (activity.archived_at !== null || activity.status === "archived") {
    throw businessRule("Aktivitas yang sudah diarsipkan tidak dapat ditugaskan");
  }

  const sessionId = body.sessionId ?? null;
  if (sessionId !== null) {
    const session = await findActivitySession(ctx.env.DB, activity.id, sessionId);
    if (!session) throw notFound("Sesi tidak ditemukan pada Aktivitas ini");
    if (session.archived_at !== null) {
      throw businessRule("Sesi yang sudah diarsipkan tidak dapat ditugaskan");
    }
  }

  const id = newId(ctx.now);
  const createdAt = ctx.now;

  try {
    await ctx.env.DB.batch([
      insertStaffAssignmentStatement(ctx.env.DB, {
        id,
        themeId: eventId,
        activityId: activity.id,
        sessionId,
        userId: body.userId,
        canManualCheckIn: body.canManualCheckIn,
        createdBy: auth.user.id,
        now: createdAt,
      }),
      insertAuditAfterStaffAssignmentUpdateStatement(
        ctx.env.DB,
        assignmentAudit(ctx, auth.user.id, eventId, "assignment.created", id, {
          after: assignmentSnapshot({
            theme_id: eventId,
            activity_id: activity.id,
            session_id: sessionId,
            user_id: body.userId,
            can_manual_check_in: body.canManualCheckIn ? 1 : 0,
            status: "active",
            revoked_at: null,
          }),
        }),
        id,
        createdAt,
      ),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("Petugas sudah punya penugasan aktif pada Aktivitas/Sesi ini");
    }
    throw error;
  }

  const row = await loadAssignment(ctx, eventId, id);
  const payload: StaffAssignmentDetailPayload = { assignment: toAssignment(row) };
  return { status: 201, data: payload };
}

async function patchAssignment(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, assignmentId } = parsePathParams(ctx.params, AssignmentParamsSchema);
  await requireMutableEvent(ctx.env, auth, eventId, "assignment:manage");

  const existing = await loadAssignment(ctx, eventId, assignmentId);
  if (existing.status !== "active") throw notFound("Penugasan tidak ditemukan");

  const body = await parseJsonBody(ctx.request, StaffAssignmentUpdateRequestSchema);
  const canManualCheckIn = body.canManualCheckIn;

  if (canManualCheckIn === (existing.can_manual_check_in === 1)) {
    const unchanged: StaffAssignmentDetailPayload = { assignment: toAssignment(existing) };
    return { data: unchanged };
  }

  const after = {
    ...existing,
    can_manual_check_in: canManualCheckIn ? 1 : 0,
    updated_at: ctx.now,
    updated_by: auth.user.id,
  };

  const results = await ctx.env.DB.batch([
    updateAssignmentManualFlagStatement(ctx.env.DB, {
      themeId: eventId,
      assignmentId,
      canManualCheckIn,
      actorUserId: auth.user.id,
      now: ctx.now,
    }),
    insertAuditAfterStaffAssignmentUpdateStatement(
      ctx.env.DB,
      assignmentAudit(ctx, auth.user.id, eventId, "assignment.updated", assignmentId, {
        before: assignmentSnapshot(existing),
        after: assignmentSnapshot(after),
      }),
      assignmentId,
      ctx.now,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw conflict("Penugasan berubah di perangkat lain. Muat ulang lalu coba lagi.");
  }

  const row = await loadAssignment(ctx, eventId, assignmentId);
  const payload: StaffAssignmentDetailPayload = { assignment: toAssignment(row) };
  return { data: payload };
}

async function revokeAssignment(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, assignmentId } = parsePathParams(ctx.params, AssignmentParamsSchema);
  await requireMutableEvent(ctx.env, auth, eventId, "assignment:manage");

  const existing = await loadAssignment(ctx, eventId, assignmentId);
  if (existing.status !== "active") throw notFound("Penugasan tidak ditemukan");

  const after = {
    ...existing,
    status: "revoked" as const,
    revoked_at: ctx.now,
    updated_at: ctx.now,
    updated_by: auth.user.id,
  };

  const results = await ctx.env.DB.batch([
    revokeStaffAssignmentStatement(ctx.env.DB, {
      themeId: eventId,
      assignmentId,
      actorUserId: auth.user.id,
      now: ctx.now,
    }),
    insertAuditAfterStaffAssignmentUpdateStatement(
      ctx.env.DB,
      assignmentAudit(ctx, auth.user.id, eventId, "assignment.revoked", assignmentId, {
        before: assignmentSnapshot(existing),
        after: assignmentSnapshot(after),
      }),
      assignmentId,
      ctx.now,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw notFound("Penugasan tidak ditemukan");
  }

  const row = await loadAssignment(ctx, eventId, assignmentId);
  const payload: StaffAssignmentDetailPayload = { assignment: toAssignment(row) };
  return { data: payload };
}

/**
 * The caller's own active contexts. No event id, no membership check: the query
 * is scoped to `auth.user.id`, so it cannot reveal someone else's assignments.
 */
async function listMyContexts(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);

  const rows = await listUserContexts(ctx.env.DB, auth.user.id);
  const payload: StaffContextListPayload = { contexts: expandStaffContexts(rows) };
  return { data: payload };
}

export const staffAssignmentRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    pattern: "/api/events/:eventId/assignments",
    public: false,
    handler: listAssignments,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/assignments",
    public: false,
    handler: createAssignment,
  },
  {
    method: "PATCH",
    pattern: "/api/events/:eventId/assignments/:assignmentId",
    public: false,
    handler: patchAssignment,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/assignments/:assignmentId/revoke",
    public: false,
    handler: revokeAssignment,
  },
  {
    method: "GET",
    pattern: "/api/staff/assignments",
    public: false,
    handler: listMyContexts,
  },
];
