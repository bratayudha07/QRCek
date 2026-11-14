import type { ActivityListPayload, ActivitySessionListPayload } from "@absensi/shared";

import { apiRequest } from "./http";

/** Typed bindings for Aktivitas/Sesi lists used by the assignment UI (Q6). */

export function activitiesPath(eventId: string): string {
  return `/api/events/${encodeURIComponent(eventId)}/activities`;
}

export function activitySessionsPath(eventId: string, activityId: string): string {
  return `${activitiesPath(eventId)}/${encodeURIComponent(activityId)}/sessions`;
}

export function listActivities(eventId: string) {
  return apiRequest<ActivityListPayload>(activitiesPath(eventId));
}

export function listActivitySessions(eventId: string, activityId: string) {
  return apiRequest<ActivitySessionListPayload>(
    activitySessionsPath(eventId, activityId),
  );
}
