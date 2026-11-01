/**
 * Bindings available to the Worker at runtime.
 *
 * Declared by hand for now; `wrangler types` can replace this once the
 * binding set stabilises.
 */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  /**
   * Server-side pepper for every token hash (sessions, invites, recovery codes)
   * and for the rate-limit IP hash. In production this is a `wrangler secret`,
   * never a plain var and never in the frontend bundle.
   */
  SESSION_PEPPER: string;

  /**
   * Server-side pepper for participant QR token hashes (ADR-003/ADR-006).
   * Separate from `SESSION_PEPPER` so rotating one does not revoke the other.
   * The token itself is encrypted with `QR_ENCRYPTION_KEY`, never stored raw.
   */
  QR_PEPPER: string;

  /**
   * Base64-encoded 32-byte AES-256-GCM key for the encrypted copy of each QR
   * token. `wrangler secret`, never a plain var and never in the frontend.
   */
  QR_ENCRYPTION_KEY: string;

  /**
   * Key generation used by `QR_ENCRYPTION_KEY`. Bump only together with a
   * rotation that re-encrypts existing credentials (see docs/OPERASIONAL.md).
   * Missing means version 1.
   */
  QR_KEY_VERSION?: string;

  /**
   * Extra browser origins trusted for CSRF checks, comma-separated. Empty in
   * production because the SPA and the Worker share one origin (ADR-001);
   * development sets it to the Vite origin.
   */
  ALLOWED_ORIGINS?: string;
}
