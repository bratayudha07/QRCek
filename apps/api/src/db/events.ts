export async function findEventName(db: D1Database, eventId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT name FROM events WHERE id = ?")
    .bind(eventId)
    .first<{ name: string }>();

  return row?.name ?? null;
}
