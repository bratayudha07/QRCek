import type { AttendanceMethod, AttendanceStatus } from "@absensi/shared";

/**
 * Compatibility reads for the legacy attendance endpoints (ADR-0022).
 *
 * Since Q5 the authoritative source is `transactions`; `attendance` is only a
 * historical table and is never written by new code. Every query here selects
 * an **effective Attendance transaction** and aliases it into the old response
 * shape until Q8 replaces the reporting surface.
 */

export interface AttendanceRow {
  id: string;
  event_id: string;
  participant_id: string;
  status: AttendanceStatus;
  checked_in_at: number;
  recorded_by: string | null;
  method: AttendanceMethod;
  note: string | null;
  created_at: number;
  updated_at: number;
}

export interface AttendanceJoinedRow extends AttendanceRow {
  event_name: string;
  participant_name: string;
  participant_external_ref: string | null;
  category: string | null;
  recorded_by_name: string | null;
}

export interface AttendanceFilters {
  query?: string;
  status: AttendanceStatus | "all";
}

export interface AttendanceCursor {
  checkedInAt: number;
  id: string;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export const ATTENDANCE_SELECT = `
  SELECT t.id,
         t.theme_id         AS event_id,
         t.participant_id,
         t.status,
         t.occurred_at      AS checked_in_at,
         t.recorded_by,
         t.source           AS method,
         t.note,
         t.created_at,
         t.updated_at,
         e.name             AS event_name,
         p.full_name        AS participant_name,
         p.external_ref     AS participant_external_ref,
         p.category         AS category,
         u.display_name     AS recorded_by_name
    FROM transactions t
    JOIN events e ON e.id = t.theme_id
    JOIN participants p
      ON p.id = t.participant_id AND p.event_id = t.theme_id
    LEFT JOIN users u ON u.id = t.recorded_by`;

const EFFECTIVE_ATTENDANCE = `
  t.type = 'attendance'
  AND t.reversed_at IS NULL
  AND t.superseded_at IS NULL`;

export async function findAttendanceById(
  db: D1Database,
  eventId: string,
  attendanceId: string,
): Promise<AttendanceJoinedRow | null> {
  return db
    .prepare(
      `${ATTENDANCE_SELECT}
        WHERE t.theme_id = ? AND t.id = ? AND ${EFFECTIVE_ATTENDANCE}`,
    )
    .bind(eventId, attendanceId)
    .first<AttendanceJoinedRow>();
}

export async function findAttendanceForParticipant(
  db: D1Database,
  eventId: string,
  participantId: string,
): Promise<AttendanceJoinedRow | null> {
  return db
    .prepare(
      `${ATTENDANCE_SELECT}
        WHERE t.theme_id = ? AND t.participant_id = ? AND ${EFFECTIVE_ATTENDANCE}
        ORDER BY t.occurred_at DESC, t.id DESC
        LIMIT 1`,
    )
    .bind(eventId, participantId)
    .first<AttendanceJoinedRow>();
}

export async function listAttendance(
  db: D1Database,
  eventId: string,
  filters: AttendanceFilters,
  cursor: AttendanceCursor | null,
  limit: number,
): Promise<AttendanceJoinedRow[]> {
  const clauses = ["t.theme_id = ?", EFFECTIVE_ATTENDANCE];
  const bindings: Array<string | number> = [eventId];

  if (filters.status !== "all") {
    clauses.push("t.status = ?");
    bindings.push(filters.status);
  }

  const query = filters.query?.trim();
  if (query) {
    const pattern = `%${escapeLike(query.toLowerCase())}%`;
    clauses.push(
      `(LOWER(p.full_name) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(p.external_ref, '')) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(p.category, '')) LIKE ? ESCAPE '\\')`,
    );
    bindings.push(pattern, pattern, pattern);
  }

  if (cursor) {
    clauses.push("(t.occurred_at < ? OR (t.occurred_at = ? AND t.id < ?))");
    bindings.push(cursor.checkedInAt, cursor.checkedInAt, cursor.id);
  }

  bindings.push(limit + 1);

  const { results } = await db
    .prepare(
      `${ATTENDANCE_SELECT}
        WHERE ${clauses.join(" AND ")}
        ORDER BY t.occurred_at DESC, t.id DESC
        LIMIT ?`,
    )
    .bind(...bindings)
    .all<AttendanceJoinedRow>();

  return results;
}

/**
 * Staff history: only rows this user recorded, and only for events they are
 * still assigned to (superadmin may see their own rows in any event).
 */
export async function listAttendanceByRecorder(
  db: D1Database,
  input: {
    userId: string;
    isSuperadmin: boolean;
    eventId?: string;
    cursor: AttendanceCursor | null;
    limit: number;
  },
): Promise<AttendanceJoinedRow[]> {
  const clauses = ["t.recorded_by = ?", EFFECTIVE_ATTENDANCE];
  const bindings: Array<string | number> = [input.userId];

  if (input.eventId) {
    clauses.push("t.theme_id = ?");
    bindings.push(input.eventId);
  }

  if (!input.isSuperadmin) {
    clauses.push(
      `EXISTS (SELECT 1 FROM event_memberships m
                WHERE m.event_id = t.theme_id
                  AND m.user_id = ?
                  AND m.status = 'active')`,
    );
    bindings.push(input.userId);
  }

  if (input.cursor) {
    clauses.push("(t.occurred_at < ? OR (t.occurred_at = ? AND t.id < ?))");
    bindings.push(input.cursor.checkedInAt, input.cursor.checkedInAt, input.cursor.id);
  }

  bindings.push(input.limit + 1);

  const { results } = await db
    .prepare(
      `${ATTENDANCE_SELECT}
        WHERE ${clauses.join(" AND ")}
        ORDER BY t.occurred_at DESC, t.id DESC
        LIMIT ?`,
    )
    .bind(...bindings)
    .all<AttendanceJoinedRow>();

  return results;
}

export interface AttendanceCounts {
  total: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  lastAttendanceAt: number | null;
}

export async function countAttendance(
  db: D1Database,
  eventId: string,
): Promise<AttendanceCounts> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) AS late,
              SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absent,
              SUM(CASE WHEN status = 'excused' THEN 1 ELSE 0 END) AS excused,
              MAX(occurred_at) AS last_attendance_at
         FROM transactions
        WHERE theme_id = ? AND type = 'attendance'
          AND reversed_at IS NULL AND superseded_at IS NULL`,
    )
    .bind(eventId)
    .first<{
      total: number;
      present: number | null;
      late: number | null;
      absent: number | null;
      excused: number | null;
      last_attendance_at: number | null;
    }>();

  return {
    total: row?.total ?? 0,
    present: row?.present ?? 0,
    late: row?.late ?? 0,
    absent: row?.absent ?? 0,
    excused: row?.excused ?? 0,
    lastAttendanceAt: row?.last_attendance_at ?? null,
  };
}

export async function listRecentAttendance(
  db: D1Database,
  eventId: string,
  limit: number,
): Promise<AttendanceJoinedRow[]> {
  const { results } = await db
    .prepare(
      `${ATTENDANCE_SELECT}
        WHERE t.theme_id = ? AND ${EFFECTIVE_ATTENDANCE}
        ORDER BY t.occurred_at DESC, t.id DESC
        LIMIT ?`,
    )
    .bind(eventId, limit)
    .all<AttendanceJoinedRow>();

  return results;
}
