import type { ApiResponse } from "@absensi/shared";

import { handleRequest } from "../app";
import { testEnv } from "./env";

/**
 * Test harness that goes through the real router, cookies, CSRF, and D1.
 *
 * Only the clock is substituted (AGENTS.md: "Tidak ada tes yang bergantung pada
 * jam nyata — inject waktu"). Everything else is the production path, so a test
 * passing here means the Worker behaves that way, not a helper.
 */

export const TEST_ORIGIN = "https://absensi.test";

/** 2025-10-09T08:53:20Z — fixed so no assertion depends on today's date. */
export const TEST_NOW = 1_760_000_000_000;

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface Clock {
  now: () => number;
  set: (value: number) => void;
  advance: (ms: number) => void;
}

export function createClock(start = TEST_NOW): Clock {
  let current = start;

  return {
    now: () => current,
    set: (value) => {
      current = value;
    },
    advance: (ms) => {
      current += ms;
    },
  };
}

export interface CallOptions {
  method?: string;
  body?: unknown;
  /** Raw request body (CSV upload); mutually exclusive with `body`. */
  rawBody?: string;
  headers?: Record<string, string>;
  /** Full `Cookie` header value, e.g. `absensi_session=…`. */
  cookie?: string | null;
  now?: number;
  /** Set to `false` to send a deliberately CSRF-less request. */
  csrf?: boolean;
  origin?: string | null;
}

export interface TestResponse {
  status: number;
  headers: Headers;
  body: ApiResponse<never>;
  json<T>(): ApiResponse<T>;
  /** Raw body, for CSV endpoints that do not use the JSON envelope. */
  text: string;
  /** `Cookie` header value to replay the issued session, or `null`. */
  sessionCookie(): string | null;
  rawSetCookie(): string | null;
}

function extractSessionCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;

  const first = setCookie.split(";")[0]?.trim();
  if (!first || !first.startsWith("absensi_session=")) return null;

  return first;
}

export async function callApi(path: string, options: CallOptions = {}): Promise<TestResponse> {
  const method = (
    options.method ?? (options.body === undefined && options.rawBody === undefined ? "GET" : "POST")
  ).toUpperCase();
  const headers = new Headers(options.headers ?? {});

  const isSafe = method === "GET" || method === "HEAD" || method === "OPTIONS";

  if (!isSafe && options.csrf !== false) {
    headers.set("x-absensi-csrf", "1");
    headers.set("origin", options.origin === undefined ? TEST_ORIGIN : (options.origin ?? ""));
  }

  if (options.cookie) headers.set("cookie", options.cookie);

  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  if (options.rawBody !== undefined) {
    headers.set("content-type", "text/csv; charset=utf-8");
  }

  const now = options.now ?? TEST_NOW;
  const request = new Request(`${TEST_ORIGIN}${path}`, {
    method,
    headers,
    body:
      options.rawBody !== undefined
        ? options.rawBody
        : options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
  });

  const response = await handleRequest(request, testEnv, { now: () => now });
  const text = await response.clone().text();
  const isJson = (response.headers.get("content-type") ?? "").includes("application/json");
  const body = isJson
    ? (JSON.parse(text) as ApiResponse<never>)
    : ({ ok: false, error: { code: "INTERNAL", message: "Respons bukan JSON" } } as ApiResponse<never>);
  const setCookie = response.headers.get("set-cookie");

  return {
    status: response.status,
    headers: response.headers,
    body,
    json: <T>() => body as unknown as ApiResponse<T>,
    text,
    sessionCookie: () => extractSessionCookie(setCookie),
    rawSetCookie: () => setCookie,
  };
}

export function errorCode(response: TestResponse): string | null {
  return response.body.ok ? null : response.body.error.code;
}
