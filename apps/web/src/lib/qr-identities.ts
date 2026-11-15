import type {
  EventAccessRole,
  EventStatus,
  QrIdentityMetadata,
  QrIdentityMetadataPayload,
  QrRotatePayload,
  RotateQrRequest,
} from "@absensi/shared";
import { QR_ROTATION_REASON_MAX, QR_ROTATION_REASON_MIN } from "@absensi/shared";

import { formatDateTime } from "./format";
import { apiRequest } from "./http";

/**
 * Typed bindings and pure view helpers for QR Identity metadata and rotation
 * (DESAIN_API.md §5, ADR-0017).
 *
 * The Worker owns rotation: the reason bounds, the archived-Tema guard, and the
 * optimistic `expectedRotationCount` check. This module only builds paths and
 * turns metadata into strings a card can render. No token, hash, or ciphertext
 * ever reaches this layer except in the one-shot rotation payload.
 */

function participantBasePath(eventId: string, participantId: string): string {
  return `/api/events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(participantId)}`;
}

export function qrIdentityPath(eventId: string, participantId: string): string {
  return `${participantBasePath(eventId, participantId)}/qr`;
}

export function qrRotatePath(eventId: string, participantId: string): string {
  return `${qrIdentityPath(eventId, participantId)}/rotate`;
}

export function getQrIdentity(eventId: string, participantId: string) {
  return apiRequest<QrIdentityMetadataPayload>(qrIdentityPath(eventId, participantId));
}

export function rotateQrIdentity(
  eventId: string,
  participantId: string,
  input: RotateQrRequest,
) {
  return apiRequest<QrRotatePayload>(qrRotatePath(eventId, participantId), {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/**
 * The metadata route requires `qr:print` (Admin Acara or Super Admin), so the
 * card must not be mounted for a Petugas or on an archived Tema — it would only
 * produce a 403. The Worker re-checks this on the request itself.
 */
export function canRotateQr(accessRole: EventAccessRole, eventStatus: EventStatus): boolean {
  return (
    (accessRole === "event_admin" || accessRole === "superadmin") && eventStatus !== "archived"
  );
}

/**
 * Mirrors `RotateQrRequestSchema`: trimmed length, not raw length, so
 * whitespace cannot satisfy the minimum. Messages match the Worker's, so the
 * client never shows a different rule than the one enforced server-side.
 */
export function rotationReasonError(reason: string): string | null {
  const trimmed = reason.trim();

  if (trimmed.length < QR_ROTATION_REASON_MIN) {
    return `Alasan rotasi minimal ${QR_ROTATION_REASON_MIN} karakter`;
  }

  if (trimmed.length > QR_ROTATION_REASON_MAX) {
    return `Alasan rotasi maksimal ${QR_ROTATION_REASON_MAX} karakter`;
  }

  return null;
}

/** One-line card summary. Contains no token, hash, or participant PII. */
export function rotationSummary(
  identity: QrIdentityMetadata | null,
  timeZone: string,
): string {
  if (identity === null) return "Belum pernah diterbitkan";

  const parts = [`Diterbitkan ${formatDateTime(identity.issuedAt, timeZone)}`];

  if (identity.rotationCount === 0) {
    parts.push("belum pernah dirotasi");
  } else {
    parts.push(`${identity.rotationCount} kali dirotasi`);

    if (identity.rotatedAt !== null) {
      parts.push(`terakhir ${formatDateTime(identity.rotatedAt, timeZone)}`);
    }
  }

  return parts.join(" · ");
}

/**
 * Request body for a rotation. `expectedRotationCount` echoes the metadata the
 * admin is looking at; the Worker answers 409 instead of revoking a credential
 * another tab may already have delivered.
 */
export function nextRotationRequest(
  identity: QrIdentityMetadata,
  reason: string,
): RotateQrRequest {
  return {
    reason: reason.trim(),
    expectedRotationCount: identity.rotationCount,
  };
}
