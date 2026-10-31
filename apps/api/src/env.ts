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
   * Extra browser origins trusted for CSRF checks, comma-separated. Empty in
   * production because the SPA and the Worker share one origin (ADR-001);
   * development sets it to the Vite origin.
   */
  ALLOWED_ORIGINS?: string;
}
