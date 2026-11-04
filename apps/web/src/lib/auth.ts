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
