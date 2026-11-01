import { afterEach, describe, expect, it, vi } from "vitest";

import { verifyTurnstile } from "../integrations/turnstile";
import { testEnv } from "./env";
import { callApi, errorCode } from "./http";
import { countRows } from "./fixtures";

/**
 * Turnstile is the bot gate on public registration (ADR-007). The network is
 * never touched: `fetch` is injected, and the failure modes that matter are
 * "reject" ones — a check that fails open is worse than no check.
 */

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("verifyTurnstile", () => {
  it("accepts only an explicit success", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true }));

    const result = await verifyTurnstile({
      secret: "secret",
      token: "token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ success: true, errorCodes: [] });
  });

  it("passes through Turnstile error codes on failure", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: false, "error-codes": ["invalid-input-response"] }),
    );

    const result = await verifyTurnstile({
      secret: "secret",
      token: "token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.success).toBe(false);
    expect(result.errorCodes).toEqual(["invalid-input-response"]);
  });

  it("treats a non-2xx answer as failure", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true }, 500));

    const result = await verifyTurnstile({
      secret: "secret",
      token: "token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.success).toBe(false);
    expect(result.errorCodes).toEqual(["http-500"]);
  });

  it("fails closed when the request itself throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });

    const result = await verifyTurnstile({
      secret: "secret",
      token: "token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.success).toBe(false);
    expect(result.errorCodes).toEqual(["verification-failed"]);
  });

  it("does not call the network for an empty token", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true }));

    const result = await verifyTurnstile({
      secret: "secret",
      token: "   ",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.success).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("registration with Turnstile enabled", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(testEnv, "TURNSTILE_SECRET_KEY");
  });

  it("rejects a registration that carries no Turnstile token", async () => {
    Reflect.set(testEnv, "TURNSTILE_SECRET_KEY", "test-turnstile-secret");

    const response = await callApi("/api/auth/register", { body: { displayName: "Bot" } });

    expect(response.status).toBe(400);
    expect(errorCode(response)).toBe("TURNSTILE_FAILED");
    expect(await countRows("users")).toBe(0);
  });

  it("accepts a registration whose token Cloudflare confirms", async () => {
    Reflect.set(testEnv, "TURNSTILE_SECRET_KEY", "test-turnstile-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ success: true })),
    );

    const response = await callApi("/api/auth/register", {
      body: { displayName: "Manusia", turnstileToken: "valid-token" },
    });

    expect(response.status).toBe(201);
    expect(await countRows("users")).toBe(1);
  });
});
