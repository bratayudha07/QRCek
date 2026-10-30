import type { ApiErrorCode, ApiResponse } from "@absensi/shared";
import { API_VERSION } from "@absensi/shared";

import type { Env } from "./env";

function jsonHeaders(): HeadersInit {
  return { "content-type": "application/json; charset=utf-8" };
}

function okJson<T>(data: T, init?: ResponseInit): Response {
  const body: ApiResponse<T> = { ok: true, data };
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { ...jsonHeaders(), ...(init?.headers ?? {}) },
  });
}

function errorJson(code: ApiErrorCode, message: string, status: number): Response {
  const body: ApiResponse<never> = { ok: false, error: { code, message } };
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders() });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/health") {
      return okJson({
        service: "absensi-api",
        version: API_VERSION,
        status: "ok" as const,
        timestamp: Date.now(),
      });
    }

    if (pathname.startsWith("/api/")) {
      return errorJson("NOT_FOUND", "Endpoint tidak ditemukan", 404);
    }

    // Everything else is the SPA (Workers Static Assets, ADR-001).
    return env.ASSETS.fetch(request);
  },
};
