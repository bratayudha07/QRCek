import type { EventStatus } from "@absensi/shared";

/** Aggregate queries for the global and per-event dashboards. */

export interface DashboardEventRow {
  id: string;
  name: string;
  status: EventStatus;
  starts_at: number | null;
  ends_at: number | null;
  created_at: number;
  access_role: "superadmin" | "event_admin" | "officer";
  participant_count: number;
  present_count: number;
}

/**
 * One query, one aggregate per event. `present` means a status that counts as
 * attended (`present` or `late`); `absent`/`excused` are corrections, not
 * attendance.
 */
export async function listDashboardEvents(
  db: D1Database,
  input: { userId: string; isSuperadmin: boolean },
): Promise<DashboardEventRow[]> {
  const flag = input.isSuperadmin ? 1 : 0;

  const { results } = await db
    .prepare(
      `SELECT e.id, e.name, e.status, e.starts_at, e.ends_at, e.created_at,
              CASE WHEN ? = 1 THEN 'superadmin' ELSE m.role END AS access_role,
              (SELECT COUNT(*) FROM participants p
                WHERE p.event_id = e.id) AS participant_count,
              (SELECT COUNT(*) FROM attendance a
                WHERE a.event_id = e.id
                  AND a.status IN ('present','late')) AS present_count
         FROM events e
         LEFT JOIN event_memberships m
           ON m.event_id = e.id AND m.user_id = ? AND m.status = 'active'
        WHERE ? = 1 OR m.id IS NOT NULL
        ORDER BY e.created_at DESC, e.id DESC`,
    )
    .bind(flag, input.userId, flag)
    .all<DashboardEventRow>();

  return results;
}
