import type {
  ActivityCreateRequest,
  ActivityDetailPayload,
  ActivityListPayload,
  ActivitySessionListPayload,
  ActivityStatus,
  ActivityStatusPayload,
  ActivityUpdateRequest,
  EventAccessRole,
  EventStatus,
  TransactionType,
} from "@absensi/shared";
import { allowedActivityTransitions } from "@absensi/shared";

import { apiRequest } from "./http";

/**
 * Typed bindings and pure view helpers for Aktivitas (DESAIN_API.md §6, Q1).
 *
 * The Worker owns the lifecycle: `activityTransitionActions` only mirrors the
 * shared transition table so the UI cannot offer a status the API rejects.
 */

export function activitiesPath(eventId: string): string {
  return `/api/events/${encodeURIComponent(eventId)}/activities`;
}

export function activityPath(eventId: string, activityId: string): string {
  return `${activitiesPath(eventId)}/${encodeURIComponent(activityId)}`;
}

export function activityStatusPath(eventId: string, activityId: string): string {
  return `${activityPath(eventId, activityId)}/status`;
}

export function activitySessionsPath(eventId: string, activityId: string): string {
  return `${activityPath(eventId, activityId)}/sessions`;
}

export function listActivities(eventId: string) {
  return apiRequest<ActivityListPayload>(activitiesPath(eventId));
}

export function listActivitySessions(eventId: string, activityId: string) {
  return apiRequest<ActivitySessionListPayload>(
    activitySessionsPath(eventId, activityId),
  );
}

export function createActivity(eventId: string, input: ActivityCreateRequest) {
  return apiRequest<ActivityDetailPayload>(activitiesPath(eventId), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateActivity(
  eventId: string,
  activityId: string,
  input: ActivityUpdateRequest,
) {
  return apiRequest<ActivityDetailPayload>(activityPath(eventId, activityId), {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function changeActivityStatus(
  eventId: string,
  activityId: string,
  status: ActivityStatus,
) {
  return apiRequest<ActivityStatusPayload>(activityStatusPath(eventId, activityId), {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

const ACTIVITY_STATUS_LABEL: Record<ActivityStatus, string> = {
  draft: "Draf",
  active: "Aktif",
  completed: "Selesai",
  archived: "Diarsipkan",
};

export function activityStatusLabel(status: ActivityStatus): string {
  return ACTIVITY_STATUS_LABEL[status];
}

const TRANSACTION_TYPE_LABEL: Record<TransactionType, string> = {
  attendance: "Absensi",
  consumption: "Konsumsi",
};

export function transactionTypeLabel(type: TransactionType): string {
  return TRANSACTION_TYPE_LABEL[type];
}

export interface ActivityTransitionAction {
  status: ActivityStatus;
  label: string;
}

/** Target status label. `draft` is never a transition target (ADR-0012). */
const ACTIVITY_TRANSITION_LABEL: Record<ActivityStatus, string> = {
  draft: "Kembalikan ke draf",
  active: "Aktifkan",
  completed: "Selesaikan",
  archived: "Arsipkan",
};

export function activityTransitionActions(
  status: ActivityStatus,
): ActivityTransitionAction[] {
  return allowedActivityTransitions(status).map((next) => ({
    status: next,
    label: ACTIVITY_TRANSITION_LABEL[next],
  }));
}

/**
 * Only Admin Acara and Super Admin may write, and never on an archived Tema.
 * The Worker re-checks this on every request; this only decides what renders.
 */
export function canManageActivities(
  accessRole: EventAccessRole,
  eventStatus: EventStatus,
): boolean {
  return (
    (accessRole === "event_admin" || accessRole === "superadmin") && eventStatus !== "archived"
  );
}
