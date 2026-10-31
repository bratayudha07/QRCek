import type { EventRole } from "@absensi/shared";

import type { Env } from "../env";
import { findActiveMembership } from "../db/users";
import { findEventName } from "../db/events";
import { findSessionByTokenHash, touchSession } from "../db/sessions";
import { hmacSha256 } from "../domain/token";
import type { Action } from "../domain/permissions";
import { isAllowed } from "../domain/permissions";
import { forbidden, notFound, unauthenticated } from "./errors";
import { SESSION_COOKIE, readCookie } from "./cookies";

/**
 * Session → user resolution. Runs before every non-public handler.
 *
 * A session is rejected when it is missing, unknown, revoked, expired, or
 * belongs to a suspended user. The cookie is a bearer token: it is hashed with
 * the pepper and looked up by hash, so a forged value simply finds nothing.
 */

/** `last_seen_at` is refreshed at most every 5 minutes to avoid a write per read. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface AuthContext {
  user: {
    id: string;
    display_name: string;
    role: "superadmin" | "event_admin" | "officer";
    status: "active" | "suspended";
  };
  sessionId: string;
}

export async function authenticate(
  request: Request,
  env: Env,
  now: number,
): Promise<AuthContext | null> {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;

  const tokenHash = await hmacSha256(env.SESSION_PEPPER, token);
  const row = await findSessionByTokenHash(env.DB, tokenHash);

  if (!row) return null;
  if (row.revoked_at !== null) return null;
  if (row.expires_at <= now) return null;
  if (row.status !== "active") return null;

  await touchSession(env.DB, row.session_id, now, TOUCH_INTERVAL_MS);

  return {
    user: {
      id: row.user_id,
      display_name: row.display_name,
      role: row.role,
      status: row.status,
    },
    sessionId: row.session_id,
  };
}

export async function requireAuth(
  request: Request,
  env: Env,
  now: number,
): Promise<AuthContext> {
  const auth = await authenticate(request, env, now);
  if (!auth) throw unauthenticated();
  return auth;
}

/** Structural helper so handlers do not sprinkle non-null assertions. */
export function authOf(context: { auth: AuthContext | null }): AuthContext {
  if (!context.auth) throw unauthenticated();
  return context.auth;
}

export interface EventAccess {
  eventName: string;
  membershipRole: EventRole | null;
}

/**
 * Event-scoped authorization (AGENTS.md: "Tidak ada pemindaian lintas acara";
 * RENCANA_PENGUJIAN.md §5.2 IDOR).
 *
 * The order of checks is deliberate:
 *   1. the event must exist;
 *   2. a non-superadmin with no membership gets **404**, not 403, so the API
 *      does not confirm that someone else's event id exists;
 *   3. a member with too low a role gets 403, which is honest and actionable.
 */
export async function requireEventAccess(
  env: Env,
  auth: AuthContext,
  eventId: string,
  action: Action,
): Promise<EventAccess> {
  const eventName = await findEventName(env.DB, eventId);
  if (eventName === null) throw notFound("Acara tidak ditemukan");

  const membershipRole = await findActiveMembership(env.DB, eventId, auth.user.id);

  if (isAllowed({ role: auth.user.role, action, membershipRole })) {
    return { eventName, membershipRole };
  }

  if (auth.user.role !== "superadmin" && membershipRole === null) {
    throw notFound("Acara tidak ditemukan");
  }

  throw forbidden("Anda tidak berwenang untuk tindakan ini pada acara tersebut");
}
