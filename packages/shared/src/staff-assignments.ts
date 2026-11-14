import type { ActivityStatus } from "./schemas/activities";
import type { SessionStatus } from "./schemas/activity-sessions";

/**
 * Response contracts for Petugas assignments and the scanner context list
 * (DESAIN_API.md §4, §7; ADR-0021).
 *
 * An assignment binds one user to one Aktivitas, optionally narrowed to one
 * Sesi. `canManualCheckIn` opens Manual Entry for that assignment only; it never
 * changes entitlement (FR-101, BR-051).
 */

export const STAFF_ASSIGNMENT_STATUSES = ["active", "revoked"] as const;
export type StaffAssignmentStatus = (typeof STAFF_ASSIGNMENT_STATUSES)[number];

export interface StaffAssignment {
  id: string;
  themeId: string;
  userId: string;
  userDisplayName: string;
  activityId: string;
  activityName: string;
  sessionId: string | null;
  sessionName: string | null;
  canManualCheckIn: boolean;
  status: StaffAssignmentStatus;
  createdAt: number;
  updatedAt: number;
  revokedAt: number | null;
}

export interface StaffAssignmentListPayload {
  assignments: StaffAssignment[];
}

export interface StaffAssignmentDetailPayload {
  assignment: StaffAssignment;
}

/**
 * One selectable scanner context for the signed-in user.
 *
 * Lifecycle status is sent so the UI can disable a context with a reason while
 * the Worker remains the final authority.
 */
export interface StaffContext {
  assignmentId: string;
  themeId: string;
  themeName: string;
  activityId: string;
  activityName: string;
  sessionId: string | null;
  sessionName: string | null;
  activityStatus: ActivityStatus;
  sessionStatus: SessionStatus | null;
  canManualCheckIn: boolean;
}

export interface StaffContextListPayload {
  contexts: StaffContext[];
}

/**
 * Scanner readiness of one context. The Worker remains the final authority; this
 * only disables an obviously closed context and gives the operator a reason.
 */
export function staffContextReadiness(context: StaffContext): {
  ready: boolean;
  reason: string | null;
} {
  if (context.activityStatus === "archived") {
    return { ready: false, reason: "Aktivitas sudah diarsipkan" };
  }
  if (context.activityStatus === "draft") {
    return { ready: false, reason: "Aktivitas belum diaktifkan" };
  }
  if (context.activityStatus === "completed") {
    return { ready: false, reason: "Aktivitas sudah selesai" };
  }

  if (context.sessionId !== null) {
    if (context.sessionStatus === "scheduled") {
      return { ready: false, reason: "Sesi belum dimulai" };
    }
    if (context.sessionStatus === "completed") {
      return { ready: false, reason: "Sesi sudah selesai" };
    }
    if (context.sessionStatus === "disabled") {
      return { ready: false, reason: "Sesi dinonaktifkan" };
    }
  }

  return { ready: true, reason: null };
}
