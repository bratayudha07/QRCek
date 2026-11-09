import type { QrIdentityMetadataPayload, QrRotatePayload } from "@absensi/shared";
import { QrIdentityParamsSchema, RotateQrRequestSchema } from "@absensi/shared";

import { insertAuditAfterQrIdentityRotationStatement } from "../db/audit";
import { findParticipant } from "../db/participants";
import {
  findIdentityForParticipant,
  insertQrIdentityStatement,
  legacyQrCredential,
  rotateQrIdentityStatement,
} from "../db/qr-identities";
import { newId } from "../domain/ids";
import {
  QrConfigError,
  encodeQrPayload,
  issueQrCredential,
  qrKeyConfig,
} from "../domain/qr-token";
import { authOf, requireEventAccess, requireMutableEvent } from "../http/auth";
import { ApiError, conflict, notFound } from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { clientIpHash } from "../http/security";
import { parseJsonBody, parsePathParams } from "../http/validate";

/**
 * QR Identity rotation and metadata (DESAIN_API.md §5, ADR-0017).
 *
 * Rotation keeps the row id and replaces the credential in place, so a token
 * that has been rotated is immediately unknown to the scan lookup (FR-059)
 * while future transaction references stay stable (FR-060). The previous token
 * is never stored, logged, or audited; only a counter and reason are.
 */

function qrFailure(error: unknown): never {
  if (error instanceof QrConfigError) {
    console.error("qr_identity_config_error", { reason: error.message });
    throw new ApiError(
      500,
      "INTERNAL",
      "Kredensial QR tidak dapat diproses. Periksa konfigurasi server lalu coba lagi.",
    );
  }

  throw error;
}

async function rotateQr(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, participantId } = parsePathParams(ctx.params, QrIdentityParamsSchema);

  // Archived Tema is read-only (ADR-0015); this also scopes the id to the Tema.
  await requireMutableEvent(ctx.env, auth, eventId, "qr:rotate");

  const body = await parseJsonBody(ctx.request, RotateQrRequestSchema);

  const participant = await findParticipant(ctx.env.DB, eventId, participantId);
  if (!participant) throw notFound("Peserta tidak ditemukan");

  let identity = await findIdentityForParticipant(ctx.env.DB, eventId, participantId);

  // Deploy window / pre-0010 rows: a printed legacy credential must be promoted
  // before it can be rotated. Promotion copies the old token, so the old card
  // keeps working until the rotation statement below replaces it.
  if (!identity) {
    const legacy = legacyQrCredential(participant);
    if (!legacy) {
      throw notFound("QR peserta belum pernah diterbitkan. Cetak QR terlebih dahulu.");
    }

    await insertQrIdentityStatement(ctx.env.DB, {
      id: newId(ctx.now),
      themeId: eventId,
      participantId,
      credential: legacy.credential,
      issuedAt: legacy.issuedAt,
    }).run();

    identity = await findIdentityForParticipant(ctx.env.DB, eventId, participantId);
    if (!identity) {
      throw new ApiError(500, "INTERNAL", "QR peserta tidak dapat disiapkan untuk rotasi");
    }
  }

  const config = await qrKeyConfig(ctx.env).catch((error: unknown) => qrFailure(error));

  const { token, credential } = await issueQrCredential(config).catch((error: unknown) =>
    qrFailure(error),
  );

  const nextRotationCount = identity.rotation_count + 1;
  const ipHash = await clientIpHash(ctx.request, ctx.env.SESSION_PEPPER);

  const results = await ctx.env.DB.batch([
    rotateQrIdentityStatement(ctx.env.DB, {
      themeId: eventId,
      participantId,
      credential,
      rotatedAt: ctx.now,
      expectedRotationCount: identity.rotation_count,
    }),
    insertAuditAfterQrIdentityRotationStatement(
      ctx.env.DB,
      {
        id: newId(ctx.now),
        eventId,
        actorUserId: auth.user.id,
        action: "qr.identity_rotated",
        entityType: "qr_identity",
        entityId: identity.id,
        after: {
          themeId: eventId,
          participantId,
          keyVersion: credential.keyVersion,
          rotationCount: nextRotationCount,
        },
        reason: body.reason,
        ipHash,
        createdAt: ctx.now,
      },
      identity.id,
      credential.tokenHash,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    // Another admin rotated between our read and write. No audit row was written
    // (the guard failed too), so the caller can retry with fresh state.
    throw conflict("QR peserta baru saja dirotasi oleh pengguna lain. Muat ulang lalu coba lagi.");
  }

  const payload: QrRotatePayload = {
    participantId,
    issuedAt: identity.issued_at,
    rotatedAt: ctx.now,
    rotationCount: nextRotationCount,
    keyVersion: credential.keyVersion,
    qr: encodeQrPayload(token),
  };

  return { data: payload };
}

async function getQrMetadata(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, participantId } = parsePathParams(ctx.params, QrIdentityParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "qr:print");

  const participant = await findParticipant(ctx.env.DB, eventId, participantId);
  if (!participant) throw notFound("Peserta tidak ditemukan");

  const identity = await findIdentityForParticipant(ctx.env.DB, eventId, participantId);

  const payload: QrIdentityMetadataPayload = {
    participantId,
    identity: identity
      ? {
          participantId,
          issuedAt: identity.issued_at,
          rotatedAt: identity.rotated_at,
          rotationCount: identity.rotation_count,
          keyVersion: identity.key_version,
        }
      : null,
  };

  return { data: payload };
}

export const qrIdentityRoutes: readonly RouteDefinition[] = [
  {
    method: "PUT",
    pattern: "/api/events/:eventId/participants/:participantId/qr/rotate",
    public: false,
    handler: rotateQr,
  },
  {
    method: "GET",
    pattern: "/api/events/:eventId/participants/:participantId/qr",
    public: false,
    handler: getQrMetadata,
  },
];
