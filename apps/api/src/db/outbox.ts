import type { OutboxKind, OutboxStatus } from "@absensi/shared";

/**
 * Persistent outbox (DESAIN_DATABASE.md §6, ADR-005).
 *
 * Attendance, its outbox row, and its audit row are written in one `db.batch`,
 * so "attendance saved but never queued" cannot happen. The partial unique
 * index coalesces repeated writes for the same participant; retries therefore
 * update one row instead of appending.
 */

export interface OutboxRow {
  id: string;
  event_id: string;
  participant_id: string;
  kind: OutboxKind;
  status: OutboxStatus;
  attempts: number;
  next_attempt_at: number;
  claimed_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface OutboxJoinedRow extends OutboxRow {
  participant_name: string;
}

export interface OutboxCounts {
  pending: number;
  inflight: number;
  done: number;
  failed: number;
  dead: number;
}

/** Coalescing clause reused by every enqueue statement. */
const COALESCE = `ON CONFLICT (event_id, participant_id)
  WHERE status IN ('pending','inflight','failed')
  DO UPDATE SET
    status = 'pending',
    attempts = 0,
    next_attempt_at = excluded.next_attempt_at,
    claimed_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at`;

export function enqueueAttendanceStatement(
  db: D1Database,
  input: {
    id: string;
    eventId: string;
    participantId: string;
    attendanceId: string;
    now: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO outbox
         (id, event_id, participant_id, kind, status, attempts,
          next_attempt_at, created_at, updated_at)
       SELECT ?, ?, ?, 'attendance', 'pending', 0, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM attendance WHERE id = ?)
       ${COALESCE}`,
    )
    .bind(
      input.id,
      input.eventId,
      input.participantId,
      input.now,
      input.now,
      input.now,
      input.attendanceId,
    );
}

/**
 * Correction enqueue. The `updated_at` guard means a failed optimistic update
 * (0 changed rows) cannot enqueue a sync that has nothing to send.
 */
export function enqueueCorrectionStatement(
  db: D1Database,
  input: {
    id: string;
    eventId: string;
    participantId: string;
    attendanceId: string;
    updatedAt: number;
    now: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO outbox
         (id, event_id, participant_id, kind, status, attempts,
          next_attempt_at, created_at, updated_at)
       SELECT ?, ?, ?, 'attendance', 'pending', 0, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM attendance
           WHERE id = ? AND event_id = ? AND updated_at = ?
        )
       ${COALESCE}`,
    )
    .bind(
      input.id,
      input.eventId,
      input.participantId,
      input.now,
      input.now,
      input.now,
      input.attendanceId,
      input.eventId,
      input.updatedAt,
    );
}

export async function findOutboxById(
  db: D1Database,
  eventId: string,
  outboxId: string,
): Promise<OutboxJoinedRow | null> {
  return db
    .prepare(
      `SELECT o.*, p.full_name AS participant_name
         FROM outbox o
         JOIN participants p ON p.id = o.participant_id
        WHERE o.event_id = ? AND o.id = ?`,
    )
    .bind(eventId, outboxId)
    .first<OutboxJoinedRow>();
}

export async function listOutbox(
  db: D1Database,
  eventId: string,
  status: OutboxStatus | "all",
  limit: number,
): Promise<OutboxJoinedRow[]> {
  const clauses = ["o.event_id = ?"];
  const bindings: Array<string | number> = [eventId];

  if (status !== "all") {
    clauses.push("o.status = ?");
    bindings.push(status);
  }

  bindings.push(limit);

  const { results } = await db
    .prepare(
      `SELECT o.*, p.full_name AS participant_name
         FROM outbox o
         JOIN participants p ON p.id = o.participant_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY o.updated_at DESC, o.id DESC
        LIMIT ?`,
    )
    .bind(...bindings)
    .all<OutboxJoinedRow>();

  return results;
}

export async function countOutbox(
  db: D1Database,
  eventId: string,
): Promise<OutboxCounts> {
  const { results } = await db
    .prepare(
      `SELECT status, COUNT(*) AS n
         FROM outbox
        WHERE event_id = ?
        GROUP BY status`,
    )
    .bind(eventId)
    .all<{ status: OutboxStatus; n: number }>();

  const counts: OutboxCounts = { pending: 0, inflight: 0, done: 0, failed: 0, dead: 0 };
  for (const row of results) counts[row.status] = row.n;
  return counts;
}

/**
 * Crash recovery: a cron invocation that died mid-flight leaves rows in
 * `inflight`. Ten minutes later they become eligible again.
 */
export function reclaimStaleStatement(
  db: D1Database,
  input: { now: number; staleBefore: number },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE outbox
          SET status = 'failed', claimed_at = NULL, next_attempt_at = ?, updated_at = ?
        WHERE status = 'inflight' AND claimed_at IS NOT NULL AND claimed_at <= ?`,
    )
    .bind(input.now, input.now, input.staleBefore);
}

/**
 * Candidates are restricted to events with an enabled destination. An event
 * without a sheet keeps its attendance safely in D1 and does not burn retries.
 */
export async function listDueOutbox(
  db: D1Database,
  input: { now: number; limit: number; eventId?: string },
): Promise<OutboxJoinedRow[]> {
  const { results } = await db
    .prepare(
      `SELECT o.*, p.full_name AS participant_name
         FROM outbox o
         JOIN participants p ON p.id = o.participant_id
        WHERE o.status IN ('pending','failed')
          AND o.next_attempt_at <= ?
          AND (? IS NULL OR o.event_id = ?)
          AND EXISTS (
            SELECT 1 FROM sync_state s
             WHERE s.event_id = o.event_id AND s.sync_enabled = 1
          )
        ORDER BY o.next_attempt_at, o.id
        LIMIT ?`,
    )
    .bind(input.now, input.eventId ?? null, input.eventId ?? null, input.limit)
    .all<OutboxJoinedRow>();

  return results;
}

/** Best-effort claim; a row another invocation already took yields 0 changes. */
export function claimOutboxStatement(
  db: D1Database,
  input: { id: string; now: number },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE outbox
          SET status = 'inflight', claimed_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('pending','failed') AND next_attempt_at <= ?`,
    )
    .bind(input.now, input.now, input.id, input.now);
}

export function markOutboxDoneStatement(
  db: D1Database,
  input: { id: string; now: number },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE outbox
          SET status = 'done', claimed_at = NULL, last_error = NULL,
              next_attempt_at = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(input.now, input.now, input.id);
}

export function markOutboxFailureStatement(
  db: D1Database,
  input: {
    id: string;
    attempts: number;
    nextAttemptAt: number;
    error: string;
    dead: boolean;
    now: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE outbox
          SET status = ?, attempts = ?, claimed_at = NULL, last_error = ?,
              next_attempt_at = ?, updated_at = ?
        WHERE id = ?`,
    )
    .bind(
      input.dead ? "dead" : "failed",
      input.attempts,
      input.error.slice(0, 500),
      input.nextAttemptAt,
      input.now,
      input.id,
    );
}

export function retryOutboxStatement(
  db: D1Database,
  input: { eventId: string; outboxId: string; now: number },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE outbox
          SET status = 'pending', attempts = 0, claimed_at = NULL,
              last_error = NULL, next_attempt_at = ?, updated_at = ?
        WHERE event_id = ? AND id = ? AND status IN ('dead','failed')`,
    )
    .bind(input.now, input.now, input.eventId, input.outboxId);
}

/** Full projection: one pending item per participant in the event. */
export function enqueueEventParticipantsStatement(
  db: D1Database,
  input: { eventId: string; now: number },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO outbox
         (id, event_id, participant_id, kind, status, attempts,
          next_attempt_at, created_at, updated_at)
       SELECT lower(hex(randomblob(16))), p.event_id, p.id, 'participant',
              'pending', 0, ?, ?, ?
         FROM participants p
        WHERE p.event_id = ?
       ${COALESCE}`,
    )
    .bind(input.now, input.now, input.now, input.eventId);
}

/** `done` rows have no future use; pruning keeps the table small (§6). */
export function pruneDoneOutboxStatement(
  db: D1Database,
  input: { now: number; olderThan: number },
): D1PreparedStatement {
  return db
    .prepare("DELETE FROM outbox WHERE status = 'done' AND updated_at < ?")
    .bind(input.olderThan);
}
