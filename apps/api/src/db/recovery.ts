export function insertRecoveryCodeStatement(
  db: D1Database,
  input: { id: string; userId: string; codeHash: string; createdAt: number },
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)")
    .bind(input.id, input.userId, input.codeHash, input.createdAt);
}

export async function findUnusedRecoveryCode(
  db: D1Database,
  codeHash: string,
): Promise<{ id: string; user_id: string } | null> {
  return db
    .prepare("SELECT id, user_id FROM recovery_codes WHERE code_hash = ? AND used_at IS NULL")
    .bind(codeHash)
    .first<{ id: string; user_id: string }>();
}

/** Atomic single-use claim, mirroring `claimInvite`. */
export async function claimRecoveryCode(
  db: D1Database,
  codeId: string,
  now: number,
): Promise<number> {
  const result = await db
    .prepare("UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL")
    .bind(now, codeId)
    .run();

  return result.meta.changes;
}

/**
 * Compensation for a failed recovery batch.
 *
 * A session row is the marker of a committed batch: a batch can commit and
 * still throw (ambiguous network outcome). Releasing the code when that session
 * exists would let a second recovery revoke the session just issued, so the
 * guard lives in the same statement as the release.
 */
export async function releaseRecoveryCodeClaim(
  db: D1Database,
  codeId: string,
  sessionId: string,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE recovery_codes SET used_at = NULL
        WHERE id = ? AND NOT EXISTS (SELECT 1 FROM sessions WHERE id = ?)`,
    )
    .bind(codeId, sessionId)
    .run();

  return result.meta.changes;
}

/** A new code invalidates every older unused one. */
export function useAllRecoveryCodesStatement(
  db: D1Database,
  userId: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
    )
    .bind(now, userId);
}
