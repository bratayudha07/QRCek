import type { Env } from "../env";
import { ApiError } from "./errors";
import type { AuthContext } from "./auth";
import { authenticate } from "./auth";
import { assertCsrf } from "./security";
import { errorResponse, failureJson, okJson, unexpectedErrorResponse } from "./respond";

/**
 * Minimal method + path router.
 *
 * No dependency: the routing needs are "match literal segments and `:params`",
 * which is a dozen lines, and every added package must justify itself against
 * the free-tier/simplicity rules in AGENTS.md.
 */

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface RouteContext {
  request: Request;
  env: Env;
  /** Injected clock (ms since epoch) so tests never depend on wall time. */
  now: number;
  params: Record<string, string>;
  auth: AuthContext | null;
}

export interface RouteResult {
  status?: number;
  data?: unknown;
  headers?: Record<string, string>;
  /**
   * Raw response for non-JSON endpoints (CSV export/template). When set, the
   * dispatcher returns it untouched instead of wrapping `data` in the envelope.
   */
  raw?: Response;
}

export type RouteHandler = (context: RouteContext) => Promise<RouteResult> | RouteResult;

export interface RouteDefinition {
  method: HttpMethod;
  /** `/api/events/:eventId/members`; `:name` becomes `params.name`. */
  pattern: string;
  /**
   * `true` only for endpoints that must work without a session. Every other
   * route is authenticated unconditionally by the dispatcher, so forgetting a
   * guard in a handler cannot leave a hole.
   */
  public: boolean;
  handler: RouteHandler;
}

function splitPath(path: string): string[] {
  return path.split("/").filter(Boolean);
}

export function matchPattern(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  const patternParts = splitPath(pattern);
  const pathParts = splitPath(pathname);

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i] as string;
    const actual = pathParts[i] as string;

    if (expected.startsWith(":")) {
      if (actual === "") return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }

    if (expected !== actual) return null;
  }

  return params;
}

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/+$/, ""))
    .filter((value) => value !== "");
}

/**
 * Returns `null` when no route matches, so the caller can fall through to the
 * SPA. Throws `ApiError` for every expected failure.
 */
export async function dispatchRoutes(
  routes: readonly RouteDefinition[],
  request: Request,
  env: Env,
  now: number,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  const method = request.method.toUpperCase();

  let params: Record<string, string> | null = null;
  let matched: RouteDefinition | null = null;

  for (const route of routes) {
    if (route.method !== method) continue;

    const candidate = matchPattern(route.pattern, pathname);
    if (candidate) {
      matched = route;
      params = candidate;
      break;
    }
  }

  if (!matched || !params) return null;

  try {
    if (!matched.public) {
      assertCsrf(request, { allowedOrigins: allowedOrigins(env) });
    }

    const auth = matched.public ? null : await authenticate(request, env, now);
    if (!matched.public && !auth) {
      throw new ApiError(401, "UNAUTHENTICATED", "Sesi tidak valid atau sudah berakhir");
    }

    const result = await matched.handler({ request, env, now, params, auth });

    if (result.raw) return result.raw;

    return okJson(result.data, { status: result.status, headers: result.headers });
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    return unexpectedErrorResponse(error);
  }
}

/** 404 for unmatched `/api/*` paths; the SPA never sees them (ADR-001). */
export function apiNotFound(): Response {
  return failureJson("NOT_FOUND", "Endpoint tidak ditemukan", 404);
}
