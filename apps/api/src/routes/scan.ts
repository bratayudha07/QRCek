import { z } from "zod";

import type { ScanResultPayload } from "@absensi/shared";
import { EventIdSchema, ScanRequestSchema } from "@absensi/shared";

import { insertAuditAfterAttendanceStatement, recordAudit } from "../db/audit";
import { findAttendanceForParticipant, insertAttendanceStatement } from "../db/attendance";
import { findEventById } from "../db/events";
import { enqueueAttendanceStatement } from "../db/outbox";
import type { ParticipantRow } from "../db/participants";
import { findParticipantByQrHash } from "../db/participants";
import { consumeRateLimit } from "../db/rate-limit";
import { isEventOpenForAttendance } from "../domain/attendance-policy";
import { newId } from "../domain/ids";
import { QrConfigError, hashQrToken, parseQrPayload, qrPepper } from "../domain/qr-token";
import { authOf, requireEventAccess } from "../http/auth";
import { ApiError, notFound, rateLimited } from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { clientIpHash } from "../http/security";
import { parseJsonBody, parsePathParams } from "../http/validate";

/**
 * QR scan (DESAIN_API.md §7, AGENTS.md §Integritas data).
 *
 * The QR payload is only a lookup key. Authorization comes from the session and
 * the event membership; the payload never names a participant, an event, or a
 * role. A token from another event is rejected after the lookup and audited.
 *
 * Business outcomes return HTTP 200 with a `result` discriminant. Only auth,
 * validation, rate-limit, and system failures use 4xx/5xx.
 */

const EventParamsSchema = z.object({ eventId: EventIdSchema });

/** Per-session and per-event windows, stored in D1 (no paid rate limiter). */
const SESSION_SCAN_LIMIT = { windowMs: 60_000, limit: 120 };
const EVENT_SCAN_LIMIT = { windowMs: 60_000, limit: 600 };

function participantPayload(row: ParticipantRow): NonNullable<ScanResultPayload["participant"]> {
  return {
    id: row.id,
    fullName: row.full_name,
    externalRef: row.external_ref,
    category: row.category,
  };
}

function qrFailure(error: unknown): never {
  if (error instanceof QrConfigError) {
    console.error("scan_qr_config_error", { reason: error.message });
    throw new ApiError(
      500,
      "INTERNAL",
      "Konfigurasi QR belum siap. Hubungi administrator.",
    );
  }

  throw error;
}

async function scan(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "scan");
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
    const payload: ScanResultPayload = { result: "not_found" };
    return { data: payload };
  }

  let tokenHash: string;
  try {
    tokenHash = await hashQrToken(qrPepper(ctx.env), token);
  } catch (error) {
    qrFailure(error);
  }

  const participant = await findParticipantByQrHash(ctx.env.DB, tokenHash);
  if (!participant) {
    const payload: ScanResultPayload = { result: "not_found" };
    return { data: payload };
  }

  const ipHash = await clientIpHash(ctx.request, ctx.env.SESSION_PEPPER);

  if (participant.event_id !== eventId) {
    // Audited, but the response deliberately returns no event or participant
    // details so a scanned label cannot be used to enumerate another event.
    await recordAudit(ctx.env.DB, {
      id: newId(ctx.now),
      eventId,
      actorUserId: auth.user.id,
      action: "attendance.wrong_event",
      entityType: "participant",
      entityId: participant.id,
      after: { participantEventId: participant.event_id },
      ipHash,
      createdAt: ctx.now,
    });

    const payload: ScanResultPayload = { result: "wrong_event" };
    return { data: payload };
  }

  const event = await findEventById(ctx.env.DB, eventId);
  if (!event) throw notFound("Acara tidak ditemukan");

  if (!isEventOpenForAttendance(event, ctx.now)) {
    const payload: ScanResultPayload = { result: "event_closed", eventName: event.name };
    return { data: payload };
  }

  if (participant.status !== "active") {
    const payload: ScanResultPayload = {
      result: "participant_inactive",
      participant: participantPayload(participant),
    };
    return { data: payload };
  }

  const attendanceId = newId(ctx.now);

  const results = await ctx.env.DB.batch([
    insertAttendanceStatement(ctx.env.DB, {
      id: attendanceId,
      eventId,
      participantId: participant.id,
      status: "present",
      checkedInAt: ctx.now,
      recordedBy: auth.user.id,
      method: "qr_scan",
      note: null,
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
          status: "present",
          method: "qr_scan",
          deviceTs: body.deviceTs ?? null,
        },
        ipHash,
        createdAt: ctx.now,
      },
      attendanceId,
    ),
  ]);

  const inserted = (results[0]?.meta.changes ?? 0) > 0;

  if (inserted) {
    const payload: ScanResultPayload = {
      result: "present",
      participant: participantPayload(participant),
      attendance: { status: "present", checkedInAt: ctx.now },
    };
    return { data: payload };
  }

  // Lost the race, or the participant already attended. Read the authoritative
  // row and report it as `duplicate` — never as a 500.
  const existing = await findAttendanceForParticipant(ctx.env.DB, eventId, participant.id);

  if (!existing) {
    throw new ApiError(
      500,
      "INTERNAL",
      "Absensi tidak dapat dibaca setelah pencatatan. Coba lagi.",
    );
  }

  const payload: ScanResultPayload = {
    result: "duplicate",
    participant: participantPayload(participant),
    attendance: { status: existing.status, checkedInAt: existing.checked_in_at },
  };
  return { data: payload };
}

export const scanRoutes: readonly RouteDefinition[] = [
  { method: "POST", pattern: "/api/events/:eventId/scan", public: false, handler: scan },
];
