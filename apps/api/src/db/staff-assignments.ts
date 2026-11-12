/**
 * Data access for `staff_assignments` (ADR-0021).
 *
 * Q5 only reads assignments; the management UI/endpoint is Q6. The most
 * specific active assignment wins: a Sesi assignment overrides the Activity
 * assignment for that Sesi.
 */

export interface StaffAssignmentRow {
  id: string;
  theme_id: string;
  activity_id: string;
  session_id: string | null;
  user_id: string;
  can_manual_check_in: number;
  status: "active" | "revoked";
  created_at: number;
  created_by: string | null;
  updated_at: number;
  updated_by: string | null;
  revoked_at: number | null;
}

/**
 * Returns the effective assignment for one user and context, or `null`.
 *
 * When `sessionId` is `null` only an Activity-level assignment applies. When a
 * Sesi is requested, an active Sesi assignment is preferred; otherwise the
 * Activity-level assignment (which covers all its Sesi) is used.
 */
export async function findEffectiveAssignment(
  db: D1Database,
  input: {
    themeId: string;
    activityId: string;
    sessionId: string | null;
    userId: string;
  },
): Promise<StaffAssignmentRow | null> {
  if (input.sessionId === null) {
    return db
      .prepare(
        `SELECT * FROM staff_assignments
          WHERE theme_id = ? AND activity_id = ? AND session_id IS NULL
            AND user_id = ? AND status = 'active'`,
      )
      .bind(input.themeId, input.activityId, input.userId)
      .first<StaffAssignmentRow>();
  }

  return db
    .prepare(
      `SELECT * FROM staff_assignments
        WHERE theme_id = ? AND activity_id = ? AND user_id = ? AND status = 'active'
          AND (session_id IS NULL OR session_id = ?)
        ORDER BY session_id IS NOT NULL DESC, created_at ASC, id ASC
        LIMIT 1`,
    )
    .bind(input.themeId, input.activityId, input.userId, input.sessionId)
    .first<StaffAssignmentRow>();
}

export function insertStaffAssignmentStatement(
  db: D1Database,
  input: {
    id: string;
    themeId: string;
    activityId: string;
    sessionId: string | null;
    userId: string;
    canManualCheckIn: boolean;
    now: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO staff_assignments
         (id, theme_id, activity_id, session_id, user_id, can_manual_check_in,
          status, created_at, created_by, updated_at, updated_by, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?, NULL, NULL)`,
    )
    .bind(
      input.id,
      input.themeId,
      input.activityId,
      input.sessionId,
      input.userId,
      input.canManualCheckIn ? 1 : 0,
      input.now,
      input.now,
    );
}
