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
