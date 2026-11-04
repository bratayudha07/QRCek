import type { AdminUsagePayload } from "@absensi/shared";

/**
 * Usage snapshot for capacity planning (DESAIN_API.md §10, Fase 6).
 *
 * Read-only and deliberately small: one `db.batch` so the whole snapshot costs a
 * single round trip. `COUNT(*)` still reads the table, so this endpoint is for a
 * human or a rare monitor call, not for cron. Nothing here is per-user data —
 * only counts and two timestamps.
 */

type CountRow = { n: number };
type OutboxRow = { status: string; n: number };
type AuditBoundsRow = { oldest: number | null; newest: number | null };

function countAt(results: D1Result<unknown>[], index: number): number {
  const row = results[index]?.results?.[0] as CountRow | undefined;
  return row?.n ?? 0;
}

export async function readUsage(
  db: D1Database,
  now: number,
): Promise<Omit<AdminUsagePayload, "generatedAt">> {
  const results = await db.batch([
    db.prepare("SELECT COUNT(*) AS n FROM users"),
    db.prepare("SELECT COUNT(*) AS n FROM events"),
    db.prepare("SELECT COUNT(*) AS n FROM participants"),
    db.prepare("SELECT COUNT(*) AS n FROM attendance"),
    db.prepare("SELECT COUNT(*) AS n FROM audit_log"),
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL AND expires_at > ?",
      )
      .bind(now),
    db.prepare("SELECT COUNT(*) AS n FROM rate_limits"),
    db.prepare("SELECT status, COUNT(*) AS n FROM outbox GROUP BY status"),
    db.prepare("SELECT MIN(created_at) AS oldest, MAX(created_at) AS newest FROM audit_log"),
  ]);

  const outboxRows = (results[7]?.results ?? []) as OutboxRow[];
  const outbox = { queued: 0, failed: 0, dead: 0 };

  for (const row of outboxRows) {
    if (row.status === "pending" || row.status === "inflight") outbox.queued += row.n;
    else if (row.status === "failed") outbox.failed = row.n;
    else if (row.status === "dead") outbox.dead = row.n;
  }

  const bounds = (results[8]?.results?.[0] ?? { oldest: null, newest: null }) as AuditBoundsRow;

  return {
    counts: {
      users: countAt(results, 0),
      events: countAt(results, 1),
      participants: countAt(results, 2),
      attendance: countAt(results, 3),
      auditEntries: countAt(results, 4),
      activeSessions: countAt(results, 5),
      rateLimitBuckets: countAt(results, 6),
      outbox,
    },
    auditLog: {
      oldestAt: bounds.oldest,
      newestAt: bounds.newest,
    },
  };
}
