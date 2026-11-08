import type { ActivityStatus } from "./schemas/activities";
import type { SessionStatus } from "./schemas/activity-sessions";

/**
 * Lifecycle tables for Aktivitas and Sesi (ADR-0012).
 *
 * Shared so the UI and the Worker cannot disagree about which transition is
 * possible. The Worker still makes the authoritative decision.
 *
 * Rules that are deliberately absent:
 *   - no reopen (`completed → active`, `disabled → scheduled`);
 *   - no `active → archived` for Aktivitas (it must complete first);
 *   - Sesi archive is a separate `archived_at` action, not a status value.
 */

export const ACTIVITY_TRANSITIONS: Readonly<
  Record<ActivityStatus, readonly ActivityStatus[]>
> = {
  draft: ["active", "archived"],
  active: ["completed"],
  completed: ["archived"],
  archived: [],
};

export const SESSION_TRANSITIONS: Readonly<
  Record<SessionStatus, readonly SessionStatus[]>
> = {
  scheduled: ["in_progress", "disabled"],
  in_progress: ["completed", "disabled"],
  completed: [],
  disabled: [],
};

/** Sesi may be archived only after it finished or was cancelled (OQ-033). */
export const SESSION_ARCHIVABLE_FROM = ["completed", "disabled"] as const;
export type SessionArchivableStatus = (typeof SESSION_ARCHIVABLE_FROM)[number];

export function allowedActivityTransitions(
  from: ActivityStatus,
): readonly ActivityStatus[] {
  return ACTIVITY_TRANSITIONS[from];
}

export function canTransitionActivity(from: ActivityStatus, to: ActivityStatus): boolean {
  return ACTIVITY_TRANSITIONS[from].includes(to);
}

export function allowedSessionTransitions(from: SessionStatus): readonly SessionStatus[] {
  return SESSION_TRANSITIONS[from];
}

export function canTransitionSession(from: SessionStatus, to: SessionStatus): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}

export function canArchiveSession(status: SessionStatus): boolean {
  return (SESSION_ARCHIVABLE_FROM as readonly SessionStatus[]).includes(status);
}
