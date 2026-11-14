/**
 * Data access for `staff_assignments` (ADR-0021).
 *
 * Q5 only read assignments; Q6 adds the management/query surface. The most
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

/** Management list: assignment plus the labels the UI needs, never PII beyond a display name. */
export interface StaffAssignmentJoinedRow extends StaffAssignmentRow {
  user_display_name: string;
  activity_name: string;
  session_name: string | null;
}

/** One raw row per (assignment × applicable Sesi); the pure expander dedupes. */
export interface StaffContextSourceRow {
  assignment_id: string;
  can_manual_check_in: number;
  theme_id: string;
  theme_name: string;
  activity_id: string;
  activity_name: string;
  activity_status: string;
  activity_archived_at: number | null;
  session_id: string | null;
  session_name: string | null;
  session_status: string | null;
  session_archived_at: number | null;
}

export type StaffAssignmentStatusFilter = "active" | "revoked" | "all";

/** Hard cap: assignments per Tema are small; this keeps the response bounded. */
const ASSIGNMENT_LIST_LIMIT = 500;

const ASSIGNMENT_SELECT = `
  SELECT sa.id, sa.theme_id, sa.activity_id, sa.session_id, sa.user_id,
         sa.can_manual_check_in, sa.status, sa.created_at, sa.created_by,
         sa.updated_at, sa.updated_by, sa.revoked_at,
         u.display_name AS user_display_name,
         a.name AS activity_name,
         s.name AS session_name
    FROM staff_assignments sa
    JOIN users u ON u.id = sa.user_id
    JOIN activities a ON a.id = sa.activity_id
    LEFT JOIN activity_sessions s ON s.id = sa.session_id`;

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

export async function listThemeAssignments(
  db: D1Database,
  themeId: string,
  status: StaffAssignmentStatusFilter,
): Promise<StaffAssignmentJoinedRow[]> {
  const { results } = await db
    .prepare(
      `${ASSIGNMENT_SELECT}
        WHERE sa.theme_id = ? AND (? = 'all' OR sa.status = ?)
        ORDER BY sa.created_at ASC, sa.id ASC
        LIMIT ?`,
    )
    .bind(themeId, status, status, ASSIGNMENT_LIST_LIMIT)
    .all<StaffAssignmentJoinedRow>();

  return results;
}

/** Scoped by `theme_id`: an assignment id from another Tema resolves to `null`. */
export async function findAssignmentById(
  db: D1Database,
  themeId: string,
  assignmentId: string,
): Promise<StaffAssignmentJoinedRow | null> {
  return db
    .prepare(`${ASSIGNMENT_SELECT} WHERE sa.id = ? AND sa.theme_id = ?`)
    .bind(assignmentId, themeId)
    .first<StaffAssignmentJoinedRow>();
}

/**
 * Active assignments of one user, expanded across the Sesi of Activity-level
 * assignments. Archived Aktivitas/Sesi rows are returned so the caller can show
 * a reason instead of silently hiding a revoked context.
 */
export async function listUserContexts(
  db: D1Database,
  userId: string,
): Promise<StaffContextSourceRow[]> {
  const { results } = await db
    .prepare(
      `SELECT sa.id AS assignment_id,
              sa.can_manual_check_in,
              e.id AS theme_id, e.name AS theme_name,
              a.id AS activity_id, a.name AS activity_name,
              a.status AS activity_status, a.archived_at AS activity_archived_at,
              s.id AS session_id, s.name AS session_name,
              s.status AS session_status, s.archived_at AS session_archived_at
         FROM staff_assignments sa
         JOIN events e ON e.id = sa.theme_id
         JOIN activities a ON a.id = sa.activity_id
         LEFT JOIN activity_sessions s
           ON s.activity_id = sa.activity_id
          AND (sa.session_id IS NULL OR s.id = sa.session_id)
        WHERE sa.user_id = ? AND sa.status = 'active'
        ORDER BY e.name ASC, a.sort_order ASC, a.name ASC,
                 s.starts_at IS NULL, s.starts_at ASC, s.created_at ASC, s.id ASC`,
    )
    .bind(userId)
    .all<StaffContextSourceRow>();

  return results;
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
    createdBy: string;
    now: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO staff_assignments
         (id, theme_id, activity_id, session_id, user_id, can_manual_check_in,
          status, created_at, created_by, updated_at, updated_by, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL)`,
    )
    .bind(
      input.id,
      input.themeId,
      input.activityId,
      input.sessionId,
      input.userId,
      input.canManualCheckIn ? 1 : 0,
      input.now,
      input.createdBy,
      input.now,
      input.createdBy,
    );
}

/** Only an active assignment can be toggled; a revoked row stays revoked. */
export function updateAssignmentManualFlagStatement(
  db: D1Database,
  input: {
    themeId: string;
    assignmentId: string;
    canManualCheckIn: boolean;
    actorUserId: string;
    now: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE staff_assignments
          SET can_manual_check_in = ?, updated_at = ?, updated_by = ?
        WHERE id = ? AND theme_id = ? AND status = 'active'`,
    )
    .bind(
      input.canManualCheckIn ? 1 : 0,
      input.now,
      input.actorUserId,
      input.assignmentId,
      input.themeId,
    );
}

/** Revocation keeps the row; history is never deleted (BR-052, FR-104). */
export function revokeStaffAssignmentStatement(
  db: D1Database,
  input: {
    themeId: string;
    assignmentId: string;
    actorUserId: string;
    now: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE staff_assignments
          SET status = 'revoked', revoked_at = ?, updated_at = ?, updated_by = ?
        WHERE id = ? AND theme_id = ? AND status = 'active'`,
    )
    .bind(input.now, input.now, input.actorUserId, input.assignmentId, input.themeId);
}
