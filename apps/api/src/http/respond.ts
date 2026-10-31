import type { ApiErrorCode, ApiResponse } from "@absensi/shared";

import type { ApiError } from "./errors";

const JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  // Every API response carries user-specific data; never let a proxy cache it.
  "cache-control": "no-store",
};

export interface ResultInit {
  status?: number;
  headers?: Record<string, string>;
}

function envelope<T>(data: T): ApiResponse<T> {
  return { ok: true, data };
}

export function okJson<T>(data: T, init: ResultInit = {}): Response {
  return new Response(JSON.stringify(envelope(data)), {
    status: init.status ?? 200,
    headers: { ...JSON_HEADERS, ...(init.headers ?? {}) },
  });
}

export function failureJson(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: unknown,
  extraHeaders: Record<string, string> = {},
): Response {
  const body: ApiResponse<never> = {
    ok: false,
    error: details === undefined ? { code, message } : { code, message, details },
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

export function errorResponse(error: ApiError): Response {
  return failureJson(error.code, error.message, error.status, error.details, error.headers);
}

/**
 * Last line of defence: an unexpected throw becomes a generic 500 with no
 * internals leaked. Expected failures must be `ApiError` (see `http/errors.ts`).
 */
export function unexpectedErrorResponse(error: unknown): Response {
  console.error("unhandled_error", {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
  });

  return failureJson("INTERNAL", "Terjadi kesalahan pada server", 500);
}
