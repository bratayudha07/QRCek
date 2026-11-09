import type { ParticipantRow } from "./participants";
import type { QrCredential } from "../domain/qr-token";

/**
 * Data access for `qr_identities` (DESAIN_DATABASE.md §3, ADR-0017).
 *
 * One active credential per `(theme_id, participant_id)`. Rotation updates the
 * same row so ids stay stable for future transaction references (FR-060). Every
 * query is scoped by `theme_id`; the database trigger is the last line of
 * defence against a cross-Tema row.
 */

export interface QrIdentityRow {
  id: string;
  theme_id: string;
  participant_id: string;
  token_hash: string;
  ciphertext: string;
  nonce: string;
  key_version: number;
  issued_at: number;
  rotated_at: number | null;
  rotation_count: number;
}

/** Scan lookup: identity coordinates plus the participant row they belong to. */
export interface QrIdentityParticipantRow extends ParticipantRow {
  identity_id: string;
  identity_theme_id: string;
}

export interface InsertQrIdentityInput {
  id: string;
  themeId: string;
  participantId: string;
  credential: QrCredential;
  issuedAt: number;
  rotatedAt?: number | null;
  rotationCount?: number;
}

export interface RotateQrIdentityInput {
  themeId: string;
  participantId: string;
  credential: QrCredential;
  rotatedAt: number;
  /** Optimistic guard: a concurrent rotation makes this update land 0 rows. */
  expectedRotationCount: number;
}

/**
 * Bounded parameters per query (D1 limit is 100). Label pages are at most 40,
 * so this only matters if the helper is reused for larger batches.
 */
const IN_CHUNK_SIZE = 90;

/**
 * One indexed lookup on `uq_qr_identity_hash`, then a primary-key join to the
 * participant. Returns only what a scan needs plus the full participant row for
 * the existing response payload.
 */
export async function findIdentityParticipantByHash(
  db: D1Database,
  tokenHash: string,
): Promise<QrIdentityParticipantRow | null> {
  return db
    .prepare(
      `SELECT q.id AS identity_id, q.theme_id AS identity_theme_id, p.*
         FROM qr_identities q
         JOIN participants p ON p.id = q.participant_id
        WHERE q.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<QrIdentityParticipantRow>();
}

export async function findIdentityForParticipant(
  db: D1Database,
  themeId: string,
  participantId: string,
): Promise<QrIdentityRow | null> {
  return db
    .prepare("SELECT * FROM qr_identities WHERE theme_id = ? AND participant_id = ?")
    .bind(themeId, participantId)
    .first<QrIdentityRow>();
}

/** Batch read for one label page; keeps the endpoint at a single identity query. */
export async function listIdentitiesForParticipants(
  db: D1Database,
  themeId: string,
  participantIds: readonly string[],
): Promise<QrIdentityRow[]> {
  const unique = [...new Set(participantIds)];
  const rows: QrIdentityRow[] = [];

  for (let offset = 0; offset < unique.length; offset += IN_CHUNK_SIZE) {
    const chunk = unique.slice(offset, offset + IN_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");

    const { results } = await db
      .prepare(
        `SELECT * FROM qr_identities
          WHERE theme_id = ? AND participant_id IN (${placeholders})`,
      )
      .bind(themeId, ...chunk)
      .all<QrIdentityRow>();

    rows.push(...results);
  }

  return rows;
}

/**
 * Lazy issuance and legacy backfill share this statement.
 *
 * `ON CONFLICT (theme_id, participant_id) DO NOTHING` is the concurrency
 * contract: two printers racing on one participant produce one winner and one
 * `changes = 0`, and the loser re-reads instead of rotating. A conflict on
 * `token_hash` is not expected (256-bit random token) and stays a hard error.
 */
export function insertQrIdentityStatement(
  db: D1Database,
  input: InsertQrIdentityInput,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO qr_identities
         (id, theme_id, participant_id, token_hash, ciphertext, nonce,
          key_version, issued_at, rotated_at, rotation_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (theme_id, participant_id) DO NOTHING`,
    )
    .bind(
      input.id,
      input.themeId,
      input.participantId,
      input.credential.tokenHash,
      input.credential.ciphertext,
      input.credential.nonce,
      input.credential.keyVersion,
      input.issuedAt,
      input.rotatedAt ?? null,
      input.rotationCount ?? 0,
    );
}

/**
 * In-place rotation. The expected counter makes a lost race visible: a
 * concurrent rotation leaves `changes = 0`, and the route reports a conflict
 * instead of writing an audit row for a mutation that did not land.
 */
export function rotateQrIdentityStatement(
  db: D1Database,
  input: RotateQrIdentityInput,
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE qr_identities
          SET token_hash = ?, ciphertext = ?, nonce = ?, key_version = ?,
              rotated_at = ?, rotation_count = rotation_count + 1
        WHERE theme_id = ? AND participant_id = ? AND rotation_count = ?`,
    )
    .bind(
      input.credential.tokenHash,
      input.credential.ciphertext,
      input.credential.nonce,
      input.credential.keyVersion,
      input.rotatedAt,
      input.themeId,
      input.participantId,
      input.expectedRotationCount,
    );
}

/** The five credential values stored on `participants` before `0010`. */
export interface LegacyQrCredential {
  credential: QrCredential;
  issuedAt: number;
}

export function legacyQrCredential(row: ParticipantRow): LegacyQrCredential | null {
  if (
    row.qr_token_hash === null ||
    row.qr_token_ciphertext === null ||
    row.qr_token_nonce === null ||
    row.qr_key_version === null ||
    row.qr_issued_at === null
  ) {
    return null;
  }

  return {
    credential: {
      tokenHash: row.qr_token_hash,
      ciphertext: row.qr_token_ciphertext,
      nonce: row.qr_token_nonce,
      keyVersion: row.qr_key_version,
    },
    issuedAt: row.qr_issued_at,
  };
}

/**
 * Number of complete legacy credentials that would be copied by `0010`.
 * Used by the release procedure to size the backfill before touching remote D1.
 */
export async function countLegacyQrCandidates(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM participants
        WHERE qr_token_hash IS NOT NULL
          AND qr_token_ciphertext IS NOT NULL
          AND qr_token_nonce IS NOT NULL
          AND qr_key_version IS NOT NULL
          AND qr_issued_at IS NOT NULL`,
    )
    .first<{ n: number }>();

  return row?.n ?? 0;
}
