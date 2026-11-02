import { SECURITY_HEADERS } from "@absensi/shared";

/**
 * Attaches the shared security headers to a response without touching the body.
 *
 * `_headers` covers assets that Cloudflare serves directly, but anything the
 * Worker returns (JSON envelopes, CSV exports, the dev SPA proxy) bypasses that
 * file, so it must be applied here. Setting the same values twice is harmless.
 */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  // 204/304 must not carry a body; copying `null` keeps the status semantics.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
