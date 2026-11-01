/**
 * Append-only audit trail (DESAIN_DATABASE.md §3, ADR-006).
 *
 * Only INSERT is exposed. The database itself rejects UPDATE/DELETE through the
 * triggers in `0004_qr.sql`, so this module is the normal path, not the only
 * guarantee. Metadata belongs in `after_json` for non-mutating actions such as
 * `qr.labels_exported`; it must never contain tokens, hashes, peppers, or PII.
 */

export interface AuditEntry {
  id: string;
  eventId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  requestId?: string | null;
  ipHash?: string | null;
  createdAt: number;
}

export interface AuditJoinedRow {
  id: string;
  event_id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  created_at: number;
}

export async function listAuditEntries(
  db: D1Database,
  input: {
    eventId: string;
    action?: string;
    cursor: { createdAt: number; id: string } | null;
    limit: number;
  },
): Promise<AuditJoinedRow[]> {
  const clauses = ["a.event_id = ?"];
  const bindings: Array<string | number> = [input.eventId];
  if (input.action) {
    clauses.push("a.action = ?");
    bindings.push(input.action);
  }
  if (input.cursor) {
    clauses.push("(a.created_at < ? OR (a.created_at = ? AND a.id < ?))");
    bindings.push(input.cursor.createdAt, input.cursor.createdAt, input.cursor.id);
  }
  bindings.push(input.limit + 1);

  const { results } = await db
    .prepare(
      `SELECT a.id, a.event_id, a.actor_user_id, u.display_name AS actor_name,
              a.action, a.entity_type, a.entity_id, a.before_json, a.after_json,
              a.reason, a.created_at
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ?`,
    )
    .bind(...bindings)
    .all<AuditJoinedRow>();

  return results;
}

function jsonOrNull(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

export function insertAuditStatement(db: D1Database, entry: AuditEntry): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log
         (id, event_id, actor_user_id, action, entity_type, entity_id,
          before_json, after_json, reason, request_id, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      entry.id,
      entry.eventId,
      entry.actorUserId,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      jsonOrNull(entry.before),
      jsonOrNull(entry.after),
      entry.reason ?? null,
      entry.requestId ?? null,
      entry.ipHash ?? null,
      entry.createdAt,
    );
}

export async function recordAudit(db: D1Database, entry: AuditEntry): Promise<void> {
  await insertAuditStatement(db, entry).run();
}

/**
 * Audit insert that only fires when the attendance row from the same
 * `db.batch` exists. This keeps "present" and "audit written" atomic without
 * an interactive transaction: a duplicate scan changes 0 attendance rows, so
 * the audit statement inserts 0 rows too.
 */
export function insertAuditAfterAttendanceStatement(
  db: D1Database,
  entry: AuditEntry,
  attendanceId: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log
         (id, event_id, actor_user_id, action, entity_type, entity_id,
          before_json, after_json, reason, request_id, ip_hash, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM attendance WHERE id = ?)`,
    )
    .bind(
      entry.id,
      entry.eventId,
      entry.actorUserId,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      jsonOrNull(entry.before),
      jsonOrNull(entry.after),
      entry.reason ?? null,
      entry.requestId ?? null,
      entry.ipHash ?? null,
      entry.createdAt,
      attendanceId,
    );
}

/** Audit only when the optimistic attendance update actually landed. */
export function insertAuditAfterAttendanceUpdateStatement(
  db: D1Database,
  entry: AuditEntry,
  attendanceId: string,
  updatedAt: number,
  status: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log
         (id, event_id, actor_user_id, action, entity_type, entity_id,
          before_json, after_json, reason, request_id, ip_hash, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM attendance
           WHERE id = ? AND updated_at = ? AND status = ?
        )`,
    )
    .bind(
      entry.id,
      entry.eventId,
      entry.actorUserId,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      jsonOrNull(entry.before),
      jsonOrNull(entry.after),
      entry.reason ?? null,
      entry.requestId ?? null,
      entry.ipHash ?? null,
      entry.createdAt,
      attendanceId,
      updatedAt,
      status,
    );
}
