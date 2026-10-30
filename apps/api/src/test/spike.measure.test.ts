import { testEnv as env } from "./env";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Spike (IMPLEMENTATION_PLAN.md Fase 0): cost proxy for the hot paths.
 *
 * IMPORTANT: this measures *wall clock* inside local workerd, not the platform's
 * billed CPU time. Cloudflare's CPU accounting is only observable via
 * `wrangler tail` on a deployed Worker, which needs an account. Treat these
 * numbers as an upper-bound proxy and re-measure before trusting the 5 ms gate.
 */

const NOW = 1_730_000_000_000;
const ITERATIONS = 100;

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function summarise(label: string, samples: readonly number[]): string {
  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  const max = Math.max(...samples);
  return `${label.padEnd(34)} p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms`;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("spike-pepper"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function hmac(key: CryptoKey, value: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

describe("spike: hot path cost proxy", () => {
  beforeEach(async () => {
    await env.DB.exec("DROP TABLE IF EXISTS spike_scan;");
    await env.DB.exec("DROP TABLE IF EXISTS spike_import;");
    await env.DB.exec(
      "CREATE TABLE spike_scan (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE);",
    );
    await env.DB.exec(
      "CREATE TABLE spike_import (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL);",
    );
  });

  it("measures HMAC-SHA256 throughput", async () => {
    const key = await hmacKey();
    const runs = 1000;

    // Batched so the 1 ms resolution of performance.now() in workerd does not
    // dominate the sample (single-op timing rounds to 0.00 ms).
    const start = performance.now();
    for (let i = 0; i < runs; i += 1) {
      await hmac(key, `token-${i}`);
    }
    const elapsed = performance.now() - start;

    console.log(
      `hmac-sha256 throughput: ${runs} ops in ${elapsed.toFixed(1)}ms  per-op=${(elapsed / runs).toFixed(4)}ms`,
    );

    expect(elapsed).toBeGreaterThan(0);
  });

  it("measures a scan proxy: hmac + indexed select + insert batch", async () => {
    const key = await hmacKey();
    const samples: number[] = [];

    for (let i = 0; i < ITERATIONS; i += 1) {
      const start = performance.now();

      const tokenHash = await hmac(key, `scan-token-${i}`);

      await env.DB.prepare("SELECT id FROM spike_scan WHERE token_hash = ?")
        .bind(tokenHash)
        .first();

      await env.DB.batch([
        env.DB.prepare("INSERT INTO spike_scan (id, token_hash) VALUES (?, ?)").bind(
          `s-${i}`,
          tokenHash,
        ),
        env.DB.prepare(
          "INSERT INTO rate_limits (bucket, window_start, counter) VALUES (?, ?, 1) ON CONFLICT (bucket, window_start) DO UPDATE SET counter = counter + 1",
        ).bind(`scan:${i}`, NOW),
      ]);

      samples.push(performance.now() - start);
    }

    console.log(summarise("scan proxy (hmac+select+batch)", samples));
    expect(samples).toHaveLength(ITERATIONS);
  });

  it("measures CSV import proxies at 500 / 1000 / 2000 rows", async () => {
    const key = await hmacKey();

    for (const rowCount of [500, 1000, 2000]) {
      await env.DB.exec("DELETE FROM spike_import;");

      const start = performance.now();

      const rows: D1PreparedStatement[] = [];
      for (let i = 0; i < rowCount; i += 1) {
        const tokenHash = await hmac(key, `import-${rowCount}-${i}`);
        rows.push(
          env.DB.prepare("INSERT INTO spike_import (id, token_hash, name) VALUES (?, ?, ?)").bind(
            `p-${i}`,
            tokenHash,
            `Peserta ${i}`,
          ),
        );
      }

      for (let offset = 0; offset < rows.length; offset += 200) {
        await env.DB.batch(rows.slice(offset, offset + 200));
      }

      const elapsed = performance.now() - start;
      console.log(
        `import proxy ${String(rowCount).padStart(4)} rows: hmac+insert total=${elapsed.toFixed(1)}ms  per-row=${(elapsed / rowCount).toFixed(3)}ms`,
      );
    }

    expect(true).toBe(true);
  });
});
