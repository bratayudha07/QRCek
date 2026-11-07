import type { ActivityStatus, TransactionType } from "@absensi/shared";

/** Data access for activities (DESAIN_API.md §6). No business rules here. */

export interface ActivityRow {
  id: string;
  theme_id: string;
  name: string;
  description: string | null;
  transaction_type: TransactionType;
  status: ActivityStatus;
  location: string | null;
  sort_order: number;
  created_at: number;
  created_by: string | null;
  updated_at: number;
  updated_by: string | null;
  archived_at: number | null;
}

export async function listActivities(
  db: D1Database,
  themeId: string,
): Promise<ActivityRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM activities
        WHERE theme_id = ?
        ORDER BY sort_order ASC, created_at ASC, id ASC`,
    )
    .bind(themeId)
    .all<ActivityRow>();

  return results;
}

/**
 * Scoped by `theme_id` on purpose: an activity id from another Tema resolves to
 * `null` (→ 404) instead of becoming an IDOR.
 */
export async function findActivity(
  db: D1Database,
  themeId: string,
  activityId: string,
): Promise<ActivityRow | null> {
  return db
    .prepare("SELECT * FROM activities WHERE id = ? AND theme_id = ?")
    .bind(activityId, themeId)
    .first<ActivityRow>();
}

export function insertActivityStatement(
  db: D1Database,
  input: {
    id: string;
    themeId: string;
    name: string;
    description: string | null;
    transactionType: TransactionType;
    location: string | null;
    sortOrder: number;
    createdBy: string;
    createdAt: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO activities
         (id, theme_id, name, description, transaction_type, status, location,
          sort_order, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.themeId,
      input.name,
      input.description,
      input.transactionType,
      input.location,
      input.sortOrder,
      input.createdAt,
      input.createdBy,
      input.createdAt,
      input.createdBy,
    );
}

export interface ActivityUpdate {
  name?: string;
  description?: string | null;
  location?: string | null;
  sortOrder?: number;
}

/**
 * Optimistic update: `updated_at` must still match what the caller read, and an
 * archived activity is never writable. The audit statement in the same batch
 * re-checks the new `updated_at`, so a lost race writes no audit row.
 */
export function updateActivityStatement(
  db: D1Database,
  input: {
    themeId: string;
    activityId: string;
    update: ActivityUpdate;
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
  if (input.update.description !== undefined) {
    sets.push("description = ?");
    values.push(input.update.description);
  }
  if (input.update.location !== undefined) {
    sets.push("location = ?");
    values.push(input.update.location);
  }
  if (input.update.sortOrder !== undefined) {
    sets.push("sort_order = ?");
    values.push(input.update.sortOrder);
  }

  values.push(input.activityId, input.themeId, input.expectedUpdatedAt);

  return db
    .prepare(
      `UPDATE activities
          SET ${sets.join(", ")}
        WHERE id = ? AND theme_id = ? AND updated_at = ? AND status <> 'archived'`,
    )
    .bind(...values);
}

export function updateActivityStatusStatement(
  db: D1Database,
  input: {
    themeId: string;
    activityId: string;
    fromStatus: ActivityStatus;
    status: ActivityStatus;
    actorUserId: string;
    now: number;
    expectedUpdatedAt: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE activities
          SET status = ?, archived_at = ?, updated_at = ?, updated_by = ?
        WHERE id = ? AND theme_id = ? AND updated_at = ? AND status = ?`,
    )
    .bind(
      input.status,
      input.status === "archived" ? input.now : null,
      input.now,
      input.actorUserId,
      input.activityId,
      input.themeId,
      input.expectedUpdatedAt,
      input.fromStatus,
    );
}
