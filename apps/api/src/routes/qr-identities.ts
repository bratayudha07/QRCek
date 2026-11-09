import type { QrIdentityMetadataPayload, QrRotatePayload } from "@absensi/shared";
import {
  QrIdentityParamsSchema,
  RotateQrRequestSchema,
  filterAuditFields,
} from "@absensi/shared";

import { insertAuditAfterQrIdentityRotationStatement } from "../db/audit";
import { findParticipant } from "../db/participants";
import {
  findIdentityForParticipant,
  insertQrIdentityStatement,
  legacyQrCredential,
  mirrorRotatedCredentialToLegacyStatement,
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
 * while future transaction references stay stable (FR-060). The legacy
 * `participants.qr_*` mirror is updated in the same batch so a Worker rollback
 * cannot revive the revoked token. The previous token is never stored, logged,
 * or audited; only a counter and reason are.
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

  // A retry after a successful rotation must not revoke the token the client
  // may already have received. The caller echoes the count it saw; a stale
  // count returns 409 before a second credential is generated.
  if (
    body.expectedRotationCount !== undefined &&
    body.expectedRotationCount !== identity.rotation_count
  ) {
    throw conflict("QR peserta sudah dirotasi sejak data dimuat. Muat ulang lalu coba lagi.");
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
    // Keep the pre-0010 columns consistent for a possible Worker rollback.
    mirrorRotatedCredentialToLegacyStatement(ctx.env.DB, {
      identityId: identity.id,
      themeId: eventId,
      participantId,
      credential,
      issuedAt: identity.issued_at,
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
        // Filtering here keeps the FR-207 invariant inside the route instead of
        // relying on every future caller to remember the allowlist.
        after: filterAuditFields("qr_identity", {
          themeId: eventId,
          participantId,
          keyVersion: credential.keyVersion,
          rotationCount: nextRotationCount,
        }),
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

  if ((results[1]?.meta.changes ?? 0) === 0) {
    // The identity rotated but the legacy mirror did not. The batch already
    // committed, so throwing would tell the caller the rotation failed when it
    // did not. Log the invariant (ids only, never credential material) so ops
    // can repair the mirror before a rollback can revive the old token.
    console.error("qr_identity_mirror_missing", {
      eventId,
      participantId,
      identityId: identity.id,
    });
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

  // Deploy window: a credential printed by the previous Worker is still valid
  // but has not been promoted yet. Report it read-only; GET never writes.
  const legacy = identity ? null : legacyQrCredential(participant);

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
      : legacy
        ? {
            participantId,
            issuedAt: legacy.issuedAt,
            rotatedAt: null,
            rotationCount: 0,
            keyVersion: legacy.credential.keyVersion,
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
