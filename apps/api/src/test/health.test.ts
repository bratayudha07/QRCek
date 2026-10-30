import { testEnv as env } from "./env";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import worker from "../index";
import type { ApiResponse, HealthPayload } from "@absensi/shared";

async function call(path: string): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`https://absensi.test${path}`), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("GET /api/health", () => {
  it("responds with the versioned success envelope", async () => {
    const response = await call("/api/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = (await response.json()) as ApiResponse<HealthPayload>;

    expect(body.ok).toBe(true);
    if (!body.ok) throw new Error("unreachable");

    expect(body.data.service).toBe("absensi-api");
    expect(body.data.version).toBe("v1");
    expect(body.data.status).toBe("ok");
    expect(typeof body.data.timestamp).toBe("number");
  });

  it("returns a typed 404 envelope for unknown API routes", async () => {
    const response = await call("/api/does-not-exist");

    expect(response.status).toBe(404);

    const body = (await response.json()) as ApiResponse<never>;

    expect(body.ok).toBe(false);
    if (body.ok) throw new Error("unreachable");

    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("does not leak stack traces on unknown routes", async () => {
    const response = await call("/api/nope");
    const text = await response.text();

    expect(text).not.toMatch(/at .*\.ts:\d+/);
    expect(text).not.toContain("Error:");
  });
});
