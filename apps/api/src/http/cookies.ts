/**
 * Session cookie helpers (ADR-002: opaque 256-bit token, HMAC stored server-side).
 *
 * Attributes and why:
 *  - `HttpOnly`            JS never sees the token, so XSS cannot exfiltrate it.
 *  - `SameSite=Lax`        blocks cross-site POSTs; combined with the CSRF
 *                          header this closes the remaining gap.
 *  - `Secure`              only over HTTPS (omitted on http://localhost so dev
 *                          works — the browser ignores Secure cookies there).
 *  - `Path=/`              the SPA and the API share one origin (ADR-001).
 */

export const SESSION_COOKIE = "absensi_session";

/** 30 days, matching `sessions.expires_at` and DESAIN_API.md §2. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;

    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }

  return null;
}

export function sessionCookie(token: string, options: { secure: boolean }): string {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];

  if (options.secure) attributes.push("Secure");

  return attributes.join("; ");
}

export function clearSessionCookie(options: { secure: boolean }): string {
  const attributes = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];

  if (options.secure) attributes.push("Secure");

  return attributes.join("; ");
}

export function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}
