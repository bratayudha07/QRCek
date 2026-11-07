import { pruneRateLimitsStatement } from "../db/rate-limit";
import { pruneExpiredSessionsStatement } from "../db/sessions";
import type { Env } from "../env";

/**
 * Scheduled cleanup for tables that are append-only in normal operation.
 *
 * `rate_limits` gains one row per (bucket, window) and `sessions` gains one row
 * per login; neither is ever deleted by a user request. Cron runs this every
 * five minutes (DESAIN_API.md §12), so the sweep must stay bounded: 500 rows
 * per category per tick is far below the free-tier write budget and still
 * drains a backlog within a day.
 *
 * Retention:
 *   - rate limits: one hour after the window closed (longest window in use);
 *   - sessions: immediately after `expires_at`, which `authenticate` already
 *     treats as unusable.
 */

export const RATE_LIMIT_RETENTION_MS = 60 * 60 * 1000;
export const HOUSEKEEPING_BATCH = 500;

export async function runHousekeeping(env: Env, now: number): Promise<void> {
  await env.DB.batch([
    pruneRateLimitsStatement(env.DB, {
      before: now - RATE_LIMIT_RETENTION_MS,
      limit: HOUSEKEEPING_BATCH,
    }),
    pruneExpiredSessionsStatement(env.DB, { before: now, limit: HOUSEKEEPING_BATCH }),
  ]);
}
