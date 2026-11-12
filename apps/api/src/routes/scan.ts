import { z } from "zod";

import type { ScanResultPayload, ScanTransaction } from "@absensi/shared";
import {
  EventIdSchema,
  ScanRequestSchema,
  decideQrScan,
  filterAuditFields,
  resolveEntitlement,
} from "@absensi/shared";

import { insertAuditAfterTransactionStatement, recordAudit } from "../db/audit";
import { findEventById } from "../db/events";
import { listRulesForContext } from "../db/entitlement-rules";
import { enqueueTransactionStatement } from "../db/outbox";
import type { ParticipantRow } from "../db/participants";
import { findIdentityParticipantByHash } from "../db/qr-identities";
import { consumeRateLimit } from "../db/rate-limit";
import {
  findEffectiveTransactionForScope,
  insertTransactionStatement,
} from "../db/transactions";
import type { TransactionJoinedRow } from "../db/transactions";
import { findEffectiveAssignment } from "../db/staff-assignments";
import { newId } from "../domain/ids";
import {
  QrConfigError,
  hashQrToken,
  parseQrPayload,
  qrPepper,
} from "../domain/qr-token";
import {
  lifecycleRejection,
  scanMessage,
  transactionSnapshot,
} from "../domain/transactions";
import { resolveAttendanceContext } from "../services/transaction-context";
import { authOf, requireEventAccess } from "../http/auth";
import { ApiError, forbidden, notFound, rateLimited } from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { clientIpHash } from "../http/security";
import { parseJsonBody, parsePathParams } from "../http/validate";

/**
 * QR scan (DESAIN_API.md §7, ADR-0018/0019/0021/0022).
 *
 * The QR payload is only a lookup key. Authorization comes from the session,
 * the Tema membership, and — for Petugas — an active assignment on the chosen
 * Aktivitas/Sesi. A token from another Tema is indistinguishable from an
 * unknown token in the response and audited as `attendance.wrong_theme`.
 *
 * Business outcomes return HTTP 200 with a stable `result`; request/auth
 * failures and unexpected errors keep their 4xx/5xx envelope.
 */

const EventParamsSchema = z.object({ eventId: EventIdSchema });

/** Per-session and per-event windows, stored in D1 (no paid rate limiter). */
const SESSION_SCAN_LIMIT = { windowMs: 60_000, limit: 120 };
const EVENT_SCAN_LIMIT = { windowMs: 60_000, limit: 600 };

function participantPayload(
  row: ParticipantRow,
): NonNullable<ScanResultPayload["participant"]> {
  return {
    id: row.id,
    fullName: row.full_name,
    externalRef: row.external_ref,
    category: row.category,
  };
}

function transactionPayload(row: TransactionJoinedRow): ScanTransaction {
  return {
    id: row.id,
    activityId: row.activity_id,
    sessionId: row.session_id,
    occurredAt: row.occurred_at,
    status: row.status,
  };
}

function businessResult(input: {
  result: ScanResultPayload["result"];
  reason: ScanResultPayload["reason"];
  participant?: ParticipantRow;
  transaction?: TransactionJoinedRow;
}): RouteResult {
  const payload: ScanResultPayload = {
    result: input.result,
    reason: input.reason,
    message: scanMessage(input.reason),
  };

  if (input.participant) payload.participant = participantPayload(input.participant);
  if (input.transaction) payload.transaction = transactionPayload(input.transaction);

  return { data: payload };
}

function qrFailure(error: unknown): never {
  if (error instanceof QrConfigError) {
    console.error("scan_qr_config_error", { reason: error.message });
    throw new ApiError(
      500,
      "SYSTEM_ERROR",
      "Konfigurasi QR belum siap. Hubungi administrator.",
    );
  }

  throw error;
}

async function scan(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  const access = await requireEventAccess(ctx.env, auth, eventId, "scan");

  // ADR-0021: Super Admin is read-only across Temas. `isAllowed` lets it pass
  // every matrix check, so the denial must be explicit here.
  if (auth.user.role === "superadmin") {
    throw forbidden("Super Admin tidak berwenang melakukan scan transaksional");
  }

  const body = await parseJsonBody(ctx.request, ScanRequestSchema);

  const sessionLimit = await consumeRateLimit(ctx.env.DB, {
    bucket: `scan:session:${auth.sessionId}`,
    now: ctx.now,
    ...SESSION_SCAN_LIMIT,
  });
  if (!sessionLimit.allowed) throw rateLimited(sessionLimit.retryAfterSeconds);

  const eventLimit = await consumeRateLimit(ctx.env.DB, {
    bucket: `scan:event:${eventId}`,
    now: ctx.now,
    ...EVENT_SCAN_LIMIT,
  });
  if (!eventLimit.allowed) throw rateLimited(eventLimit.retryAfterSeconds);

  const token = parseQrPayload(body.qr);
  if (token === null) {
    return businessResult({
      result: "INVALID_QR",
      reason: "qr_invalid",
    });
  }

  let tokenHash: string;
  try {
    tokenHash = await hashQrToken(qrPepper(ctx.env), token);
  } catch (error) {
    qrFailure(error);
  }

  const participant = await findIdentityParticipantByHash(ctx.env.DB, tokenHash);
  if (!participant) {
    return businessResult({
      result: "INVALID_QR",
      reason: "qr_invalid",
    });
  }

  const ipHash = await clientIpHash(ctx.request, ctx.env.SESSION_PEPPER);

  const decision = decideQrScan({
    contextThemeId: eventId,
    identityThemeId: participant.identity_theme_id,
    participantStatus: participant.status,
  });

  if (decision.outcome === "rejected" && decision.reason === "wrong_theme") {
    // Audited, but the response deliberately returns no event or participant
    // details so a scanned label cannot be used to enumerate another Tema.
    await recordAudit(ctx.env.DB, {
      id: newId(ctx.now),
      eventId,
      actorUserId: auth.user.id,
      action: "attendance.wrong_theme",
      entityType: "scan_attempt",
      entityId: null,
      after: { outcome: "wrong_theme" },
      ipHash,
      createdAt: ctx.now,
    });

    return businessResult({
      result: "INVALID_QR",
      reason: "qr_invalid",
    });
  }

  if (decision.outcome === "rejected" && decision.reason === "participant_inactive") {
    return businessResult({
      result: "NOT_ENTITLED",
      reason: "participant_inactive",
      participant,
    });
  }

  const event = await findEventById(ctx.env.DB, eventId);
  if (!event) throw notFound("Acara tidak ditemukan");

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
    return businessResult({
      result: "NOT_ENTITLED",
      reason: rejection,
      participant,
    });
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
    return businessResult({
      result: "NOT_ENTITLED",
      reason: "entitlement_denied",
      participant,
    });
  }

  // Petugas must be assigned to this exact Aktivitas/Sesi; URL parameters are
  // preselection, never authorization (FR-100, FR-190). Admins of the Tema do
  // not need an assignment.
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
  }

  const transactionId = newId(ctx.now);

  const results = await ctx.env.DB.batch([
    insertTransactionStatement(ctx.env.DB, {
      id: transactionId,
      themeId: eventId,
      activityId: context.activity.id,
      sessionId: context.session?.id ?? null,
      participantId: participant.id,
      type: "attendance",
      source: "qr_scan",
      status: "present",
      occurredAt: ctx.now,
      deviceTs: body.deviceTs ?? null,
      recordedBy: auth.user.id,
      note: null,
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
        action: "transaction.recorded",
        entityType: "transaction",
        entityId: transactionId,
        after: filterAuditFields(
          "transaction",
          transactionSnapshot({
            id: transactionId,
            theme_id: eventId,
            activity_id: context.activity.id,
            session_id: context.session?.id ?? null,
            participant_id: participant.id,
            type: "attendance",
            source: "qr_scan",
            status: "present",
            occurred_at: ctx.now,
            adjusts_transaction_id: null,
            reversed_at: null,
            superseded_at: null,
          }),
        ),
        ipHash,
        createdAt: ctx.now,
      },
      transactionId,
    ),
  ]);

  const inserted = (results[0]?.meta.changes ?? 0) > 0;

  if (inserted) {
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

    return businessResult({
      result: "SUCCESS",
      reason: null,
      participant,
      transaction: created,
    });
  }

  // Lost the race, or the participant already attended this scope. The
  // authoritative row is read back and reported as DUPLICATE, never a 500.
  const existing = await findEffectiveTransactionForScope(ctx.env.DB, {
    themeId: eventId,
    participantId: participant.id,
    activityId: context.activity.id,
    sessionId: context.session?.id ?? null,
    type: "attendance",
  });

  if (!existing) {
    throw new ApiError(
      500,
      "SYSTEM_ERROR",
      "Transaksi efektif tidak dapat dibaca setelah konflik. Coba lagi.",
    );
  }

  return businessResult({
    result: "DUPLICATE",
    reason: "duplicate",
    participant,
    transaction: existing,
  });
}

export const scanRoutes: readonly RouteDefinition[] = [
  {
    method: "POST",
    pattern: "/api/events/:eventId/scan",
    public: false,
    handler: scan,
  },
];
