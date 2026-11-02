/**
 * Security headers applied to every response (Fase 6, AGENTS.md §Keamanan).
 *
 * One source of truth for both delivery paths:
 *   - the Worker attaches these to JSON and proxied asset responses;
 *   - `apps/web/public/_headers` mirrors them for assets Cloudflare serves
 *     directly (with `run_worker_first: ["/api/*"]` the Worker never sees
 *     static files, so a Worker-only header would silently not apply).
 *
 * `apps/web/src/lib/security-headers.test.ts` fails when the two drift.
 *
 * CSP notes:
 *   - Scripts are limited to this origin plus Cloudflare's Turnstile origin;
 *     do not allow arbitrary remote or inline scripts.
 *   - Turnstile requires its script, iframe, and network origin in the matching
 *     CSP directives or the widget is blocked before it can render.
 *   - `style-src 'unsafe-inline'` is required because React writes inline
 *     `style` attributes (tab indicator offset, dynamic widths).
 *   - `worker-src blob:` is a precaution: the QR decoder may spawn a worker
 *     from a blob URL depending on the browser path it picks.
 *   - Camera is allowed for the same origin only; the scanner needs
 *     `getUserMedia`, everything else is denied.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(self), microphone=(), geolocation=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-xss-protection": "0",
};
