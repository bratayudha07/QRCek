import { z } from "zod";

import type {
  AttendanceDetailPayload,
  AttendanceListPayload,
  AttendanceRecord,
  AttendanceStatus,
  TransactionDetailPayload,
  TransactionListPayload,
  TransactionRecord,
} from "@absensi/shared";
import {
  AdjustmentRequestSchema,
  AttendanceListQuerySchema,
  AttendanceManualRequestSchema,
  EventIdSchema,
  ReversalRequestSchema,
  StaffAttendanceQuerySchema,
  TransactionIdSchema,
  TransactionListQuerySchema,
  filterAuditFields,
  resolveEntitlement,
} from "@absensi/shared";

import {
  insertAuditAfterAdjustmentStatement,
  insertAuditAfterReversalStatement,
  insertAuditAfterTransactionStatement,
} from "../db/audit";
import {
  listAttendance,
  listAttendanceByRecorder,
} from "../db/attendance";
import type { AttendanceJoinedRow } from "../db/attendance";
import { findEventById } from "../db/events";
import { listRulesForContext } from "../db/entitlement-rules";
import {
  enqueueCorrectionStatement,
  enqueueTransactionStatement,
} from "../db/outbox";
import { findParticipant } from "../db/participants";
import { findEffectiveAssignment } from "../db/staff-assignments";
import {
  findEffectiveTransactionForScope,
  findTransactionById,
  insertAdjustmentCorrectionStatement,
  insertReversalCorrectionStatement,
  insertTransactionStatement,
  listTransactions,
  reverseTransactionStatement,
  supersedeTransactionStatement,
} from "../db/transactions";
import type { TransactionCursor, TransactionFilters } from "../db/transactions";
import type { TransactionJoinedRow } from "../db/transactions";
import { decodeCursor, encodeCursor } from "../domain/cursor";
import { buildCsv } from "../domain/csv";
import { newId } from "../domain/ids";
import { slugify } from "../domain/slug";
import {
  adjustmentDiff,
  lifecycleRejection,
  scanMessage,
  transactionSnapshot,
} from "../domain/transactions";
import { resolveAttendanceContext } from "../services/transaction-context";
import { authOf, requireEventAccess } from "../http/auth";
import {
  ApiError,
  businessRule,
  conflict,
  forbidden,
  notFound,
  validationError,
} from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { clientIpHash } from "../http/security";
import { parseJsonBody, parsePathParams, parseQuery } from "../http/validate";

/**
 * Transactions: history, Manual Entry, Reversal, and Adjustment
 * (DESAIN_API.md §7, ADR-0018–0022).
 *
 * The legacy `GET /attendance` and `/staff/attendance` endpoints stay on their
 * response contract, but read effective transactions through the compatibility
 * adapter in `db/attendance.ts`. New writes only touch `transactions`.
 */

const EventParamsSchema = z.object({ eventId: EventIdSchema });
const TransactionParamsSchema = z.object({
  eventId: EventIdSchema,
  transactionId: TransactionIdSchema,
});
const MAX_ATTENDANCE_EXPORT_ROWS = 5_000;

function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

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

function transactionToLegacy(row: TransactionJoinedRow): AttendanceRecord {
  return {
    id: row.id,
    eventId: row.theme_id,
    eventName: row.event_name,
    participantId: row.participant_id,
    participantName: row.participant_name,
    participantExternalRef: row.participant_external_ref,
    category: row.category,
    // The CHECK constraint guarantees a status for `type = 'attendance'`.
    status: (row.status ?? "present") as AttendanceStatus,
    checkedInAt: row.occurred_at,
    recordedBy: row.recorded_by,
    recordedByName: row.recorded_by_name,
    method: row.source,
    note: row.note,
    updatedAt: row.updated_at,
  };
}

function toTransaction(row: TransactionJoinedRow): TransactionRecord {
  return {
    id: row.id,
    themeId: row.theme_id,
    activityId: row.activity_id,
    sessionId: row.session_id,
    participantId: row.participant_id,
    type: row.type,
    source: row.source,
    status: row.status,
    occurredAt: row.occurred_at,
    recordedBy: row.recorded_by,
    note: row.note,
    slotNo: row.slot_no,
    adjustsTransactionId: row.adjusts_transaction_id,
    reversedAt: row.reversed_at,
    supersededAt: row.superseded_at,
    effective: row.reversed_at === null && row.superseded_at === null,
    createdAt: row.created_at,
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

async function exportEventAttendance(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);
  const access = await requireEventAccess(ctx.env, auth, eventId, "participant:import");
  const query = parseQuery(ctx.request, AttendanceListQuerySchema);
  const rows = await listAttendance(
    ctx.env.DB,
    eventId,
    { query: query.query, status: query.status },
    null,
    MAX_ATTENDANCE_EXPORT_ROWS,
  );
  if (rows.length > MAX_ATTENDANCE_EXPORT_ROWS) {
    throw businessRule("Laporan melebihi 5.000 baris. Gunakan filter pencarian atau status.");
  }

  const csv = buildCsv(
    ["nama_peserta", "referensi", "kategori", "status", "waktu_utc", "metode", "petugas", "catatan"],
    rows.map((row) => [
      row.participant_name,
      row.participant_external_ref,
      row.category,
      row.status,
      new Date(row.checked_in_at).toISOString(),
      row.method,
      row.recorded_by_name,
      row.note,
    ]),
  );
  const filename = `absensi-${slugify(access.eventName)}.csv`;
  return { raw: csvResponse(csv, filename) };
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

async function listEventTransactions(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "recap:read");
  const query = parseQuery(ctx.request, TransactionListQuerySchema);

  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (query.cursor && !cursor) throw validationError("Cursor tidak valid");

  const filters: TransactionFilters = {
    activityId: query.activityId,
    sessionId: query.sessionId,
    type: query.type,
    status: query.status,
    effective: query.effective,
  };

  const rows = await listTransactions(
    ctx.env.DB,
    eventId,
    filters,
    cursor ? ({ occurredAt: cursor.createdAt, id: cursor.id } satisfies TransactionCursor) : null,
    query.limit,
  );

  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const last = items.at(-1);

  const payload: TransactionListPayload = {
    items: items.map(toTransaction),
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.occurred_at, id: last.id })
        : null,
  };

  return { data: payload };
}

async function manualAttendance(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  const access = await requireEventAccess(ctx.env, auth, eventId, "attendance:manual");

  // OQ-034 [A]: Super Admin never performs Manual Check-in, even though
  // `isAllowed` lets it pass every matrix entry.
  if (auth.user.role === "superadmin") {
    throw forbidden("Super Admin tidak berwenang melakukan Manual Check-in");
  }

  const body = await parseJsonBody(ctx.request, AttendanceManualRequestSchema);

  const event = await findEventById(ctx.env.DB, eventId);
  if (!event) throw notFound("Acara tidak ditemukan");

  if (event.allow_manual !== 1) {
    throw businessRule("Acara ini tidak mengizinkan pencatatan manual");
  }

  const participant = await findParticipant(ctx.env.DB, eventId, body.participantId);
  if (!participant) throw notFound("Peserta tidak ditemukan pada acara ini");

  const context = await resolveAttendanceContext(ctx.env.DB, {
    eventId,
    activityId: body.activityId,
    sessionId: body.sessionId,
  });

  const rejection = lifecycleRejection({
    event,
    activity: context.activity,
    session: context.session,
    participant,
    now: ctx.now,
  });

  if (rejection !== null) {
    throw businessRule(scanMessage(rejection), { reason: rejection });
  }

  const rules = await listRulesForContext(ctx.env.DB, {
    themeId: eventId,
    participantId: participant.id,
    categoryId: participant.category_id,
    activityId: context.activity.id,
    sessionId: context.session?.id ?? null,
  });

  const entitlement = resolveEntitlement(
    {
      participantId: participant.id,
      categoryId: participant.category_id,
      activityId: context.activity.id,
      sessionId: context.session?.id ?? null,
    },
    rules,
  );

  if (!entitlement.allowed) {
    throw businessRule(scanMessage("entitlement_denied"), {
      reason: "entitlement_denied",
    });
  }

  if (access.membershipRole === "officer") {
    const assignment = await findEffectiveAssignment(ctx.env.DB, {
      themeId: eventId,
      activityId: context.activity.id,
      sessionId: context.session?.id ?? null,
      userId: auth.user.id,
    });

    if (!assignment) {
      throw forbidden("Anda tidak ditugaskan pada Aktivitas/Sesi ini");
    }
    if (assignment.can_manual_check_in !== 1) {
      throw forbidden("Manual Check-in belum diaktifkan untuk penugasan Anda");
    }
  }

  const transactionId = newId(ctx.now);
  const note = body.note ?? null;
  const ipHash = await clientIpHash(ctx.request, ctx.env.SESSION_PEPPER);

  const results = await ctx.env.DB.batch([
    insertTransactionStatement(ctx.env.DB, {
      id: transactionId,
      themeId: eventId,
      activityId: context.activity.id,
      sessionId: context.session?.id ?? null,
      participantId: participant.id,
      type: "attendance",
      source: "manual",
      status: body.status,
      occurredAt: ctx.now,
      deviceTs: null,
      recordedBy: auth.user.id,
      note,
      slotNo: null,
      adjustsTransactionId: null,
      now: ctx.now,
    }),
    enqueueTransactionStatement(ctx.env.DB, {
      id: newId(ctx.now),
      eventId,
      participantId: participant.id,
      transactionId,
      now: ctx.now,
    }),
    insertAuditAfterTransactionStatement(
      ctx.env.DB,
      {
        id: newId(ctx.now),
        eventId,
        actorUserId: auth.user.id,
        action: "transaction.manual",
        entityType: "transaction",
        entityId: transactionId,
        after: filterAuditFields(
          "transaction",
          transactionSnapshot(
            {
              id: transactionId,
              theme_id: eventId,
              activity_id: context.activity.id,
              session_id: context.session?.id ?? null,
              participant_id: participant.id,
              type: "attendance",
              source: "manual",
              status: body.status,
              occurred_at: ctx.now,
              adjusts_transaction_id: null,
              reversed_at: null,
              superseded_at: null,
            },
            { noteChanged: note !== null },
          ),
        ),
        ipHash,
        createdAt: ctx.now,
      },
      transactionId,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw conflict("Peserta ini sudah tercatat pada Aktivitas/Sesi tersebut");
  }

  const created = await findEffectiveTransactionForScope(ctx.env.DB, {
    themeId: eventId,
    participantId: participant.id,
    activityId: context.activity.id,
    sessionId: context.session?.id ?? null,
    type: "attendance",
  });

  if (!created) {
    throw new ApiError(
      500,
      "SYSTEM_ERROR",
      "Transaksi tidak dapat dibaca setelah pencatatan. Coba lagi.",
    );
  }

  const payload: AttendanceDetailPayload = {
    attendance: transactionToLegacy(created),
  };
  return { status: 201, data: payload };
}

async function reverseTransaction(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, transactionId } = parsePathParams(
    ctx.params,
    TransactionParamsSchema,
  );

  await requireEventAccess(ctx.env, auth, eventId, "transaction:correct");

  // D-024 [A]: corrections belong to the Tema's Admin, never to Super Admin.
  if (auth.user.role === "superadmin") {
    throw forbidden("Super Admin tidak berwenang mengoreksi transaksi");
  }

  const body = await parseJsonBody(ctx.request, ReversalRequestSchema);

  const event = await findEventById(ctx.env.DB, eventId);
  if (!event) throw notFound("Acara tidak ditemukan");
  if (event.status === "archived") {
    throw businessRule("Acara yang sudah diarsipkan tidak dapat dikoreksi");
  }

  const existing = await findTransactionById(ctx.env.DB, eventId, transactionId);
  if (!existing) throw notFound("Transaksi tidak ditemukan pada acara ini");

  if (existing.reversed_at !== null) {
    throw conflict("Transaksi sudah dibatalkan");
  }
  if (existing.superseded_at !== null) {
    throw conflict("Transaksi sudah diganti oleh Adjustment");
  }

  if (
    body.expectedUpdatedAt !== undefined &&
    body.expectedUpdatedAt !== existing.updated_at
  ) {
    throw conflict("Transaksi sudah berubah. Muat ulang sebelum mengoreksi.");
  }

  const ipHash = await clientIpHash(ctx.request, ctx.env.SESSION_PEPPER);
  const before = filterAuditFields(
    "transaction",
    transactionSnapshot(existing),
  );

  const results = await ctx.env.DB.batch([
    reverseTransactionStatement(ctx.env.DB, {
      themeId: eventId,
      transactionId,
      actorUserId: auth.user.id,
      now: ctx.now,
      expectedUpdatedAt: body.expectedUpdatedAt,
    }),
    enqueueCorrectionStatement(ctx.env.DB, {
      id: newId(ctx.now),
      eventId,
      participantId: existing.participant_id,
      transactionId,
      updatedAt: ctx.now,
      now: ctx.now,
    }),
    insertReversalCorrectionStatement(ctx.env.DB, {
      id: newId(ctx.now),
      transactionId,
      reason: body.reason,
      actorUserId: auth.user.id,
      beforeJson: before === null ? null : JSON.stringify(before),
      now: ctx.now,
    }),
    insertAuditAfterReversalStatement(
      ctx.env.DB,
      {
        id: newId(ctx.now),
        eventId,
        actorUserId: auth.user.id,
        action: "transaction.reversal",
        entityType: "transaction",
        entityId: transactionId,
        before,
        after: filterAuditFields(
          "transaction",
          transactionSnapshot({ ...existing, reversed_at: ctx.now }),
        ),
        reason: body.reason,
        ipHash,
        createdAt: ctx.now,
      },
      transactionId,
      ctx.now,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw conflict("Transaksi sudah dibatalkan atau berubah. Muat ulang lalu coba lagi.");
  }

  const updated = await findTransactionById(ctx.env.DB, eventId, transactionId);
  if (!updated) throw notFound("Transaksi tidak ditemukan pada acara ini");

  const payload: TransactionDetailPayload = { transaction: toTransaction(updated) };
  return { data: payload };
}

async function adjustTransaction(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, transactionId } = parsePathParams(
    ctx.params,
    TransactionParamsSchema,
  );

  await requireEventAccess(ctx.env, auth, eventId, "transaction:correct");

  if (auth.user.role === "superadmin") {
    throw forbidden("Super Admin tidak berwenang mengoreksi transaksi");
  }

  const body = await parseJsonBody(ctx.request, AdjustmentRequestSchema);

  const event = await findEventById(ctx.env.DB, eventId);
  if (!event) throw notFound("Acara tidak ditemukan");
  if (event.status === "archived") {
    throw businessRule("Acara yang sudah diarsipkan tidak dapat dikoreksi");
  }

  const existing = await findTransactionById(ctx.env.DB, eventId, transactionId);
  if (!existing) throw notFound("Transaksi tidak ditemukan pada acara ini");

  if (existing.reversed_at !== null) {
    throw conflict("Transaksi sudah dibatalkan");
  }
  if (existing.superseded_at !== null) {
    throw conflict("Transaksi sudah diganti oleh Adjustment");
  }

  if (
    body.expectedUpdatedAt !== undefined &&
    body.expectedUpdatedAt !== existing.updated_at
  ) {
    throw conflict("Transaksi sudah berubah. Muat ulang sebelum mengoreksi.");
  }

  if (existing.type !== "attendance" && body.status !== undefined) {
    throw businessRule("Status hanya dapat diubah pada transaksi Attendance");
  }

  const nextOccurredAt = body.occurredAt ?? existing.occurred_at;
  const nextNote = body.note === undefined ? existing.note : body.note;
  const nextStatus = body.status === undefined ? existing.status : body.status;

  const diff = adjustmentDiff(
    {
      occurredAt: existing.occurred_at,
      note: existing.note,
      status: existing.status,
    },
    {
      occurredAt: nextOccurredAt,
      note: nextNote,
      status: nextStatus,
    },
  );

  if (!diff.changed) {
    throw businessRule("Tidak ada perubahan yang dikirim");
  }

  const replacementId = newId(ctx.now);
  const ipHash = await clientIpHash(ctx.request, ctx.env.SESSION_PEPPER);

  const results = await ctx.env.DB.batch([
    // Must run before the replacement insert so the partial unique index no
    // longer sees the old version as effective (ADR-0020).
    supersedeTransactionStatement(ctx.env.DB, {
      themeId: eventId,
      transactionId,
      actorUserId: auth.user.id,
      now: ctx.now,
      expectedUpdatedAt: body.expectedUpdatedAt,
    }),
    insertTransactionStatement(ctx.env.DB, {
      id: replacementId,
      themeId: eventId,
      activityId: existing.activity_id,
      sessionId: existing.session_id,
      participantId: existing.participant_id,
      type: existing.type,
      source: existing.source,
      status: nextStatus,
      occurredAt: nextOccurredAt,
      deviceTs: existing.device_ts,
      recordedBy: existing.recorded_by,
      note: nextNote,
      slotNo: existing.slot_no,
      adjustsTransactionId: transactionId,
      now: ctx.now,
    }),
    enqueueCorrectionStatement(ctx.env.DB, {
      id: newId(ctx.now),
      eventId,
      participantId: existing.participant_id,
      transactionId,
      updatedAt: ctx.now,
      now: ctx.now,
    }),
    insertAdjustmentCorrectionStatement(ctx.env.DB, {
      id: newId(ctx.now),
      transactionId,
      replacementId,
      reason: body.reason,
      actorUserId: auth.user.id,
      beforeJson: JSON.stringify(diff.before),
      afterJson: JSON.stringify(diff.after),
      now: ctx.now,
    }),
    insertAuditAfterAdjustmentStatement(
      ctx.env.DB,
      {
        id: newId(ctx.now),
        eventId,
        actorUserId: auth.user.id,
        action: "transaction.adjustment",
        entityType: "transaction",
        entityId: replacementId,
        before: filterAuditFields("transaction", diff.before),
        after: filterAuditFields("transaction", diff.after),
        reason: body.reason,
        ipHash,
        createdAt: ctx.now,
      },
      replacementId,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw conflict("Transaksi sudah dibatalkan atau berubah. Muat ulang lalu coba lagi.");
  }
  if ((results[1]?.meta.changes ?? 0) === 0) {
    throw conflict("Versi transaksi baru bertentangan dengan transaksi efektif lain");
  }

  const replacement = await findTransactionById(
    ctx.env.DB,
    eventId,
    replacementId,
  );
  if (!replacement) {
    throw new ApiError(
      500,
      "SYSTEM_ERROR",
      "Transaksi hasil Adjustment tidak dapat dibaca. Coba lagi.",
    );
  }

  const payload: TransactionDetailPayload = {
    transaction: toTransaction(replacement),
  };
  return { data: payload };
}

export const attendanceRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    pattern: "/api/events/:eventId/attendance/export",
    public: false,
    handler: exportEventAttendance,
  },
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
    method: "GET",
    pattern: "/api/events/:eventId/transactions",
    public: false,
    handler: listEventTransactions,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/transactions/:transactionId/reversal",
    public: false,
    handler: reverseTransaction,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/transactions/:transactionId/adjustment",
    public: false,
    handler: adjustTransaction,
  },
  {
    method: "GET",
    pattern: "/api/staff/attendance",
    public: false,
    handler: staffAttendanceHistory,
  },
];
