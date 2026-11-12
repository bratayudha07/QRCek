import type { AttendanceStatus, TransactionSource, TransactionType } from "@absensi/shared";

/**
 * Data access for `transactions` and `transaction_corrections` (ADR-0018/0019/0020).
 *
 * Duplicate prevention is the partial unique index, never a SELECT before
 * INSERT. New rows use `ON CONFLICT DO NOTHING`; zero changed rows means the
 * effective transaction already exists (or lost the race) and becomes
 * `DUPLICATE`, not a 500.
 */

export interface TransactionRow {
  id: string;
  theme_id: string;
  activity_id: string;
  session_id: string | null;
  participant_id: string;
  type: TransactionType;
  source: TransactionSource;
  status: AttendanceStatus | null;
  occurred_at: number;
  device_ts: number | null;
  recorded_by: string | null;
  note: string | null;
  slot_no: number | null;
  adjusts_transaction_id: string | null;
  reversed_at: number | null;
  reversed_by: string | null;
  superseded_at: number | null;
  superseded_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface TransactionJoinedRow extends TransactionRow {
  event_name: string;
  participant_name: string;
  participant_external_ref: string | null;
  category: string | null;
  recorded_by_name: string | null;
  activity_name: string;
}

export interface TransactionFilters {
  activityId?: string;
  sessionId?: string;
  type?: TransactionType;
  status: AttendanceStatus | "all";
  effective: "true" | "false" | "all";
}

export interface TransactionCursor {
  occurredAt: number;
  id: string;
}

export const TRANSACTION_SELECT = `
  SELECT t.*,
         e.name               AS event_name,
         p.full_name          AS participant_name,
         p.external_ref       AS participant_external_ref,
         p.category           AS category,
         u.display_name       AS recorded_by_name,
         a.name               AS activity_name
    FROM transactions t
    JOIN events e ON e.id = t.theme_id
    JOIN activities a ON a.id = t.activity_id
    JOIN participants p
      ON p.id = t.participant_id AND p.event_id = t.theme_id
    LEFT JOIN users u ON u.id = t.recorded_by`;

const EFFECTIVE = "t.reversed_at IS NULL AND t.superseded_at IS NULL";

/** Scoped by `theme_id`: a transaction from another Tema is a 404. */
export async function findTransactionById(
  db: D1Database,
  themeId: string,
  transactionId: string,
): Promise<TransactionJoinedRow | null> {
  return db
    .prepare(`${TRANSACTION_SELECT} WHERE t.theme_id = ? AND t.id = ?`)
    .bind(themeId, transactionId)
    .first<TransactionJoinedRow>();
}

export async function findEffectiveTransactionForScope(
  db: D1Database,
  input: {
    themeId: string;
    participantId: string;
    activityId: string;
    sessionId: string | null;
    type: TransactionType;
  },
): Promise<TransactionJoinedRow | null> {
  return db
    .prepare(
      `${TRANSACTION_SELECT}
        WHERE t.theme_id = ? AND t.participant_id = ? AND t.activity_id = ?
          AND t.session_id IS ? AND t.type = ? AND ${EFFECTIVE}
        ORDER BY t.occurred_at DESC, t.id DESC
        LIMIT 1`,
    )
    .bind(
      input.themeId,
      input.participantId,
      input.activityId,
      input.sessionId,
      input.type,
    )
    .first<TransactionJoinedRow>();
}

/** Latest effective Attendance transaction for a participant (compat adapter). */
export async function findEffectiveAttendanceForParticipant(
  db: D1Database,
  themeId: string,
  participantId: string,
): Promise<TransactionJoinedRow | null> {
  return db
    .prepare(
      `${TRANSACTION_SELECT}
        WHERE t.theme_id = ? AND t.participant_id = ? AND t.type = 'attendance'
          AND ${EFFECTIVE}
        ORDER BY t.occurred_at DESC, t.id DESC
        LIMIT 1`,
    )
    .bind(themeId, participantId)
    .first<TransactionJoinedRow>();
}

export async function listTransactions(
  db: D1Database,
  themeId: string,
  filters: TransactionFilters,
  cursor: TransactionCursor | null,
  limit: number,
): Promise<TransactionJoinedRow[]> {
  const clauses = ["t.theme_id = ?"];
  const bindings: Array<string | number> = [themeId];

  if (filters.activityId) {
    clauses.push("t.activity_id = ?");
    bindings.push(filters.activityId);
  }
  if (filters.sessionId) {
    clauses.push("t.session_id = ?");
    bindings.push(filters.sessionId);
  }
  if (filters.type) {
    clauses.push("t.type = ?");
    bindings.push(filters.type);
  }
  if (filters.status !== "all") {
    clauses.push("t.status = ?");
    bindings.push(filters.status);
  }

  if (filters.effective === "true") {
    clauses.push(EFFECTIVE);
  } else if (filters.effective === "false") {
    clauses.push("(t.reversed_at IS NOT NULL OR t.superseded_at IS NOT NULL)");
  }

  if (cursor) {
    clauses.push("(t.occurred_at < ? OR (t.occurred_at = ? AND t.id < ?))");
    bindings.push(cursor.occurredAt, cursor.occurredAt, cursor.id);
  }

  bindings.push(limit + 1);

  const { results } = await db
    .prepare(
      `${TRANSACTION_SELECT}
        WHERE ${clauses.join(" AND ")}
        ORDER BY t.occurred_at DESC, t.id DESC
        LIMIT ?`,
    )
    .bind(...bindings)
    .all<TransactionJoinedRow>();

  return results;
}

export interface TransactionInsert {
  id: string;
  themeId: string;
  activityId: string;
  sessionId: string | null;
  participantId: string;
  type: TransactionType;
  source: TransactionSource;
  status: AttendanceStatus | null;
  occurredAt: number;
  deviceTs: number | null;
  recordedBy: string | null;
  note: string | null;
  slotNo: number | null;
  adjustsTransactionId: string | null;
  now: number;
}

/**
 * The only insert path for transactions. `DO NOTHING` maps a uniqueness
 * conflict to `meta.changes = 0`; CHECK/FK/trigger failures still throw.
 */
export function insertTransactionStatement(
  db: D1Database,
  input: TransactionInsert,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO transactions
         (id, theme_id, activity_id, session_id, participant_id, type, source,
          status, occurred_at, device_ts, recorded_by, note, slot_no,
          adjusts_transaction_id, reversed_at, reversed_by, superseded_at,
          superseded_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .bind(
      input.id,
      input.themeId,
      input.activityId,
      input.sessionId,
      input.participantId,
      input.type,
      input.source,
      input.status,
      input.occurredAt,
      input.deviceTs,
      input.recordedBy,
      input.note,
      input.slotNo,
      input.adjustsTransactionId,
      input.now,
      input.now,
    );
}

/** Reversal marker. `changes = 0` means the row was already corrected. */
export function reverseTransactionStatement(
  db: D1Database,
  input: {
    themeId: string;
    transactionId: string;
    actorUserId: string;
    now: number;
    expectedUpdatedAt?: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE transactions
          SET reversed_at = ?, reversed_by = ?, updated_at = ?
        WHERE id = ? AND theme_id = ?
          AND reversed_at IS NULL AND superseded_at IS NULL
          AND (? IS NULL OR updated_at = ?)`,
    )
    .bind(
      input.now,
      input.actorUserId,
      input.now,
      input.transactionId,
      input.themeId,
      input.expectedUpdatedAt ?? null,
      input.expectedUpdatedAt ?? null,
    );
}

/** Marks the pre-Adjustment version; must run before the replacement insert. */
export function supersedeTransactionStatement(
  db: D1Database,
  input: {
    themeId: string;
    transactionId: string;
    actorUserId: string;
    now: number;
    expectedUpdatedAt?: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE transactions
          SET superseded_at = ?, superseded_by = ?, updated_at = ?
        WHERE id = ? AND theme_id = ?
          AND reversed_at IS NULL AND superseded_at IS NULL
          AND (? IS NULL OR updated_at = ?)`,
    )
    .bind(
      input.now,
      input.actorUserId,
      input.now,
      input.transactionId,
      input.themeId,
      input.expectedUpdatedAt ?? null,
      input.expectedUpdatedAt ?? null,
    );
}

/** Correction row only if the Reversal update from the same batch landed. */
export function insertReversalCorrectionStatement(
  db: D1Database,
  input: {
    id: string;
    transactionId: string;
    reason: string;
    actorUserId: string;
    beforeJson: string | null;
    now: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO transaction_corrections
         (id, transaction_id, operation, reason, actor_user_id, before_json,
          after_json, created_at)
       SELECT ?, ?, 'reversal', ?, ?, ?, NULL, ?
        WHERE EXISTS (
          SELECT 1 FROM transactions
           WHERE id = ? AND reversed_at = ? AND reversed_by = ?
        )`,
    )
    .bind(
      input.id,
      input.transactionId,
      input.reason,
      input.actorUserId,
      input.beforeJson,
      input.now,
      input.transactionId,
      input.now,
      input.actorUserId,
    );
}

/** Adjustment row only if the supersede and replacement both landed. */
export function insertAdjustmentCorrectionStatement(
  db: D1Database,
  input: {
    id: string;
    transactionId: string;
    replacementId: string;
    reason: string;
    actorUserId: string;
    beforeJson: string | null;
    afterJson: string | null;
    now: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO transaction_corrections
         (id, transaction_id, operation, reason, actor_user_id, before_json,
          after_json, created_at)
       SELECT ?, ?, 'adjustment', ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM transactions
           WHERE id = ? AND superseded_at = ? AND superseded_by = ?
        )
          AND EXISTS (
            SELECT 1 FROM transactions
             WHERE id = ? AND adjusts_transaction_id = ?
          )`,
    )
    .bind(
      input.id,
      input.transactionId,
      input.reason,
      input.actorUserId,
      input.beforeJson,
      input.afterJson,
      input.now,
      input.transactionId,
      input.now,
      input.actorUserId,
      input.replacementId,
      input.transactionId,
    );
}
