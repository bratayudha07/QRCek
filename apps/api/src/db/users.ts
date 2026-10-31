import type { EventRole, Role } from "@absensi/shared";

export interface UserRow {
  id: string;
  display_name: string;
  role: Role;
  status: "active" | "suspended";
}

export interface MembershipRow {
  event_id: string;
  event_name: string;
  role: EventRole;
}

export interface InsertUserInput {
  id: string;
  displayName: string;
  role: Role;
  createdAt: number;
  createdBy?: string | null;
}

export function insertUserStatement(db: D1Database, input: InsertUserInput): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO users (id, display_name, role, status, created_at, created_by)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    )
    .bind(input.id, input.displayName, input.role, input.createdAt, input.createdBy ?? null);
}

/**
 * Re-inviting a previously revoked member must revive the same row: the table
 * has a unique `(event_id, user_id)` constraint, so a plain INSERT would fail
 * and turn a normal operation into a 500.
 */
export function upsertMembershipStatement(
  db: D1Database,
  input: {
    id: string;
    eventId: string;
    userId: string;
    role: EventRole;
    createdAt: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO event_memberships (id, event_id, user_id, role, status, created_at)
       VALUES (?, ?, ?, ?, 'active', ?)
       ON CONFLICT (event_id, user_id) DO UPDATE SET
         role        = excluded.role,
         status      = 'active',
         revoked_at  = NULL,
         created_at  = excluded.created_at`,
    )
    .bind(input.id, input.eventId, input.userId, input.role, input.createdAt);
}

/** Only used for a bootstrap/superadmin invite handed to an existing user. */
export function updateUserRoleStatement(
  db: D1Database,
  userId: string,
  role: Role,
): D1PreparedStatement {
  return db.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, userId);
}

/** A revoked/suspended account must not be reactivated by an old invite. */
export async function findActiveUserById(
  db: D1Database,
  id: string,
): Promise<UserRow | null> {
  const row = await findUserById(db, id);
  return row && row.status === "active" ? row : null;
}

export async function findUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db
    .prepare("SELECT id, display_name, role, status FROM users WHERE id = ?")
    .bind(id)
    .first<UserRow>();
}

export async function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db
    .prepare("SELECT id, display_name, role, status FROM users WHERE email = ?")
    .bind(email)
    .first<UserRow>();
}

export async function listActiveMemberships(
  db: D1Database,
  userId: string,
): Promise<MembershipRow[]> {
  const { results } = await db
    .prepare(
      `SELECT m.event_id, e.name AS event_name, m.role
         FROM event_memberships m
         JOIN events e ON e.id = m.event_id
        WHERE m.user_id = ? AND m.status = 'active'
        ORDER BY e.name`,
    )
    .bind(userId)
    .all<MembershipRow>();

  return results;
}

/** `null` when the user is not an active member of that event. */
export async function findActiveMembership(
  db: D1Database,
  eventId: string,
  userId: string,
): Promise<EventRole | null> {
  const row = await db
    .prepare(
      `SELECT role FROM event_memberships
        WHERE event_id = ? AND user_id = ? AND status = 'active'`,
    )
    .bind(eventId, userId)
    .first<{ role: EventRole }>();

  return row?.role ?? null;
}

export async function revokeMembership(
  db: D1Database,
  eventId: string,
  userId: string,
  now: number,
): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE event_memberships
          SET status = 'revoked', revoked_at = ?
        WHERE event_id = ? AND user_id = ? AND status = 'active'`,
    )
    .bind(now, eventId, userId)
    .run();

  return result.meta.changes;
}

export async function listMembers(
  db: D1Database,
  eventId: string,
): Promise<Array<{ user_id: string; display_name: string; role: EventRole; created_at: number }>> {
  const { results } = await db
    .prepare(
      `SELECT m.user_id, u.display_name, m.role, m.created_at
         FROM event_memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.event_id = ? AND m.status = 'active'
        ORDER BY m.role DESC, u.display_name`,
    )
    .bind(eventId)
    .all<{ user_id: string; display_name: string; role: EventRole; created_at: number }>();

  return results;
}
