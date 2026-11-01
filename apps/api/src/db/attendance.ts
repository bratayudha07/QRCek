import type { AttendanceMethod, AttendanceStatus } from "@absensi/shared";

/**
 * Data access for attendance (DESAIN_DATABASE.md §3).
 *
 * Duplicate prevention is the `UNIQUE (event_id, participant_id)` constraint,
 * not a SELECT before INSERT. Every write here either relies on `ON CONFLICT
 * DO NOTHING` or on the unique index rejecting the row.
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
  SELECT a.*,
         e.name               AS event_name,
         p.full_name          AS participant_name,
         p.external_ref       AS participant_external_ref,
         p.category           AS category,
         u.display_name       AS recorded_by_name
    FROM attendance a
    JOIN events e ON e.id = a.event_id
    JOIN participants p
      ON p.id = a.participant_id AND p.event_id = a.event_id
    LEFT JOIN users u ON u.id = a.recorded_by`;

export async function findAttendanceById(
  db: D1Database,
  eventId: string,
  attendanceId: string,
): Promise<AttendanceJoinedRow | null> {
  return db
    .prepare(`${ATTENDANCE_SELECT} WHERE a.event_id = ? AND a.id = ?`)
    .bind(eventId, attendanceId)
    .first<AttendanceJoinedRow>();
}

export async function findAttendanceForParticipant(
  db: D1Database,
  eventId: string,
  participantId: string,
): Promise<AttendanceJoinedRow | null> {
  return db
    .prepare(`${ATTENDANCE_SELECT} WHERE a.event_id = ? AND a.participant_id = ?`)
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
  const clauses = ["a.event_id = ?"];
  const bindings: Array<string | number> = [eventId];

  if (filters.status !== "all") {
    clauses.push("a.status = ?");
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
    clauses.push("(a.checked_in_at < ? OR (a.checked_in_at = ? AND a.id < ?))");
    bindings.push(cursor.checkedInAt, cursor.checkedInAt, cursor.id);
  }

  bindings.push(limit + 1);

  const { results } = await db
    .prepare(
      `${ATTENDANCE_SELECT}
        WHERE ${clauses.join(" AND ")}
        ORDER BY a.checked_in_at DESC, a.id DESC
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
  const clauses = ["a.recorded_by = ?"];
  const bindings: Array<string | number> = [input.userId];

  if (input.eventId) {
    clauses.push("a.event_id = ?");
    bindings.push(input.eventId);
  }

  if (!input.isSuperadmin) {
    clauses.push(
      `EXISTS (SELECT 1 FROM event_memberships m
                WHERE m.event_id = a.event_id
                  AND m.user_id = ?
                  AND m.status = 'active')`,
    );
    bindings.push(input.userId);
  }

  if (input.cursor) {
    clauses.push("(a.checked_in_at < ? OR (a.checked_in_at = ? AND a.id < ?))");
    bindings.push(input.cursor.checkedInAt, input.cursor.checkedInAt, input.cursor.id);
  }

  bindings.push(input.limit + 1);

  const { results } = await db
    .prepare(
      `${ATTENDANCE_SELECT}
        WHERE ${clauses.join(" AND ")}
        ORDER BY a.checked_in_at DESC, a.id DESC
        LIMIT ?`,
    )
    .bind(...bindings)
    .all<AttendanceJoinedRow>();

  return results;
}

export interface AttendanceInsert {
  id: string;
  eventId: string;
  participantId: string;
  status: AttendanceStatus;
  checkedInAt: number;
  recordedBy: string | null;
  method: AttendanceMethod;
  note: string | null;
  now: number;
}

/**
 * The ONLY insert path for attendance. `DO NOTHING` turns a concurrent scan
 * into zero changed rows instead of a unique-constraint 500; the caller reads
 * `meta.changes` to distinguish `present` from `duplicate`.
 */
export function insertAttendanceStatement(
  db: D1Database,
  input: AttendanceInsert,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO attendance
         (id, event_id, participant_id, status, checked_in_at, recorded_by,
          method, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (event_id, participant_id) DO NOTHING`,
    )
    .bind(
      input.id,
      input.eventId,
      input.participantId,
      input.status,
      input.checkedInAt,
      input.recordedBy,
      input.method,
      input.note,
      input.now,
      input.now,
    );
}

export interface AttendanceUpdate {
  status: AttendanceStatus;
  method: AttendanceMethod;
  expectedUpdatedAt?: number;
}

/** Optimistic update; `changes = 0` means "gone or changed under us". */
export function updateAttendanceStatement(
  db: D1Database,
  eventId: string,
  attendanceId: string,
  update: AttendanceUpdate,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE attendance
          SET status = ?, method = ?, updated_at = ?
        WHERE event_id = ? AND id = ?
          AND (? IS NULL OR updated_at = ?)`,
    )
    .bind(
      update.status,
      update.method,
      now,
      eventId,
      attendanceId,
      update.expectedUpdatedAt ?? null,
      update.expectedUpdatedAt ?? null,
    );
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
              MAX(checked_in_at) AS last_attendance_at
         FROM attendance
        WHERE event_id = ?`,
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
        WHERE a.event_id = ?
        ORDER BY a.checked_in_at DESC, a.id DESC
        LIMIT ?`,
    )
    .bind(eventId, limit)
    .all<AttendanceJoinedRow>();

  return results;
}
