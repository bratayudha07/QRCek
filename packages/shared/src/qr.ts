import type { ParticipantStatus } from "./schemas/participants";

/**
 * QR Identity rules shared by the Worker and (later) the web client
 * (ADR-0017, FR-054–FR-065).
 *
 * Nothing here performs I/O: scan decisions, rotation input bounds, and payload
 * shapes are pure so they can be unit tested without D1 or Web Crypto.
 */

/** A rotation invalidates printed cards, so a meaningful reason is required. */
export const QR_ROTATION_REASON_MIN = 3;
export const QR_ROTATION_REASON_MAX = 500;

/**
 * Why a resolved identity may not be used. `wrong_theme` is kept separate from
 * `participant_inactive` so the scan route can keep its existing `wrong_event`
 * result code and audit entry instead of leaking participant state across Temas.
 */
export type QrScanRejection = "wrong_theme" | "participant_inactive";

export type QrScanDecision =
  | { outcome: "usable" }
  | { outcome: "rejected"; reason: QrScanRejection };

export interface QrScanContext {
  /** Tema the scan request is scoped to. */
  contextThemeId: string;
  /** Tema stored on the resolved identity. */
  identityThemeId: string;
  participantStatus: ParticipantStatus;
}

/**
 * Decides whether a resolved identity may be used in a scan context.
 *
 * Theme scope is checked before participant status: a token from another Tema
 * must look wrong without revealing whether that participant is active.
 */
export function decideQrScan(input: QrScanContext): QrScanDecision {
  if (input.identityThemeId !== input.contextThemeId) {
    return { outcome: "rejected", reason: "wrong_theme" };
  }

  if (input.participantStatus !== "active") {
    return { outcome: "rejected", reason: "participant_inactive" };
  }

  return { outcome: "usable" };
}

/**
 * Metadata that is safe to show outside an export response. It never contains
 * the token, hash, ciphertext, nonce, or any participant PII (FR-200).
 */
export interface QrIdentityMetadata {
  participantId: string;
  issuedAt: number;
  rotatedAt: number | null;
  rotationCount: number;
  keyVersion: number;
}

export interface QrIdentityMetadataPayload {
  participantId: string;
  /** `null` when no credential has been issued yet (lazy issuance). */
  identity: QrIdentityMetadata | null;
}

/**
 * Rotation response. `qr` is the opaque scan payload (`absensi:v1:<token>`),
 * returned only to an authorized caller so it can immediately reprint; it is
 * never written to logs or audit.
 */
export interface QrRotatePayload extends QrIdentityMetadata {
  qr: string;
}
