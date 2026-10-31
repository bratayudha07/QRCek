import type { EventRole } from "@absensi/shared";

export interface InviteRow {
  id: string;
  event_id: string | null;
  event_name: string | null;
  role: "superadmin" | EventRole;
  target_user_id: string | null;
  invited_name: string | null;
  expires_at: number;
  used_at: number | null;
}

export function insertInviteStatement(
  db: D1Database,
  input: {
    id: string;
    eventId: string | null;
    role: "superadmin" | EventRole;
    tokenHash: string;
    targetUserId?: string | null;
    invitedName?: string | null;
    invitedPhone?: string | null;
    createdBy?: string | null;
    createdAt: number;
    expiresAt: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO invites
         (id, event_id, role, token_hash, target_user_id, invited_name, invited_phone,
          created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.eventId,
      input.role,
      input.tokenHash,
      input.targetUserId ?? null,
      input.invitedName ?? null,
      input.invitedPhone ?? null,
      input.createdBy ?? null,
      input.createdAt,
      input.expiresAt,
    );
}

/**
 * Looks up by hash only. Expiry and reuse are checked by the caller so the
 * response for "unknown", "expired", and "already used" can be identical
 * (RENCANA_PENGUJIAN.md §5.2: no token-state oracle for attackers).
 */
export async function findInviteByHash(db: D1Database, tokenHash: string): Promise<InviteRow | null> {
  return db
    .prepare(
      `SELECT i.id, i.event_id, e.name AS event_name, i.role, i.target_user_id,
              i.invited_name, i.expires_at, i.used_at
         FROM invites i
         LEFT JOIN events e ON e.id = i.event_id
        WHERE i.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<InviteRow>();
}

/**
 * Atomic claim: the `used_at IS NULL` predicate is the mutex that makes replay
 * impossible even under concurrent requests (D1 serialises writes).
 *
 * `used_by` is set later, inside the same batch as the user insert. Writing it
 * here would violate the foreign key, because the user does not exist yet.
 */
export async function claimInvite(
  db: D1Database,
  inviteId: string,
  now: number,
): Promise<number> {
  const result = await db
    .prepare("UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL")
    .bind(now, inviteId)
    .run();

  return result.meta.changes;
}

/** Attribution is recorded once the activating user row exists. */
export function setInviteUsedByStatement(
  db: D1Database,
  inviteId: string,
  userId: string,
): D1PreparedStatement {
  return db
    .prepare("UPDATE invites SET used_by = ? WHERE id = ? AND used_by IS NULL")
    .bind(userId, inviteId);
}

export async function countActiveInvites(
  db: D1Database,
  eventId: string,
  now: number,
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM invites WHERE event_id = ? AND used_at IS NULL AND expires_at > ?",
    )
    .bind(eventId, now)
    .first<{ n: number }>();

  return row?.n ?? 0;
}

export async function listInvites(
  db: D1Database,
  eventId: string,
): Promise<
  Array<{
    id: string;
    role: EventRole;
    invited_name: string | null;
    created_at: number;
    expires_at: number;
    used_at: number | null;
  }>
> {
  const { results } = await db
    .prepare(
      `SELECT id, role, invited_name, created_at, expires_at, used_at
         FROM invites
        WHERE event_id = ?
        ORDER BY created_at DESC
        LIMIT 100`,
    )
    .bind(eventId)
    .all<{
      id: string;
      role: EventRole;
      invited_name: string | null;
      created_at: number;
      expires_at: number;
      used_at: number | null;
    }>();

  return results.map((row) => ({ ...row }));
}

/** Only deletes unused invites; a redeemed invite is history, not deletable. */
export async function deletePendingInvite(
  db: D1Database,
  eventId: string,
  inviteId: string,
): Promise<number> {
  const result = await db
    .prepare("DELETE FROM invites WHERE id = ? AND event_id = ? AND used_at IS NULL")
    .bind(inviteId, eventId)
    .run();

  return result.meta.changes;
}
