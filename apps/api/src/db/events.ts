import type { EventRole, EventStatus } from "@absensi/shared";

/** Data access for events (DESAIN_API.md §3). No business rules here. */

export interface EventRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  timezone: string;
  starts_at: number | null;
  ends_at: number | null;
  status: EventStatus;
  allow_manual: number;
  created_at: number;
  created_by: string;
  archived_at: number | null;
}

export interface AccessibleEventRow extends EventRow {
  access_role: EventRole | "superadmin";
  participant_count: number;
}

export async function findEventName(db: D1Database, eventId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT name FROM events WHERE id = ?")
    .bind(eventId)
    .first<{ name: string }>();

  return row?.name ?? null;
}

export async function findEventById(db: D1Database, eventId: string): Promise<EventRow | null> {
  return db.prepare("SELECT * FROM events WHERE id = ?").bind(eventId).first<EventRow>();
}

export async function listAccessibleEvents(
  db: D1Database,
  input: { userId: string; role: "superadmin" | "event_admin" | "officer" },
): Promise<AccessibleEventRow[]> {
  const { results } = await db
    .prepare(
      `SELECT e.*,
              CASE WHEN ? = 'superadmin' THEN 'superadmin' ELSE m.role END AS access_role,
              (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id) AS participant_count
         FROM events e
         LEFT JOIN event_memberships m
                ON m.event_id = e.id AND m.user_id = ? AND m.status = 'active'
        WHERE ? = 'superadmin' OR m.id IS NOT NULL
        ORDER BY e.created_at DESC, e.id DESC`,
    )
    .bind(input.role, input.userId, input.role)
    .all<AccessibleEventRow>();

  return results;
}

export async function findAccessibleEvent(
  db: D1Database,
  eventId: string,
): Promise<(EventRow & { participant_count: number }) | null> {
  return db
    .prepare(
      `SELECT e.*,
              (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id) AS participant_count
         FROM events e
        WHERE e.id = ?`,
    )
    .bind(eventId)
    .first<EventRow & { participant_count: number }>();
}

export function insertEventStatement(
  db: D1Database,
  input: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    timezone: string;
    startsAt: number | null;
    endsAt: number | null;
    allowManual: boolean;
    createdAt: number;
    createdBy: string;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO events
         (id, slug, name, description, timezone, starts_at, ends_at, status,
          allow_manual, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.slug,
      input.name,
      input.description,
      input.timezone,
      input.startsAt,
      input.endsAt,
      input.allowManual ? 1 : 0,
      input.createdAt,
      input.createdBy,
    );
}

export interface EventUpdate {
  name?: string;
  description?: string | null;
  timezone?: string;
  startsAt?: number | null;
  endsAt?: number | null;
  allowManual?: boolean;
}

export function updateEventStatement(
  db: D1Database,
  eventId: string,
  update: EventUpdate,
): D1PreparedStatement {
  const sets: string[] = [];
  const values: Array<string | number | null> = [];

  if (update.name !== undefined) {
    sets.push("name = ?");
    values.push(update.name);
  }
  if (update.description !== undefined) {
    sets.push("description = ?");
    values.push(update.description);
  }
  if (update.timezone !== undefined) {
    sets.push("timezone = ?");
    values.push(update.timezone);
  }
  if (update.startsAt !== undefined) {
    sets.push("starts_at = ?");
    values.push(update.startsAt);
  }
  if (update.endsAt !== undefined) {
    sets.push("ends_at = ?");
    values.push(update.endsAt);
  }
  if (update.allowManual !== undefined) {
    sets.push("allow_manual = ?");
    values.push(update.allowManual ? 1 : 0);
  }

  if (sets.length === 0) {
    throw new Error("updateEventStatement: empty update");
  }

  values.push(eventId);
  return db.prepare(`UPDATE events SET ${sets.join(", ")} WHERE id = ?`).bind(...values);
}

export function updateEventStatusStatement(
  db: D1Database,
  eventId: string,
  status: EventStatus,
  now: number,
): D1PreparedStatement {
  const archivedAt = status === "archived" ? now : null;
  return db
    .prepare("UPDATE events SET status = ?, archived_at = ? WHERE id = ?")
    .bind(status, archivedAt, eventId);
}

/**
 * Hard delete is limited to an empty draft. The condition lives in SQL so a
 * participant or activity inserted concurrently cannot be cascaded away
 * between a check and a delete.
 */
export function deleteEmptyDraftStatement(
  db: D1Database,
  eventId: string,
): D1PreparedStatement {
  return db
    .prepare(
      `DELETE FROM events
        WHERE id = ?
          AND status = 'draft'
          AND NOT EXISTS (SELECT 1 FROM participants p WHERE p.event_id = events.id)
          AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.theme_id = events.id)`,
    )
    .bind(eventId);
}

export async function countParticipantsByStatus(
  db: D1Database,
  eventId: string,
): Promise<{ total: number; active: number; inactive: number }> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactive
         FROM participants
        WHERE event_id = ?`,
    )
    .bind(eventId)
    .first<{ total: number; active: number | null; inactive: number | null }>();

  return {
    total: row?.total ?? 0,
    active: row?.active ?? 0,
    inactive: row?.inactive ?? 0,
  };
}
