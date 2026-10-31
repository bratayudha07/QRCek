import { ApiError } from "./errors";
import { hmacSha256 } from "../domain/token";

/**
 * CSRF defence for a cookie-authenticated same-origin API (ADR-001).
 *
 * `SameSite=Lax` already blocks the classic cross-site form POST, but older
 * browsers and same-site subdomains still slip through. Two cheap checks close
 * that:
 *   1. a custom header, which a cross-origin form cannot set without CORS
 *      preflight — and the Worker never answers a preflight with `allow-origin`;
 *   2. `Origin` matching the request host, which blocks same-site deception.
 *
 * Both are required. Retrying without them is a 403, never a silent pass.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function csrfFailed(): ApiError {
  return new ApiError(403, "CSRF_FAILED", "Permintaan ditolak: verifikasi keamanan gagal");
}

export interface CsrfOptions {
  /**
   * Extra origins trusted in addition to the request host. Only needed when a
   * proxy or a preview deployment makes the browser origin differ from the
   * Worker URL; production keeps this empty.
   */
  allowedOrigins?: readonly string[];
}

export function assertCsrf(request: Request, options: CsrfOptions = {}): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;

  if (request.headers.get("x-absensi-csrf") !== "1") {
    throw csrfFailed();
  }

  const origin = request.headers.get("origin");
  if (!origin) throw csrfFailed();

  const url = new URL(request.url);
  const expected = `${url.protocol}//${url.host}`;
  const supplied = origin.replace(/\/+$/, "");

  if (supplied !== expected && !(options.allowedOrigins ?? []).includes(supplied)) {
    throw csrfFailed();
  }
}

/**
 * Stable, non-reversible client identifier for rate limiting.
 *
 * Hashing keeps raw IPs out of D1 and logs (AGENTS.md: do not log PII). The
 * pepper is the same Worker secret, so the value cannot be rainbow-tabled
 * against the small IPv4 space by someone who only has a database dump.
 */
export async function clientIpHash(request: Request, pepper: string): Promise<string> {
  const forwardingHeaders = ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"];

  let ip = "unknown";
  for (const header of forwardingHeaders) {
    const value = request.headers.get(header);
    if (value) {
      ip = value.split(",")[0]?.trim() || "unknown";
      break;
    }
  }

  return (await hmacSha256(pepper, `ip:${ip}`)).slice(0, 22);
}
