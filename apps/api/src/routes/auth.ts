import { z } from "zod";

import type {
  ActivatePayload,
  MePayload,
  RecoveryCodePayload,
  SessionListPayload,
  UserSummary,
} from "@absensi/shared";
import {
  ActivateRequestSchema,
  RecoverRequestSchema,
  SessionIdSchema,
} from "@absensi/shared";

import type { MembershipRow, UserRow } from "../db/users";
import {
  listActiveMemberships,
  updateUserRoleStatement,
  upsertMembershipStatement,
} from "../db/users";
import {
  insertCredentialStatement,
  insertSessionStatement,
  listSessions,
  revokeAllCredentialsStatement,
  revokeAllSessionsStatement,
  revokeSession,
} from "../db/sessions";
import {
  claimInvite,
  findInviteByHash,
  releaseInviteClaim,
  setInviteUsedByStatement,
} from "../db/invites";
import {
  claimRecoveryCode,
  findUnusedRecoveryCode,
  insertRecoveryCodeStatement,
  releaseRecoveryCodeClaim,
  useAllRecoveryCodesStatement,
} from "../db/recovery";
import { consumeRateLimit } from "../db/rate-limit";
import { newId } from "../domain/ids";
import {
  hmacSha256,
  normalizeRecoveryCode,
  randomRecoveryCode,
  randomToken,
} from "../domain/token";
import { authOf } from "../http/auth";
import {
  clearSessionCookie,
  isSecureRequest,
  sessionCookie,
  SESSION_TTL_SECONDS,
} from "../http/cookies";
import { notFound, rateLimited, unauthenticated } from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { clientIpHash } from "../http/security";
import { parseJsonBody, parsePathParams } from "../http/validate";

/**
 * Auth surface (DESAIN_API.md §2).
 *
 * Passwordless by design (ADR-002): the only credentials are single-use
 * invite/recovery tokens. No plaintext token is stored — only its HMAC — and
 * the recovery code is the single secret ever returned to a client.
 */

const ACTIVATE_LIMIT = { windowMs: 15 * 60_000, limit: 10 };
const RECOVER_LIMIT = { windowMs: 15 * 60_000, limit: 5 };

const SessionParamsSchema = z.object({ sessionId: SessionIdSchema });

/** Identical message for unknown, expired, and already-used tokens. */
function invalidInvite(): Error {
  return unauthenticated("Token undangan tidak valid atau sudah kedaluwarsa");
}

function invalidRecovery(): Error {
  return unauthenticated("Kode pemulihan tidak valid atau sudah dipakai");
}

function toUserSummary(user: {
  id: string;
  display_name: string;
  role: UserSummary["role"];
}): UserSummary {
  return { id: user.id, displayName: user.display_name, role: user.role };
}

function toMemberships(rows: MembershipRow[]) {
  return rows.map((row) => ({
    eventId: row.event_id,
    eventName: row.event_name,
    role: row.role,
  }));
}

interface IssuedSession {
  statements: D1PreparedStatement[];
  sessionToken: string;
  sessionId: string;
  recoveryCode: string;
}

/**
 * Builds the statements for a new session, device credential, and recovery
 * code. Returned instead of executed so the caller can put them in the same
 * `db.batch()` as the user/membership writes (one atomic transaction).
 */
async function issueSessionStatements(
  ctx: RouteContext,
  userId: string,
  label: string | null,
): Promise<IssuedSession> {
  const pepper = ctx.env.SESSION_PEPPER;
  const sessionToken = randomToken(32);
  const recoveryCode = randomRecoveryCode();
  const credentialId = newId(ctx.now);
  const sessionId = newId(ctx.now);

  const [tokenHash, codeHash] = await Promise.all([
    hmacSha256(pepper, sessionToken),
    hmacSha256(pepper, normalizeRecoveryCode(recoveryCode)),
  ]);

  const statements = [
    insertCredentialStatement(ctx.env.DB, {
      id: credentialId,
      userId,
      tokenHash,
      label,
      createdAt: ctx.now,
    }),
    insertSessionStatement(ctx.env.DB, {
      id: sessionId,
      tokenHash,
      userId,
      credentialId,
      createdAt: ctx.now,
      expiresAt: ctx.now + SESSION_TTL_SECONDS * 1000,
    }),
    // Order matters: invalidate older codes *before* inserting the new one.
    useAllRecoveryCodesStatement(ctx.env.DB, userId, ctx.now),
    insertRecoveryCodeStatement(ctx.env.DB, {
      id: newId(ctx.now),
      userId,
      codeHash,
      createdAt: ctx.now,
    }),
  ];

  return { statements, sessionToken, sessionId, recoveryCode };
}

async function activate(ctx: RouteContext): Promise<RouteResult> {
  const ipHash = await clientIpHash(ctx.request, ctx.env.SESSION_PEPPER);
  const limit = await consumeRateLimit(ctx.env.DB, {
    bucket: `auth:activate:${ipHash}`,
    now: ctx.now,
    ...ACTIVATE_LIMIT,
  });
  if (!limit.allowed) throw rateLimited(limit.retryAfterSeconds);

  const body = await parseJsonBody(ctx.request, ActivateRequestSchema);
  const tokenHash = await hmacSha256(ctx.env.SESSION_PEPPER, body.token);

  const invite = await findInviteByHash(ctx.env.DB, tokenHash);
  if (!invite || invite.used_at !== null || invite.expires_at <= ctx.now) {
    throw invalidInvite();
  }

  const userId = invite.target_user_id ?? newId(ctx.now);

  if (invite.target_user_id) {
    const existing = await ctx.env.DB.prepare(
      "SELECT id FROM users WHERE id = ? AND status = 'active'",
    )
      .bind(invite.target_user_id)
      .first<{ id: string }>();
    if (!existing) throw invalidInvite();
  }

  // Claim before writing anything. `used_at IS NULL` is the mutex that makes
  // replay impossible; losing the race returns 401 and writes nothing.
  const claimed = await claimInvite(ctx.env.DB, invite.id, ctx.now);
  if (claimed === 0) throw invalidInvite();

  const issued = await issueSessionStatements(ctx, userId, body.label ?? null);

  const writes: D1PreparedStatement[] = [];

  if (!invite.target_user_id) {
    writes.push(
      ctx.env.DB.prepare(
        `INSERT INTO users (id, display_name, role, status, created_at)
         VALUES (?, ?, ?, 'active', ?)`,
      ).bind(
        userId,
        invite.invited_name ?? (invite.role === "superadmin" ? "Superadmin" : "Petugas"),
        invite.role,
        ctx.now,
      ),
    );
  } else if (invite.role === "superadmin") {
    writes.push(updateUserRoleStatement(ctx.env.DB, userId, "superadmin"));
  }

  if (invite.event_id) {
    writes.push(
      upsertMembershipStatement(ctx.env.DB, {
        id: newId(ctx.now),
        eventId: invite.event_id,
        userId,
        // A superadmin invite is issued by an event, but the global role is
        // what grants access; the membership just records the origin.
        role: invite.role === "superadmin" ? "event_admin" : invite.role,
        createdAt: ctx.now,
      }),
    );
  }

  try {
    await ctx.env.DB.batch([
      ...writes,
      setInviteUsedByStatement(ctx.env.DB, invite.id, userId),
      ...issued.statements,
    ]);
  } catch (error) {
    // The claim is committed before this batch and D1 cannot span both in one
    // transaction. A failed batch rolls back `used_by`, so releasing here only
    // affects an invite that never produced an account.
    await releaseInviteClaim(ctx.env.DB, invite.id).catch(() => {
      console.error("invite_claim_release_failed", { inviteId: invite.id });
    });
    throw error;
  }

  const user = await ctx.env.DB.prepare(
    "SELECT id, display_name, role, status FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<UserRow>();

  if (!user) throw unauthenticated("Akun tidak ditemukan");

  const memberships = await listActiveMemberships(ctx.env.DB, userId);
  const payload: ActivatePayload = {
    user: toUserSummary(user),
    memberships: toMemberships(memberships),
    recoveryCode: issued.recoveryCode,
  };

  return { data: payload, headers: sessionHeaders(ctx, issued.sessionToken) };
}

async function recover(ctx: RouteContext): Promise<RouteResult> {
  const ipHash = await clientIpHash(ctx.request, ctx.env.SESSION_PEPPER);
  const limit = await consumeRateLimit(ctx.env.DB, {
    bucket: `auth:recover:${ipHash}`,
    now: ctx.now,
    ...RECOVER_LIMIT,
  });
  if (!limit.allowed) throw rateLimited(limit.retryAfterSeconds);

  const body = await parseJsonBody(ctx.request, RecoverRequestSchema);
  const codeHash = await hmacSha256(
    ctx.env.SESSION_PEPPER,
    normalizeRecoveryCode(body.recoveryCode),
  );

  const code = await findUnusedRecoveryCode(ctx.env.DB, codeHash);
  if (!code) throw invalidRecovery();

  // Validate the account before claiming: a suspended or deleted user must not
  // burn the last recovery code.
  const user = await ctx.env.DB.prepare(
    "SELECT id, display_name, role, status FROM users WHERE id = ? AND status = 'active'",
  )
    .bind(code.user_id)
    .first<UserRow>();
  if (!user) throw invalidRecovery();

  const claimed = await claimRecoveryCode(ctx.env.DB, code.id, ctx.now);
  if (claimed === 0) throw invalidRecovery();

  // Recovery assumes the old device is gone: revoke every session and
  // credential first, then issue exactly one new one.
  const issued = await issueSessionStatements(ctx, user.id, body.label ?? null);

  try {
    await ctx.env.DB.batch([
      revokeAllSessionsStatement(ctx.env.DB, user.id, ctx.now),
      revokeAllCredentialsStatement(ctx.env.DB, user.id, ctx.now),
      ...issued.statements,
    ]);
  } catch (error) {
    // Same compensation as activation. The guard inside the release statement
    // refuses to free a code whose session was actually committed.
    await releaseRecoveryCodeClaim(ctx.env.DB, code.id, issued.sessionId).catch(() => {
      console.error("recovery_claim_release_failed", { recoveryCodeId: code.id });
    });
    throw error;
  }

  const memberships = await listActiveMemberships(ctx.env.DB, user.id);
  const payload: ActivatePayload = {
    user: toUserSummary(user),
    memberships: toMemberships(memberships),
    recoveryCode: issued.recoveryCode,
  };

  return { data: payload, headers: sessionHeaders(ctx, issued.sessionToken) };
}

function sessionHeaders(ctx: RouteContext, token: string): Record<string, string> {
  return { "set-cookie": sessionCookie(token, { secure: isSecureRequest(ctx.request) }) };
}

async function me(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const memberships = await listActiveMemberships(ctx.env.DB, auth.user.id);

  const payload: MePayload = {
    user: toUserSummary(auth.user),
    memberships: toMemberships(memberships),
  };

  return { data: payload };
}

async function logout(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);

  await revokeSession(ctx.env.DB, auth.sessionId, auth.user.id, ctx.now);

  return {
    data: { revoked: true },
    headers: { "set-cookie": clearSessionCookie({ secure: isSecureRequest(ctx.request) }) },
  };
}

async function listDeviceSessions(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const rows = await listSessions(ctx.env.DB, auth.user.id, ctx.now);

  const payload: SessionListPayload = {
    sessions: rows.map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      current: row.id === auth.sessionId,
    })),
  };

  return { data: payload };
}

async function revokeDeviceSession(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { sessionId } = parsePathParams(ctx.params, SessionParamsSchema);

  // Scoped by `user_id`, so someone else's session id resolves to 404 instead
  // of becoming an IDOR.
  const changes = await revokeSession(ctx.env.DB, sessionId, auth.user.id, ctx.now);
  if (changes === 0) throw notFound("Sesi tidak ditemukan");

  return { data: { revoked: true } };
}

async function rotateRecoveryCode(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const recoveryCode = randomRecoveryCode();
  const codeHash = await hmacSha256(
    ctx.env.SESSION_PEPPER,
    normalizeRecoveryCode(recoveryCode),
  );

  await ctx.env.DB.batch([
    useAllRecoveryCodesStatement(ctx.env.DB, auth.user.id, ctx.now),
    insertRecoveryCodeStatement(ctx.env.DB, {
      id: newId(ctx.now),
      userId: auth.user.id,
      codeHash,
      createdAt: ctx.now,
    }),
  ]);

  const payload: RecoveryCodePayload = { recoveryCode };
  return { data: payload };
}

export const authRoutes: readonly RouteDefinition[] = [
  { method: "POST", pattern: "/api/auth/activate", public: true, handler: activate },
  { method: "POST", pattern: "/api/auth/recover", public: true, handler: recover },
  { method: "GET", pattern: "/api/auth/me", public: false, handler: me },
  { method: "POST", pattern: "/api/auth/logout", public: false, handler: logout },
  { method: "GET", pattern: "/api/auth/sessions", public: false, handler: listDeviceSessions },
  {
    method: "POST",
    pattern: "/api/auth/sessions/:sessionId/revoke",
    public: false,
    handler: revokeDeviceSession,
  },
  {
    method: "POST",
    pattern: "/api/auth/recovery-code",
    public: false,
    handler: rotateRecoveryCode,
  },
];
