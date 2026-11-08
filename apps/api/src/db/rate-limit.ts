export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current window ends, for `Retry-After`. */
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter, one row per (bucket, window).
 *
 * Verified in Fase 0: D1 supports `INSERT ... ON CONFLICT ... RETURNING`, so
 * this is a single statement instead of the two-statement fallback described in
 * DESAIN_API.md §11.
 */
export async function consumeRateLimit(
  db: D1Database,
  input: { bucket: string; now: number; windowMs: number; limit: number },
): Promise<RateLimitResult> {
  const windowStart = Math.floor(input.now / input.windowMs) * input.windowMs;

  const row = await db
    .prepare(
      `INSERT INTO rate_limits (bucket, window_start, counter)
       VALUES (?, ?, 1)
       ON CONFLICT (bucket, window_start) DO UPDATE SET counter = counter + 1
       RETURNING counter`,
    )
    .bind(input.bucket, windowStart)
    .first<{ counter: number }>();

  const count = row?.counter ?? 1;
  const windowEnd = windowStart + input.windowMs;

  return {
    allowed: count <= input.limit,
    retryAfterSeconds: Math.max(1, Math.ceil((windowEnd - input.now) / 1000)),
  };
}

/**
 * Deletes finished windows. Bounded so one cron tick cannot write an unbounded
 * number of rows; the 5-minute schedule drains any backlog quickly.
 */
export function pruneRateLimitsStatement(
  db: D1Database,
  input: { before: number; limit: number },
): D1PreparedStatement {
  return db
    .prepare(
      `DELETE FROM rate_limits
        WHERE rowid IN (
          SELECT rowid FROM rate_limits WHERE window_start < ? LIMIT ?
        )`,
    )
    .bind(input.before, input.limit);
}
