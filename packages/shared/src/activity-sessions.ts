import type { SessionStatus } from "./schemas/activity-sessions";

/** Response contracts for Sesi (DESAIN_API.md §6). */

export interface ActivitySession {
  id: string;
  activityId: string;
  name: string;
  location: string | null;
  startsAt: number | null;
  endsAt: number | null;
  status: SessionStatus;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ActivitySessionListPayload {
  sessions: ActivitySession[];
}

export interface ActivitySessionDetailPayload {
  session: ActivitySession;
}

export interface ActivitySessionStatusPayload {
  session: ActivitySession;
}
