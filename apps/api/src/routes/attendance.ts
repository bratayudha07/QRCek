import { z } from "zod";

import type {
  AttendanceDetailPayload,
  AttendanceListPayload,
  AttendanceManualRequest,
  AttendanceRecord,
} from "@absensi/shared";
import {
  AttendanceCorrectionRequestSchema,
  AttendanceIdSchema,
  AttendanceListQuerySchema,
  AttendanceManualRequestSchema,
  EventIdSchema,
  StaffAttendanceQuerySchema,
} from "@absensi/shared";

import {
  insertAuditAfterAttendanceStatement,
  insertAuditAfterAttendanceUpdateStatement,
} from "../db/audit";
import {
  findAttendanceById,
  findAttendanceForParticipant,
  insertAttendanceStatement,
  listAttendance,
  listAttendanceByRecorder,
  updateAttendanceStatement,
} from "../db/attendance";
import type { AttendanceJoinedRow } from "../db/attendance";
import { findEventById } from "../db/events";
import { enqueueAttendanceStatement, enqueueCorrectionStatement } from "../db/outbox";
import { findParticipant } from "../db/participants";
import { isEventOpenForAttendance } from "../domain/attendance-policy";
import { decodeCursor, encodeCursor } from "../domain/cursor";
import { newId } from "../domain/ids";
import { authOf, requireEventAccess } from "../http/auth";
import { businessRule, conflict, notFound, validationError } from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { clientIpHash } from "../http/security";
import { parseJsonBody, parsePathParams, parseQuery } from "../http/validate";

/**
 * Attendance history, manual entry, and corrections (DESAIN_API.md §6).
 *
 * Every query is event-scoped. A participant or attendance id from another
 * event resolves to 404 because the SQL includes `event_id`.
 */

const EventParamsSchema = z.object({ eventId: EventIdSchema });
const AttendanceParamsSchema = z.object({
  eventId: EventIdSchema,
  attendanceId: AttendanceIdSchema,
});

function toRecord(row: AttendanceJoinedRow): AttendanceRecord {
  return {
    id: row.id,
    eventId: row.event_id,
    eventName: row.event_name,
    participantId: row.participant_id,
    participantName: row.participant_name,
    participantExternalRef: row.participant_external_ref,
    category: row.category,
    status: row.status,
    checkedInAt: row.checked_in_at,
    recordedBy: row.recorded_by,
    recordedByName: row.recorded_by_name,
    method: row.method,
    note: row.note,
    updatedAt: row.updated_at,
  };
}

async function listEventAttendance(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "recap:read");
  const query = parseQuery(ctx.request, AttendanceListQuerySchema);

  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (query.cursor && !cursor) throw validationError("Cursor tidak valid");

  const rows = await listAttendance(
    ctx.env.DB,
    eventId,
    { query: query.query, status: query.status },
    cursor ? { checkedInAt: cursor.createdAt, id: cursor.id } : null,
    query.limit,
  );

  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const last = items.at(-1);

  const payload: AttendanceListPayload = {
    items: items.map(toRecord),
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.checked_in_at, id: last.id })
        : null,
  };

  return { data: payload };
}

async function staffAttendanceHistory(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const query = parseQuery(ctx.request, StaffAttendanceQuerySchema);

  if (query.eventId) {
    await requireEventAccess(ctx.env, auth, query.eventId, "event:read");
  }

  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (query.cursor && !cursor) throw validationError("Cursor tidak valid");

  const rows = await listAttendanceByRecorder(ctx.env.DB, {
    userId: auth.user.id,
    isSuperadmin: auth.user.role === "superadmin",
    eventId: query.eventId,
    cursor: cursor ? { checkedInAt: cursor.createdAt, id: cursor.id } : null,
    limit: query.limit,
  });

  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const last = items.at(-1);

  const payload: AttendanceListPayload = {
    items: items.map(toRecord),
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.checked_in_at, id: last.id })
        : null,
  };

  return { data: payload };
}

async function correctAttendance(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, attendanceId } = parsePathParams(ctx.params, AttendanceParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "attendance:correct");
  const body = await parseJsonBody(ctx.request, AttendanceCorrectionRequestSchema);

  const existing = await findAttendanceById(ctx.env.DB, eventId, attendanceId);
  if (!existing) throw notFound("Absensi tidak ditemukan pada acara ini");

  if (
    body.expectedUpdatedAt !== undefined &&
    body.expectedUpdatedAt !== existing.updated_at
  ) {
    throw conflict("Absensi sudah berubah. Muat ulang sebelum mengoreksi.");
  }

  const ipHash = await clientIpHash(ctx.request, ctx.env.SESSION_PEPPER);
  const auditId = newId(ctx.now);

  const results = await ctx.env.DB.batch([
    updateAttendanceStatement(
      ctx.env.DB,
      eventId,
      attendanceId,
      {
        status: body.status,
        method: "correction",
        expectedUpdatedAt: body.expectedUpdatedAt,
      },
      ctx.now,
    ),
    enqueueCorrectionStatement(ctx.env.DB, {
      id: newId(ctx.now),
      eventId,
      participantId: existing.participant_id,
      attendanceId,
      updatedAt: ctx.now,
      now: ctx.now,
    }),
    insertAuditAfterAttendanceUpdateStatement(
      ctx.env.DB,
      {
        id: auditId,
        eventId,
        actorUserId: auth.user.id,
        action: "attendance.corrected",
        entityType: "attendance",
        entityId: attendanceId,
        before: {
          status: existing.status,
          checkedInAt: existing.checked_in_at,
        },
        after: { status: body.status, method: "correction" },
        reason: body.reason,
        ipHash,
        createdAt: ctx.now,
      },
      attendanceId,
      ctx.now,
      body.status,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw conflict("Absensi sudah berubah. Muat ulang sebelum mengoreksi.");
  }

  const updated = await findAttendanceById(ctx.env.DB, eventId, attendanceId);
  if (!updated) throw notFound("Absensi tidak ditemukan pada acara ini");

  // The optimistic update and audit share one timestamp; a 0-change audit would
  // mean the update was not the one we just made, which is a system fault.
  if ((results[2]?.meta.changes ?? 0) === 0) {
    throw conflict("Koreksi tidak tercatat di audit. Muat ulang dan coba lagi.");
  }

  const payload: AttendanceDetailPayload = { attendance: toRecord(updated) };
  return { data: payload };
}

async function manualAttendance(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "attendance:correct");
  const body = await parseJsonBody(ctx.request, AttendanceManualRequestSchema);

  const event = await findEventById(ctx.env.DB, eventId);
  if (!event) throw notFound("Acara tidak ditemukan");

  if (event.allow_manual !== 1) {
    throw businessRule("Acara ini tidak mengizinkan pencatatan manual");
  }

  if (!isEventOpenForAttendance(event, ctx.now)) {
    throw businessRule("Acara tidak sedang menerima absensi");
  }

  const participant = await findParticipant(ctx.env.DB, eventId, body.participantId);
  if (!participant) throw notFound("Peserta tidak ditemukan pada acara ini");
  if (participant.status !== "active") {
    throw businessRule("Peserta tidak aktif");
  }

  const attendanceId = newId(ctx.now);
  const ipHash = await clientIpHash(ctx.request, ctx.env.SESSION_PEPPER);
  const request: AttendanceManualRequest = body;

  const results = await ctx.env.DB.batch([
    insertAttendanceStatement(ctx.env.DB, {
      id: attendanceId,
      eventId,
      participantId: participant.id,
      status: body.status,
      checkedInAt: ctx.now,
      recordedBy: auth.user.id,
      method: "manual",
      note: body.note ?? null,
      now: ctx.now,
    }),
    enqueueAttendanceStatement(ctx.env.DB, {
      id: newId(ctx.now),
      eventId,
      participantId: participant.id,
      attendanceId,
      now: ctx.now,
    }),
    insertAuditAfterAttendanceStatement(
      ctx.env.DB,
      {
        id: newId(ctx.now),
        eventId,
        actorUserId: auth.user.id,
        action: "attendance.recorded",
        entityType: "attendance",
        entityId: attendanceId,
        after: {
          participantId: participant.id,
          status: request.status,
          method: "manual",
          note: request.note ?? null,
        },
        ipHash,
        createdAt: ctx.now,
      },
      attendanceId,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw conflict("Peserta ini sudah tercatat hadir pada acara ini");
  }

  const created = await findAttendanceForParticipant(ctx.env.DB, eventId, participant.id);
  if (!created) {
    throw notFound("Absensi tidak ditemukan setelah dicatat");
  }

  const payload: AttendanceDetailPayload = { attendance: toRecord(created) };
  return { status: 201, data: payload };
}

export const attendanceRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    pattern: "/api/events/:eventId/attendance",
    public: false,
    handler: listEventAttendance,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/attendance/manual",
    public: false,
    handler: manualAttendance,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/attendance/:attendanceId/correction",
    public: false,
    handler: correctAttendance,
  },
  {
    method: "GET",
    pattern: "/api/staff/attendance",
    public: false,
    handler: staffAttendanceHistory,
  },
];
