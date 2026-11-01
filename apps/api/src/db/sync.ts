/** D1 access for per-event Google Sheets configuration and row mapping. */

export interface SyncStateRow {
  event_id: string;
  spreadsheet_id: string;
  sheet_tab: string;
  sync_enabled: number;
  schema_version: number;
  header_hash: string | null;
  last_full_sync_at: number | null;
  last_error: string | null;
  updated_at: number;
}

export async function findSyncState(
  db: D1Database,
  eventId: string,
): Promise<SyncStateRow | null> {
  return db
    .prepare("SELECT * FROM sync_state WHERE event_id = ?")
    .bind(eventId)
    .first<SyncStateRow>();
}

export function upsertSyncStateStatement(
  db: D1Database,
  input: {
    eventId: string;
    spreadsheetId: string;
    sheetTab: string;
    syncEnabled: boolean;
    now: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO sync_state
         (event_id, spreadsheet_id, sheet_tab, sync_enabled, schema_version,
          header_hash, last_full_sync_at, last_error, updated_at)
       VALUES (?, ?, ?, ?, 1, NULL, NULL, NULL, ?)
       ON CONFLICT (event_id) DO UPDATE SET
         spreadsheet_id = excluded.spreadsheet_id,
         sheet_tab = excluded.sheet_tab,
         sync_enabled = excluded.sync_enabled,
         last_error = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.eventId,
      input.spreadsheetId,
      input.sheetTab,
      input.syncEnabled ? 1 : 0,
      input.now,
    );
}

export function setSyncErrorStatement(
  db: D1Database,
  input: { eventId: string; message: string | null; now: number },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE sync_state
          SET last_error = ?, updated_at = ?
        WHERE event_id = ?`,
    )
    .bind(input.message?.slice(0, 500) ?? null, input.now, input.eventId);
}

export function setFullSyncStatement(
  db: D1Database,
  input: { eventId: string; now: number },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE sync_state
          SET last_full_sync_at = ?, last_error = NULL, updated_at = ?
        WHERE event_id = ?`,
    )
    .bind(input.now, input.now, input.eventId);
}

export function setHeaderHashStatement(
  db: D1Database,
  input: { eventId: string; headerHash: string; now: number },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE sync_state SET header_hash = ?, updated_at = ? WHERE event_id = ?`,
    )
    .bind(input.headerHash, input.now, input.eventId);
}

/**
 * Reserves one deterministic spreadsheet row per participant (ADR-004).
 *
 * `MAX(row_index) + 1` and the insert are one statement, so two workers cannot
 * both read the same maximum. `ON CONFLICT` reuses an existing mapping, which is
 * what makes a retry overwrite the same row instead of appending a duplicate.
 * `row_index` starts at 3: row 1 is metadata, row 2 is the header.
 */
export async function reserveSheetRow(
  db: D1Database,
  eventId: string,
  participantId: string,
  now: number,
): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const row = await db
        .prepare(
          `INSERT INTO sheet_rows (event_id, participant_id, row_index, updated_at)
           VALUES (
             ?, ?,
             (SELECT COALESCE(MAX(row_index), 2) + 1 FROM sheet_rows WHERE event_id = ?),
             ?
           )
           ON CONFLICT (event_id, participant_id)
           DO UPDATE SET updated_at = excluded.updated_at
           RETURNING row_index`,
        )
        .bind(eventId, participantId, eventId, now)
        .first<{ row_index: number }>();

      if (row) return row.row_index;
    } catch (error) {
      // A concurrent insert may have won the same `row_index`. Reuse the row
      // that landed; anything else is a real error.
      const existing = await findSheetRow(db, eventId, participantId);
      if (existing !== null) return existing;
      if (attempt === 2) throw error;
    }
  }

  const existing = await findSheetRow(db, eventId, participantId);
  if (existing !== null) return existing;

  throw new Error("sheet_row_reservation_failed");
}

export interface ProjectionRow {
  participant_id: string;
  external_ref: string | null;
  full_name: string;
  category: string | null;
  attendance_status: string | null;
  checked_in_at: number | null;
  method: string | null;
  attendance_updated_at: number | null;
}

/** Participant + current attendance, the authoritative source of a sheet row. */
export async function findProjectionData(
  db: D1Database,
  eventId: string,
  participantId: string,
): Promise<ProjectionRow | null> {
  return db
    .prepare(
      `SELECT p.id AS participant_id, p.external_ref, p.full_name, p.category,
              a.status AS attendance_status, a.checked_in_at,
              a.method, a.updated_at AS attendance_updated_at
         FROM participants p
         LEFT JOIN attendance a
           ON a.event_id = p.event_id AND a.participant_id = p.id
        WHERE p.event_id = ? AND p.id = ?`,
    )
    .bind(eventId, participantId)
    .first<ProjectionRow>();
}

export async function findSheetRow(
  db: D1Database,
  eventId: string,
  participantId: string,
): Promise<number | null> {
  const row = await db
    .prepare(
      "SELECT row_index FROM sheet_rows WHERE event_id = ? AND participant_id = ?",
    )
    .bind(eventId, participantId)
    .first<{ row_index: number }>();

  return row?.row_index ?? null;
}
