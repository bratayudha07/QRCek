import type { ParticipantStatus } from "@absensi/shared";

/** Data access for participants (DESAIN_API.md §5). */

export interface ParticipantRow {
  id: string;
  event_id: string;
  external_ref: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  category: string | null;
  note: string | null;
  status: ParticipantStatus;
  created_at: number;
  updated_at: number;
}

export interface ParticipantFilters {
  query?: string;
  status: "active" | "inactive" | "all";
}

export interface CursorFilter {
  createdAt: number;
  id: string;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function filterClauses(filters: ParticipantFilters): { sql: string[]; values: string[] } {
  const sql: string[] = [];
  const values: string[] = [];

  if (filters.status !== "all") {
    sql.push("status = ?");
    values.push(filters.status);
  }

  const query = filters.query?.trim();
  if (query) {
    const pattern = `%${escapeLike(query.toLowerCase())}%`;
    sql.push(
      `(LOWER(full_name) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(external_ref, '')) LIKE ? ESCAPE '\\'
        OR COALESCE(phone, '') LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(email, '')) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(category, '')) LIKE ? ESCAPE '\\')`,
    );
    values.push(pattern, pattern, pattern, pattern, pattern);
  }

  return { sql, values };
}

export async function listParticipants(
  db: D1Database,
  eventId: string,
  filters: ParticipantFilters,
  cursor: CursorFilter | null,
  limit: number,
): Promise<ParticipantRow[]> {
  const { sql, values } = filterClauses(filters);
  const clauses = ["event_id = ?", ...sql];
  const bindings: Array<string | number> = [eventId, ...values];

  if (cursor) {
    clauses.push("(created_at < ? OR (created_at = ? AND id < ?))");
    bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }

  bindings.push(limit + 1);

  const { results } = await db
    .prepare(
      `SELECT * FROM participants
        WHERE ${clauses.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
    )
    .bind(...bindings)
    .all<ParticipantRow>();

  return results;
}

/** Export is capped so one request cannot pull an unbounded result set. */
export const EXPORT_MAX_ROWS = 10_000;

export async function listParticipantsForExport(
  db: D1Database,
  eventId: string,
  filters: ParticipantFilters,
): Promise<ParticipantRow[]> {
  const { sql, values } = filterClauses(filters);
  const clauses = ["event_id = ?", ...sql];

  const { results } = await db
    .prepare(
      `SELECT * FROM participants
        WHERE ${clauses.join(" AND ")}
        ORDER BY full_name, id
        LIMIT ?`,
    )
    .bind(eventId, ...values, EXPORT_MAX_ROWS)
    .all<ParticipantRow>();

  return results;
}

export async function findParticipant(
  db: D1Database,
  eventId: string,
  participantId: string,
): Promise<ParticipantRow | null> {
  return db
    .prepare("SELECT * FROM participants WHERE event_id = ? AND id = ?")
    .bind(eventId, participantId)
    .first<ParticipantRow>();
}

export async function findParticipantByRef(
  db: D1Database,
  eventId: string,
  externalRef: string,
  excludeId?: string,
): Promise<{ id: string } | null> {
  return db
    .prepare(
      `SELECT id FROM participants
        WHERE event_id = ? AND external_ref = ? AND (? IS NULL OR id <> ?)`,
    )
    .bind(eventId, externalRef, excludeId ?? null, excludeId ?? null)
    .first<{ id: string }>();
}

/** Returns `external_ref → participant id` for the refs that already exist. */
export async function findExistingRefs(
  db: D1Database,
  eventId: string,
  refs: readonly string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(refs)];
  const chunkSize = 90; // D1: max 100 bound parameters per query.

  for (let offset = 0; offset < unique.length; offset += chunkSize) {
    const chunk = unique.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");

    const { results } = await db
      .prepare(
        `SELECT id, external_ref FROM participants
          WHERE event_id = ? AND external_ref IN (${placeholders})`,
      )
      .bind(eventId, ...chunk)
      .all<{ id: string; external_ref: string }>();

    for (const row of results) map.set(row.external_ref, row.id);
  }

  return map;
}

export interface ParticipantInput {
  externalRef: string | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  category: string | null;
  note: string | null;
}

export function insertParticipantStatement(
  db: D1Database,
  input: ParticipantInput & { id: string; eventId: string; createdAt: number },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO participants
         (id, event_id, external_ref, full_name, phone, email, category, note,
          status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
    .bind(
      input.id,
      input.eventId,
      input.externalRef,
      input.fullName,
      input.phone,
      input.email,
      input.category,
      input.note,
      input.createdAt,
      input.createdAt,
    );
}

/**
 * Idempotent import write: an existing `(event_id, external_ref)` is updated,
 * not duplicated. The partial index predicate must be repeated here — D1/SQLite
 * rejects `ON CONFLICT` without it (verified in Fase 0).
 */
export function upsertParticipantStatement(
  db: D1Database,
  input: ParticipantInput & { id: string; eventId: string; now: number },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO participants
         (id, event_id, external_ref, full_name, phone, email, category, note,
          status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT (event_id, external_ref) WHERE external_ref IS NOT NULL
       DO UPDATE SET
         full_name  = excluded.full_name,
         phone      = excluded.phone,
         email      = excluded.email,
         category   = excluded.category,
         note       = excluded.note,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.id,
      input.eventId,
      input.externalRef,
      input.fullName,
      input.phone,
      input.email,
      input.category,
      input.note,
      input.now,
      input.now,
    );
}

export interface ParticipantUpdate {
  externalRef?: string | null;
  fullName?: string;
  phone?: string | null;
  email?: string | null;
  category?: string | null;
  note?: string | null;
  status?: ParticipantStatus;
}

export async function updateParticipant(
  db: D1Database,
  eventId: string,
  participantId: string,
  update: ParticipantUpdate,
  now: number,
): Promise<number> {
  const sets: string[] = [];
  const values: Array<string | number | null> = [];

  const map = [
    ["external_ref", update.externalRef],
    ["full_name", update.fullName],
    ["phone", update.phone],
    ["email", update.email],
    ["category", update.category],
    ["note", update.note],
    ["status", update.status],
  ] as const;

  for (const [column, value] of map) {
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      values.push(value);
    }
  }

  if (sets.length === 0) return 0;

  sets.push("updated_at = ?");
  values.push(now, eventId, participantId);

  const result = await db
    .prepare(
      `UPDATE participants SET ${sets.join(", ")}
        WHERE event_id = ? AND id = ?`,
    )
    .bind(...values)
    .run();

  return result.meta.changes;
}

export async function deactivateParticipant(
  db: D1Database,
  eventId: string,
  participantId: string,
  now: number,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE participants
          SET status = 'inactive', updated_at = ?
        WHERE event_id = ? AND id = ?`,
    )
    .bind(now, eventId, participantId)
    .run();

  return result.meta.changes;
}
