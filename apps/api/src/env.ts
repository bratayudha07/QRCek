/**
 * Bindings available to the Worker at runtime.
 *
 * Declared by hand for now; `wrangler types` can replace this once the
 * binding set stabilises.
 */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}
