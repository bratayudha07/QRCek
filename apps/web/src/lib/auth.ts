import type {
  ActivatePayload,
  MePayload,
  RecoveryCodePayload,
  SessionListPayload,
} from "@absensi/shared";

import { apiRequest } from "./http";

/** Thin typed bindings for the auth endpoints. No business rules here. */

export function fetchMe() {
  return apiRequest<MePayload>("/api/auth/me");
}

function withLabel(label: string): { label?: string } {
  const trimmed = label.trim();
  return trimmed === "" ? {} : { label: trimmed };
}

export function activateAccount(token: string, label: string) {
  return apiRequest<ActivatePayload>("/api/auth/activate", {
    method: "POST",
    body: JSON.stringify({ token, ...withLabel(label) }),
  });
}

export function recoverAccount(recoveryCode: string, label: string) {
  return apiRequest<ActivatePayload>("/api/auth/recover", {
    method: "POST",
    body: JSON.stringify({ recoveryCode, ...withLabel(label) }),
  });
}

/**
 * ADR-007: self-service registration. The account is an `event_admin` that owns
 * only the events it creates. `turnstileToken` is present only when the build
 * has a site key configured.
 */
export function registerAccount(displayName: string, label: string, turnstileToken?: string) {
  return apiRequest<ActivatePayload>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      displayName: displayName.trim(),
      ...withLabel(label),
      ...(turnstileToken ? { turnstileToken } : {}),
    }),
  });
}

export function logoutSession() {
  return apiRequest<{ revoked: true }>("/api/auth/logout", { method: "POST" });
}

export function listSessions() {
  return apiRequest<SessionListPayload>("/api/auth/sessions");
}

export function revokeSession(sessionId: string) {
  return apiRequest<{ revoked: true }>(
    `/api/auth/sessions/${encodeURIComponent(sessionId)}/revoke`,
    { method: "POST" },
  );
}

export function rotateRecoveryCode() {
  return apiRequest<RecoveryCodePayload>("/api/auth/recovery-code", { method: "POST" });
}
