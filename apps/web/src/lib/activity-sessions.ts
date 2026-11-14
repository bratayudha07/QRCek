import type {
  ActivitySession,
  ActivitySessionCreateRequest,
  ActivitySessionDetailPayload,
  ActivitySessionStatusPayload,
  ActivitySessionUpdateRequest,
  SessionStatus,
} from "@absensi/shared";
import { allowedSessionTransitions, canArchiveSession } from "@absensi/shared";

import { activitySessionsPath } from "./activities";
import { apiRequest } from "./http";

/**
 * Typed bindings and pure view helpers for Sesi (DESAIN_API.md §6, Q1).
 *
 * Status is never inferred from the clock; archive is a separate action
 * (`archivedAt`), not a status value (ADR-0012, FR-206).
 */

export function activitySessionPath(
  eventId: string,
  activityId: string,
  sessionId: string,
): string {
  return `${activitySessionsPath(eventId, activityId)}/${encodeURIComponent(sessionId)}`;
}

export function activitySessionStatusPath(
  eventId: string,
  activityId: string,
  sessionId: string,
): string {
  return `${activitySessionPath(eventId, activityId, sessionId)}/status`;
}

export function activitySessionArchivePath(
  eventId: string,
  activityId: string,
  sessionId: string,
): string {
  return `${activitySessionPath(eventId, activityId, sessionId)}/archive`;
}

export function activitySessionDuplicatePath(
  eventId: string,
  activityId: string,
  sessionId: string,
): string {
  return `${activitySessionPath(eventId, activityId, sessionId)}/duplicate`;
}

export function getActivitySession(
  eventId: string,
  activityId: string,
  sessionId: string,
) {
  return apiRequest<ActivitySessionDetailPayload>(
    activitySessionPath(eventId, activityId, sessionId),
  );
}

export function createActivitySession(
  eventId: string,
  activityId: string,
  input: ActivitySessionCreateRequest,
) {
  return apiRequest<ActivitySessionDetailPayload>(
    activitySessionsPath(eventId, activityId),
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function updateActivitySession(
  eventId: string,
  activityId: string,
  sessionId: string,
  input: ActivitySessionUpdateRequest,
) {
  return apiRequest<ActivitySessionDetailPayload>(
    activitySessionPath(eventId, activityId, sessionId),
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function changeActivitySessionStatus(
  eventId: string,
  activityId: string,
  sessionId: string,
  status: SessionStatus,
) {
  return apiRequest<ActivitySessionStatusPayload>(
    activitySessionStatusPath(eventId, activityId, sessionId),
    { method: "POST", body: JSON.stringify({ status }) },
  );
}

export function archiveActivitySession(
  eventId: string,
  activityId: string,
  sessionId: string,
) {
  return apiRequest<ActivitySessionDetailPayload>(
    activitySessionArchivePath(eventId, activityId, sessionId),
    { method: "POST" },
  );
}

export function duplicateActivitySession(
  eventId: string,
  activityId: string,
  sessionId: string,
) {
  return apiRequest<ActivitySessionDetailPayload>(
    activitySessionDuplicatePath(eventId, activityId, sessionId),
    { method: "POST" },
  );
}

const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  scheduled: "Terjadwal",
  in_progress: "Berlangsung",
  completed: "Selesai",
  disabled: "Dinonaktifkan",
};

export function sessionStatusLabel(status: SessionStatus): string {
  return SESSION_STATUS_LABEL[status];
}

export interface SessionTransitionAction {
  status: SessionStatus;
  label: string;
}

/** Target status label. Completed/disabled are final (ADR-0012). */
const SESSION_TRANSITION_LABEL: Record<SessionStatus, string> = {
  scheduled: "Jadwalkan ulang",
  in_progress: "Mulai",
  completed: "Selesaikan",
  disabled: "Nonaktifkan",
};

export function sessionTransitionActions(
  status: SessionStatus,
): SessionTransitionAction[] {
  return allowedSessionTransitions(status).map((next) => ({
    status: next,
    label: SESSION_TRANSITION_LABEL[next],
  }));
}

/**
 * Archive is allowed only after the Sesi finished or was disabled (OQ-033), and
 * only once. The Worker is still authoritative.
 */
export function canArchiveActivitySession(
  session: Pick<ActivitySession, "status" | "archivedAt">,
): boolean {
  return session.archivedAt === null && canArchiveSession(session.status);
}

/**
 * Client-side mirror of the schema refinement. `null` means "not set" and is
 * always valid; equal bounds are allowed.
 */
export function sessionTimeRangeError(
  startsAt: number | null,
  endsAt: number | null,
): string | null {
  if (startsAt === null || endsAt === null) return null;
  return endsAt < startsAt ? "Waktu selesai tidak boleh sebelum waktu mulai" : null;
}
