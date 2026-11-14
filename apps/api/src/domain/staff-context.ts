import type { ActivityStatus, SessionStatus, StaffContext } from "@absensi/shared";

import type { StaffContextSourceRow } from "../db/staff-assignments";

export { staffContextReadiness } from "@absensi/shared";

/**
 * Pure expansion of raw assignment rows into selectable scanner contexts
 * (Q6 §6.5). No I/O, so the precedence rules are unit tested directly.
 *
 * Rules:
 *  1. An archived Aktivitas or Sesi is never selectable.
 *  2. An Activity-level assignment expands to every non-archived Sesi it owns.
 *  3. A Sesi assignment overrides the Activity-level assignment for that Sesi,
 *     including `canManualCheckIn` and the assignment id.
 *  4. An Aktivitas without Sesi yields exactly one context with `sessionId = null`.
 */

function contextKey(activityId: string, sessionId: string | null): string {
  return `${activityId}::${sessionId ?? ""}`;
}

export function expandStaffContexts(rows: readonly StaffContextSourceRow[]): StaffContext[] {
  const byKey = new Map<string, StaffContext>();

  for (const row of rows) {
    if (row.activity_archived_at !== null) continue;
    if (row.session_id !== null && row.session_archived_at !== null) continue;

    const key = contextKey(row.activity_id, row.session_id);
    const existing = byKey.get(key);

    // A Sesi-level row (`session_id` set on the assignment) is more specific
    // than an Activity-level row that expanded to the same Sesi.
    if (existing && row.session_id === null) continue;

    byKey.set(key, {
      assignmentId: row.assignment_id,
      themeId: row.theme_id,
      themeName: row.theme_name,
      activityId: row.activity_id,
      activityName: row.activity_name,
      sessionId: row.session_id,
      sessionName: row.session_name,
      activityStatus: row.activity_status as ActivityStatus,
      sessionStatus: (row.session_status as SessionStatus | null) ?? null,
      canManualCheckIn: row.can_manual_check_in === 1,
    });
  }

  return [...byKey.values()];
}
