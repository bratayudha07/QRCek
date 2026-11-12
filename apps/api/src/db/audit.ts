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

/** Audit only when the transaction insert from the same batch landed. */
export function insertAuditAfterTransactionStatement(
  db: D1Database,
  entry: AuditEntry,
  transactionId: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log
         (id, event_id, actor_user_id, action, entity_type, entity_id,
          before_json, after_json, reason, request_id, ip_hash, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM transactions WHERE id = ?)`,
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
      transactionId,
    );
}

/** Audit only when the guarded Reversal update actually landed. */
export function insertAuditAfterReversalStatement(
  db: D1Database,
  entry: AuditEntry,
  transactionId: string,
  reversedAt: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log
         (id, event_id, actor_user_id, action, entity_type, entity_id,
          before_json, after_json, reason, request_id, ip_hash, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM transactions WHERE id = ? AND reversed_at = ?
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
      transactionId,
      reversedAt,
    );
}

/** Audit only when the Adjustment replacement row exists in the same batch. */
export function insertAuditAfterAdjustmentStatement(
  db: D1Database,
  entry: AuditEntry,
  replacementId: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log
         (id, event_id, actor_user_id, action, entity_type, entity_id,
          before_json, after_json, reason, request_id, ip_hash, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM transactions
           WHERE id = ? AND adjusts_transaction_id IS NOT NULL
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
      replacementId,
    );
}

/** Tables that carry an `updated_at` version column usable as an audit guard. */
type VersionedAuditTable =
  | "activities"
  | "activity_sessions"
  | "categories"
  | "custom_fields"
  | "entitlement_rules"
  | "participants";

/**
 * Audit insert that only fires when the versioned row from the same
 * `db.batch` reached the expected `updated_at`. A lost optimistic update writes
 * no audit row, which is what makes "audit written" mean "mutation landed".
 */
function insertAuditAfterVersionedUpdateStatement(
  db: D1Database,
  entry: AuditEntry,
  table: VersionedAuditTable,
  entityId: string,
  updatedAt: number,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log
         (id, event_id, actor_user_id, action, entity_type, entity_id,
          before_json, after_json, reason, request_id, ip_hash, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM ${table} WHERE id = ? AND updated_at = ?)`,
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
      entityId,
      updatedAt,
    );
}

export function insertAuditAfterActivityUpdateStatement(
  db: D1Database,
  entry: AuditEntry,
  activityId: string,
  updatedAt: number,
): D1PreparedStatement {
  return insertAuditAfterVersionedUpdateStatement(db, entry, "activities", activityId, updatedAt);
}

export function insertAuditAfterSessionUpdateStatement(
  db: D1Database,
  entry: AuditEntry,
  sessionId: string,
  updatedAt: number,
): D1PreparedStatement {
  return insertAuditAfterVersionedUpdateStatement(
    db,
    entry,
    "activity_sessions",
    sessionId,
    updatedAt,
  );
}

export function insertAuditAfterCategoryUpdateStatement(
  db: D1Database,
  entry: AuditEntry,
  categoryId: string,
  updatedAt: number,
): D1PreparedStatement {
  return insertAuditAfterVersionedUpdateStatement(db, entry, "categories", categoryId, updatedAt);
}

export function insertAuditAfterCustomFieldUpdateStatement(
  db: D1Database,
  entry: AuditEntry,
  fieldId: string,
  updatedAt: number,
): D1PreparedStatement {
  return insertAuditAfterVersionedUpdateStatement(db, entry, "custom_fields", fieldId, updatedAt);
}

export function insertAuditAfterParticipantUpdateStatement(
  db: D1Database,
  entry: AuditEntry,
  participantId: string,
  updatedAt: number,
): D1PreparedStatement {
  return insertAuditAfterVersionedUpdateStatement(
    db,
    entry,
    "participants",
    participantId,
    updatedAt,
  );
}

/** Entitlement rules carry `updated_at`; a lost optimistic write writes no audit. */
export function insertAuditAfterEntitlementRuleUpdateStatement(
  db: D1Database,
  entry: AuditEntry,
  ruleId: string,
  updatedAt: number,
): D1PreparedStatement {
  return insertAuditAfterVersionedUpdateStatement(
    db,
    entry,
    "entitlement_rules",
    ruleId,
    updatedAt,
  );
}

/**
 * QR identity rotation has no `updated_at` and two concurrent rotations both
 * compute the same next counter, so the counter cannot identify the winner.
 * The new token hash can: only the statement that actually landed stores it.
 * A lost race leaves the hash absent, so the audit insert writes 0 rows and
 * "audit written" keeps meaning "rotation landed". The hash is used as a bind
 * value only — it never becomes part of the audit row (FR-200).
 */
export function insertAuditAfterQrIdentityRotationStatement(
  db: D1Database,
  entry: AuditEntry,
  identityId: string,
  tokenHash: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log
         (id, event_id, actor_user_id, action, entity_type, entity_id,
          before_json, after_json, reason, request_id, ip_hash, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM qr_identities WHERE id = ? AND token_hash = ?
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
      identityId,
      tokenHash,
    );
}

/**
 * Delete audit fires only when the row is gone after the delete statement in the
 * same batch. A stale `updated_at` leaves the row in place, so no audit row.
 */
export function insertAuditAfterEntitlementRuleDeleteStatement(
  db: D1Database,
  entry: AuditEntry,
  ruleId: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log
         (id, event_id, actor_user_id, action, entity_type, entity_id,
          before_json, after_json, reason, request_id, ip_hash, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM entitlement_rules WHERE id = ?)`,
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
      ruleId,
    );
}

/**
 * `events` has no `updated_at` column, so the guard uses the status the caller
 * expects to be current. A concurrent status change makes it fail; a plain
 * patch passes because it leaves the status unchanged.
 */
export function insertAuditAfterThemeStatusStatement(
  db: D1Database,
  entry: AuditEntry,
  eventId: string,
  status: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log
         (id, event_id, actor_user_id, action, entity_type, entity_id,
          before_json, after_json, reason, request_id, ip_hash, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM events WHERE id = ? AND status = ?)`,
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
      eventId,
      status,
    );
}

/**
 * Delete audit only fires when the event is actually gone after the delete
 * statement earlier in the same batch. `deleteEmptyDraft` still owns the
 * "draft + empty" condition, so the two cannot drift.
 */
export function insertAuditAfterThemeDeleteStatement(
  db: D1Database,
  entry: AuditEntry,
  eventId: string,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log
         (id, event_id, actor_user_id, action, entity_type, entity_id,
          before_json, after_json, reason, request_id, ip_hash, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM events WHERE id = ?)`,
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
      eventId,
    );
}
