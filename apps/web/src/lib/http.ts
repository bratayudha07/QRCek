import type { ApiResponse } from "@absensi/shared";

import { apiUrl } from "./api";

/**
 * Single fetch wrapper for the SPA.
 *
 * - `credentials: "same-origin"` so the HttpOnly session cookie is sent (ADR-001).
 * - `x-absensi-csrf: 1` on every call, including GET. The Worker only checks it
 *   on state-changing methods, but sending it unconditionally means a refactor
 *   cannot forget it.
 *
 * The token itself is never readable from JavaScript: it lives in an HttpOnly
 * cookie, so there is nothing here to leak into localStorage or a log.
 */
export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<ApiResponse<T>> {
  const headers = new Headers(init.headers);
  headers.set("x-absensi-csrf", "1");
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: "same-origin",
    headers,
  });

  try {
    return (await response.json()) as ApiResponse<T>;
  } catch {
    return {
      ok: false,
      error: { code: "INTERNAL", message: "Respons server tidak dikenali" },
    };
  }
}
