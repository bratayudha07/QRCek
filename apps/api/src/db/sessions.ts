import type { Role } from "@absensi/shared";

export interface SessionLookupRow {
  session_id: string;
  user_id: string;
  expires_at: number;
  revoked_at: number | null;
  role: Role;
  status: "active" | "suspended";
  display_name: string;
}

export function insertCredentialStatement(
  db: D1Database,
  input: { id: string; userId: string; tokenHash: string; label: string | null; createdAt: number },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO device_credentials (id, user_id, token_hash, label, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(input.id, input.userId, input.tokenHash, input.label, input.createdAt);
}

export function insertSessionStatement(
  db: D1Database,
  input: {
    id: string;
    tokenHash: string;
    userId: string;
    credentialId: string;
    createdAt: number;
    expiresAt: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO sessions
         (id, token_hash, user_id, credential_id, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.tokenHash,
      input.userId,
      input.credentialId,
      input.createdAt,
      input.createdAt,
      input.expiresAt,
    );
}

export async function findSessionByTokenHash(
  db: D1Database,
  tokenHash: string,
): Promise<SessionLookupRow | null> {
  return db
    .prepare(
      `SELECT s.id AS session_id, s.user_id, s.expires_at, s.revoked_at,
              u.role, u.status, u.display_name
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<SessionLookupRow>();
}

/**
 * Update `last_seen_at` only when it is stale.
 *
 * This runs on every authenticated request, so guarding by age keeps the write
 * rate low instead of turning every read endpoint into a write.
 */
export async function touchSession(
  db: D1Database,
  sessionId: string,
  now: number,
  staleAfterMs: number,
): Promise<void> {
  await db
    .prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ? AND last_seen_at < ?")
    .bind(now, sessionId, now - staleAfterMs)
    .run();
}

export async function revokeSession(
  db: D1Database,
  sessionId: string,
  userId: string,
  now: number,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE sessions SET revoked_at = ?
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .bind(now, sessionId, userId)
    .run();

  return result.meta.changes;
}

/** Used on recovery: a lost device must not keep a usable session. */
export function revokeAllSessionsStatement(
  db: D1Database,
  userId: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
    .bind(now, userId);
}

export function revokeAllCredentialsStatement(
  db: D1Database,
  userId: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE device_credentials SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
    )
    .bind(now, userId);
}

export async function listSessions(
  db: D1Database,
  userId: string,
  now: number,
): Promise<
  Array<{
    id: string;
    label: string | null;
    created_at: number;
    last_seen_at: number;
    expires_at: number;
  }>
> {
  const { results } = await db
    .prepare(
      `SELECT s.id, c.label, s.created_at, s.last_seen_at, s.expires_at
         FROM sessions s
         LEFT JOIN device_credentials c ON c.id = s.credential_id
        WHERE s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > ?
        ORDER BY s.last_seen_at DESC`,
    )
    .bind(userId, now)
    .all<{
      id: string;
      label: string | null;
      created_at: number;
      last_seen_at: number;
      expires_at: number;
    }>();

  return results;
}
