/**
 * Base URL for the API.
 *
 * Empty by default, and that is the important part: the SPA and the Worker
 * share one origin (ADR-001), so `fetch("/api/health")` already hits the right
 * place in production.
 *
 * In development Vite proxies `/api` to the Worker on `:8787` (see
 * `vite.config.ts`), so the browser still talks to a single origin — cookies
 * and CORS behave the same as in production.
 *
 * Set `VITE_API_BASE_URL` only when the frontend is genuinely served from a
 * different origin (for example a preview deployment against a staging
 * Worker). Never hard-code an absolute production URL in the source.
 */
export function apiBaseUrl(): string {
  const configured: unknown = import.meta.env.VITE_API_BASE_URL;

  if (typeof configured !== "string") return "";

  const trimmed = configured.trim().replace(/\/+$/, "");
  if (trimmed === "") return "";

  return trimmed;
}

/** Joins the configured base URL with an API path such as `/api/health`. */
export function apiUrl(path: string): string {
  const pathWithLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  // Some content blockers classify XHR requests to `/api/events` as tracking.
  // Use a neutral public alias; the Worker maps it to the existing event routes.
  const suffix = pathWithLeadingSlash.replace(/^\/api\/events(?=\/|$)/, "/api/calendar");
  return `${apiBaseUrl()}${suffix}`;
}
