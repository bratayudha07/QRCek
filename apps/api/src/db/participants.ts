import type { ParticipantStatus } from "@absensi/shared";

/** Data access for participants (DESAIN_API.md §5). */

export interface ParticipantRow {
  id: string;
  event_id: string;
  external_ref: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  /** Display mirror maintained by the DB trigger from `category_id`. */
  category: string | null;
  category_id: string;
  attributes_json: string;
  note: string | null;
  status: ParticipantStatus;
  created_at: number;
  updated_at: number;
  /** QR credential columns from `0004_qr.sql`; NULL until the first print. */
  qr_token_hash: string | null;
  qr_token_ciphertext: string | null;
  qr_token_nonce: string | null;
  qr_key_version: number | null;
  qr_issued_at: number | null;
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

/**
 * Label printing pages through active participants with the same keyset as the
 * list endpoint: `(created_at DESC, id DESC)`. Active-only is a WHERE clause,
 * not a client-side filter, so an inactive participant can never receive a
 * fresh credential by being printed.
 */
export async function listParticipantsForLabels(
  db: D1Database,
  eventId: string,
  cursor: CursorFilter | null,
  limit: number,
): Promise<ParticipantRow[]> {
  const clauses = ["event_id = ?", "status = 'active'"];
  const bindings: Array<string | number> = [eventId];

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

/**
 * Explicit selection mode. Chunked defensively because D1 caps bound parameters
 * per query at 100; the API currently allows at most `QR_LABEL_BATCH_MAX` (38)
 * ids. Ordering is applied here so the caller gets the same stable order as the
 * cursor path.
 */
export async function listParticipantsByIdsForLabels(
  db: D1Database,
  eventId: string,
  participantIds: readonly string[],
): Promise<ParticipantRow[]> {
  const rows: ParticipantRow[] = [];
  const unique = [...new Set(participantIds)];
  const chunkSize = 90;

  for (let offset = 0; offset < unique.length; offset += chunkSize) {
    const chunk = unique.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => "?").join(", ");

    const { results } = await db
      .prepare(
        `SELECT * FROM participants
          WHERE event_id = ? AND status = 'active' AND id IN (${placeholders})`,
      )
      .bind(eventId, ...chunk)
      .all<ParticipantRow>();

    rows.push(...results);
  }

  rows.sort((a, b) => {
    if (a.created_at !== b.created_at) return b.created_at - a.created_at;
    if (a.id === b.id) return 0;
    return a.id < b.id ? 1 : -1;
  });

  return rows;
}

/**
 * Writes the five credential columns only when no credential exists yet.
 *
 * @deprecated Pre-`0010` write path. Credentials now live in `qr_identities`;
 * this helper is kept only for the legacy-baseline regression test. Do not call
 * it from a route.
 */
export function claimQrCredentialStatement(
  db: D1Database,
  eventId: string,
  participantId: string,
  credential: {
    tokenHash: string;
    ciphertext: string;
    nonce: string;
    keyVersion: number;
  },
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE participants
          SET qr_token_hash = ?, qr_token_ciphertext = ?, qr_token_nonce = ?,
              qr_key_version = ?, qr_issued_at = ?
        WHERE event_id = ? AND id = ? AND qr_token_hash IS NULL`,
    )
    .bind(
      credential.tokenHash,
      credential.ciphertext,
      credential.nonce,
      credential.keyVersion,
      now,
      eventId,
      participantId,
    );
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

export interface ParticipantAttributesRow {
  id: string;
  attributes_json: string;
}

/** All stored attribute maps for a Tema, used by custom-field type/option changes. */
export async function listParticipantAttributes(
  db: D1Database,
  eventId: string,
): Promise<ParticipantAttributesRow[]> {
  const { results } = await db
    .prepare("SELECT id, attributes_json FROM participants WHERE event_id = ?")
    .bind(eventId)
    .all<ParticipantAttributesRow>();
  return results;
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
  categoryId: string;
  note: string | null;
  attributesJson?: string;
}

export function insertParticipantStatement(
  db: D1Database,
  input: ParticipantInput & { id: string; eventId: string; createdAt: number },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO participants
         (id, event_id, external_ref, full_name, phone, email, category_id,
          attributes_json, note, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    )
    .bind(
      input.id,
      input.eventId,
      input.externalRef,
      input.fullName,
      input.phone,
      input.email,
      input.categoryId,
      input.attributesJson ?? "{}",
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
         (id, event_id, external_ref, full_name, phone, email, category_id,
          attributes_json, note, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT (event_id, external_ref) WHERE external_ref IS NOT NULL
       DO UPDATE SET
         full_name     = excluded.full_name,
         -- BR-077: an empty CSV cell never erases an existing value.
         phone         = COALESCE(excluded.phone, participants.phone),
         email         = COALESCE(excluded.email, participants.email),
         category_id   = excluded.category_id,
         note          = COALESCE(excluded.note, participants.note),
         updated_at    = excluded.updated_at`,
    )
    .bind(
      input.id,
      input.eventId,
      input.externalRef,
      input.fullName,
      input.phone,
      input.email,
      input.categoryId,
      input.attributesJson ?? "{}",
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
  categoryId?: string;
  attributesJson?: string;
  note?: string | null;
  status?: ParticipantStatus;
}

/**
 * Optimistic update used by PATCH and delete. The audit statement in the same
 * batch re-checks `updated_at`, so a lost race writes no audit row.
 */
export function updateParticipantStatement(
  db: D1Database,
  input: {
    eventId: string;
    participantId: string;
    update: ParticipantUpdate;
    now: number;
    expectedUpdatedAt: number;
  },
): D1PreparedStatement {
  const sets: string[] = [];
  const values: Array<string | number | null> = [];

  const map = [
    ["external_ref", input.update.externalRef],
    ["full_name", input.update.fullName],
    ["phone", input.update.phone],
    ["email", input.update.email],
    ["category_id", input.update.categoryId],
    ["attributes_json", input.update.attributesJson],
    ["note", input.update.note],
    ["status", input.update.status],
  ] as const;

  for (const [column, value] of map) {
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      values.push(value);
    }
  }

  if (sets.length === 0) {
    // A caller with nothing to change still gets a statement, so the batch
    // shape stays predictable; this touches no row.
    return db
      .prepare("UPDATE participants SET updated_at = updated_at WHERE 0")
      .bind();
  }

  sets.push("updated_at = ?");
  values.push(input.now, input.eventId, input.participantId, input.expectedUpdatedAt);

  return db
    .prepare(
      `UPDATE participants SET ${sets.join(", ")}
        WHERE event_id = ? AND id = ? AND updated_at = ?`,
    )
    .bind(...values);
}

export function deactivateParticipantStatement(
  db: D1Database,
  input: {
    eventId: string;
    participantId: string;
    now: number;
    expectedUpdatedAt: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE participants
          SET status = 'inactive', updated_at = ?
        WHERE event_id = ? AND id = ? AND updated_at = ?`,
    )
    .bind(input.now, input.eventId, input.participantId, input.expectedUpdatedAt);
}
