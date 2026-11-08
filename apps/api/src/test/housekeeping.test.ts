import { describe, expect, it } from "vitest";

import { pruneRateLimitsStatement } from "../db/rate-limit";
import { HOUSEKEEPING_BATCH, RATE_LIMIT_RETENTION_MS, runHousekeeping } from "../services/housekeeping";
import { createSession, createUser } from "./fixtures";
import { testEnv } from "./env";
import { TEST_NOW } from "./http";

/**
 * Bounded cleanup driven by cron (DESAIN_API.md §12). Both tables only grow
 * through normal requests, so this is the only place that deletes from them.
 */

async function rateLimitBuckets(): Promise<string[]> {
  const { results } = await testEnv.DB.prepare(
    "SELECT bucket FROM rate_limits ORDER BY bucket",
  ).all<{ bucket: string }>();

  return results.map((row) => row.bucket);
}

describe("runHousekeeping", () => {
  it("drops finished rate-limit windows and keeps the active one", async () => {
    const expiredWindow = TEST_NOW - RATE_LIMIT_RETENTION_MS - 1;
    const activeWindow = TEST_NOW - 1_000;

    await testEnv.DB.batch([
      testEnv.DB.prepare(
        "INSERT INTO rate_limits (bucket, window_start, counter) VALUES (?, ?, 1)",
      ).bind("lama", expiredWindow),
      testEnv.DB.prepare(
        "INSERT INTO rate_limits (bucket, window_start, counter) VALUES (?, ?, 1)",
      ).bind("baru", activeWindow),
    ]);

    await runHousekeeping(testEnv, TEST_NOW);

    expect(await rateLimitBuckets()).toEqual(["baru"]);
  });

  it("caps one sweep so a backlog cannot exceed the documented write budget", async () => {
    await testEnv.DB.prepare(
      `WITH RECURSIVE seq(n) AS (
         SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?
       )
       INSERT INTO rate_limits (bucket, window_start, counter)
       SELECT 'bucket-' || n, ?, 1 FROM seq`,
    )
      .bind(HOUSEKEEPING_BATCH + 2, TEST_NOW - RATE_LIMIT_RETENTION_MS - 1)
      .run();

    await runHousekeeping(testEnv, TEST_NOW);

    const remaining = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM rate_limits",
    ).first<{ n: number }>();

    expect(remaining?.n).toBe(2);
  });

  it("deletes expired sessions and keeps live ones", async () => {
    const userId = await createUser({ role: "officer" });
    const expired = await createSession(userId, { expiresAt: TEST_NOW - 1 });
    const live = await createSession(userId);

    await runHousekeeping(testEnv, TEST_NOW);

    const { results } = await testEnv.DB.prepare("SELECT id FROM sessions").all<{
      id: string;
    }>();
    const ids = results.map((row) => row.id);

    expect(ids).toEqual([live.sessionId]);
    expect(ids).not.toContain(expired.sessionId);
  });

  it("prunes rate limits in bounded batches when called statement-by-statement", async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        "INSERT INTO rate_limits (bucket, window_start, counter) VALUES (?, ?, 1)",
      ).bind("a", TEST_NOW - RATE_LIMIT_RETENTION_MS - 1),
      testEnv.DB.prepare(
        "INSERT INTO rate_limits (bucket, window_start, counter) VALUES (?, ?, 1)",
      ).bind("b", TEST_NOW - RATE_LIMIT_RETENTION_MS - 1),
      testEnv.DB.prepare(
        "INSERT INTO rate_limits (bucket, window_start, counter) VALUES (?, ?, 1)",
      ).bind("c", TEST_NOW - RATE_LIMIT_RETENTION_MS - 1),
    ]);

    const result = await pruneRateLimitsStatement(testEnv.DB, {
      before: TEST_NOW,
      limit: 2,
    }).run();

    expect(result.meta.changes).toBe(2);
  });
});
