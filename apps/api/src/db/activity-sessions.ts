import type { SessionStatus } from "@absensi/shared";

/** Data access for activity sessions (DESAIN_API.md §6). No business rules. */

export interface ActivitySessionRow {
  id: string;
  activity_id: string;
  name: string;
  location: string | null;
  starts_at: number | null;
  ends_at: number | null;
  status: SessionStatus;
  archived_at: number | null;
  created_at: number;
  created_by: string | null;
  updated_at: number;
  updated_by: string | null;
}

export async function listActivitySessions(
  db: D1Database,
  activityId: string,
): Promise<ActivitySessionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM activity_sessions
        WHERE activity_id = ?
        ORDER BY starts_at IS NULL, starts_at ASC, created_at ASC, id ASC`,
    )
    .bind(activityId)
    .all<ActivitySessionRow>();

  return results;
}

/** Scoped by `activity_id`: a session id from another activity is not found. */
export async function findActivitySession(
  db: D1Database,
  activityId: string,
  sessionId: string,
): Promise<ActivitySessionRow | null> {
  return db
    .prepare("SELECT * FROM activity_sessions WHERE id = ? AND activity_id = ?")
    .bind(sessionId, activityId)
    .first<ActivitySessionRow>();
}

export function insertActivitySessionStatement(
  db: D1Database,
  input: {
    id: string;
    activityId: string;
    name: string;
    location: string | null;
    startsAt: number | null;
    endsAt: number | null;
    createdBy: string;
    createdAt: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO activity_sessions
         (id, activity_id, name, location, starts_at, ends_at, status,
          created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.activityId,
      input.name,
      input.location,
      input.startsAt,
      input.endsAt,
      input.createdAt,
      input.createdBy,
      input.createdAt,
      input.createdBy,
    );
}

export interface ActivitySessionUpdate {
  name?: string;
  location?: string | null;
  startsAt?: number | null;
  endsAt?: number | null;
}

export function updateActivitySessionStatement(
  db: D1Database,
  input: {
    activityId: string;
    sessionId: string;
    update: ActivitySessionUpdate;
    actorUserId: string;
    now: number;
    expectedUpdatedAt: number;
  },
): D1PreparedStatement {
  const sets = ["updated_at = ?", "updated_by = ?"];
  const values: Array<string | number | null> = [input.now, input.actorUserId];

  if (input.update.name !== undefined) {
    sets.push("name = ?");
    values.push(input.update.name);
  }
  if (input.update.location !== undefined) {
    sets.push("location = ?");
    values.push(input.update.location);
  }
  if (input.update.startsAt !== undefined) {
    sets.push("starts_at = ?");
    values.push(input.update.startsAt);
  }
  if (input.update.endsAt !== undefined) {
    sets.push("ends_at = ?");
    values.push(input.update.endsAt);
  }

  values.push(input.sessionId, input.activityId, input.expectedUpdatedAt);

  return db
    .prepare(
      `UPDATE activity_sessions
          SET ${sets.join(", ")}
        WHERE id = ? AND activity_id = ? AND updated_at = ? AND archived_at IS NULL`,
    )
    .bind(...values);
}

export function updateActivitySessionStatusStatement(
  db: D1Database,
  input: {
    activityId: string;
    sessionId: string;
    fromStatus: SessionStatus;
    status: SessionStatus;
    actorUserId: string;
    now: number;
    expectedUpdatedAt: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE activity_sessions
          SET status = ?, updated_at = ?, updated_by = ?
        WHERE id = ? AND activity_id = ? AND updated_at = ? AND status = ?
          AND archived_at IS NULL`,
    )
    .bind(
      input.status,
      input.now,
      input.actorUserId,
      input.sessionId,
      input.activityId,
      input.expectedUpdatedAt,
      input.fromStatus,
    );
}

/** Sets `archived_at`; the operational status is left untouched (FR-206). */
export function archiveActivitySessionStatement(
  db: D1Database,
  input: {
    activityId: string;
    sessionId: string;
    actorUserId: string;
    now: number;
    expectedUpdatedAt: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE activity_sessions
          SET archived_at = ?, updated_at = ?, updated_by = ?
        WHERE id = ? AND activity_id = ? AND updated_at = ?
          AND archived_at IS NULL
          AND status IN ('completed','disabled')`,
    )
    .bind(
      input.now,
      input.now,
      input.actorUserId,
      input.sessionId,
      input.activityId,
      input.expectedUpdatedAt,
    );
}

/**
 * Copy configuration only; the new session always starts at `scheduled` with no
 * archived_at and no transactions (BR-048).
 */
export function duplicateActivitySessionStatement(
  db: D1Database,
  input: {
    id: string;
    activityId: string;
    sourceSessionId: string;
    actorUserId: string;
    now: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO activity_sessions
         (id, activity_id, name, location, starts_at, ends_at, status, archived_at,
          created_at, created_by, updated_at, updated_by)
       SELECT ?, activity_id, name, location, starts_at, ends_at, 'scheduled', NULL,
              ?, ?, ?, ?
         FROM activity_sessions
        WHERE id = ? AND activity_id = ?`,
    )
    .bind(
      input.id,
      input.now,
      input.actorUserId,
      input.now,
      input.actorUserId,
      input.sourceSessionId,
      input.activityId,
    );
}
