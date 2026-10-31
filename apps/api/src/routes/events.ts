import { z } from "zod";

import type {
  InviteCreatedPayload,
  InviteListPayload,
  MemberListPayload,
} from "@absensi/shared";
import { EventIdSchema, InviteCreateRequestSchema, InviteIdSchema, UserIdSchema } from "@absensi/shared";

import { listMembers, revokeMembership } from "../db/users";
import {
  countActiveInvites,
  deletePendingInvite,
  insertInviteStatement,
  listInvites,
} from "../db/invites";
import { revokeAllCredentialsStatement, revokeAllSessionsStatement } from "../db/sessions";
import { newId } from "../domain/ids";
import { hmacSha256, randomToken } from "../domain/token";
import { authOf } from "../http/auth";
import { requireEventAccess } from "../http/auth";
import { businessRule, notFound } from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { parseJsonBody, parsePathParams } from "../http/validate";

/**
 * Event membership and invite management (DESAIN_API.md §4).
 *
 * Event CRUD is deliberately absent: Fase 1 in IMPLEMENTATION_PLAN.md stops at
 * identity, sessions, and per-event authorization. This file exists because
 * cross-event authorization and the invite mechanism cannot be proven without
 * a real event-scoped resource.
 */

/** DESAIN_API.md §4: 50 active invites per event, to bound abuse on the free tier. */
const MAX_ACTIVE_INVITES = 50;

const EventParamsSchema = z.object({ eventId: EventIdSchema });
const MemberParamsSchema = z.object({ eventId: EventIdSchema, userId: UserIdSchema });
const InviteParamsSchema = z.object({
  eventId: EventIdSchema,
  inviteId: InviteIdSchema,
});

async function listEventMembers(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "invite:manage");
  const rows = await listMembers(ctx.env.DB, eventId);

  const payload: MemberListPayload = {
    members: rows.map((row) => ({
      userId: row.user_id,
      displayName: row.display_name,
      role: row.role,
      createdAt: row.created_at,
    })),
  };

  return { data: payload };
}

async function revokeMember(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, userId } = parsePathParams(ctx.params, MemberParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "invite:manage");

  if (userId === auth.user.id) {
    throw businessRule("Anda tidak dapat mencabut akses Anda sendiri");
  }

  const changes = await revokeMembership(ctx.env.DB, eventId, userId, ctx.now);
  if (changes === 0) throw notFound("Anggota tidak ditemukan pada acara ini");

  // A revoked member must not keep a usable session (DESAIN_API.md §4). This is
  // global by design: sessions are per user, not per event, so the officer is
  // logged out everywhere and must be re-invited.
  await ctx.env.DB.batch([
    revokeAllSessionsStatement(ctx.env.DB, userId, ctx.now),
    revokeAllCredentialsStatement(ctx.env.DB, userId, ctx.now),
  ]);

  return { data: { revoked: true } };
}

async function createInvite(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "invite:manage");
  const body = await parseJsonBody(ctx.request, InviteCreateRequestSchema);

  const active = await countActiveInvites(ctx.env.DB, eventId, ctx.now);
  if (active >= MAX_ACTIVE_INVITES) {
    throw businessRule("Batas 50 undangan aktif per acara sudah tercapai");
  }

  // 16 bytes = 128 bits (ADR-002). Only the HMAC is persisted.
  const token = randomToken(16);
  const tokenHash = await hmacSha256(ctx.env.SESSION_PEPPER, token);
  const inviteId = newId(ctx.now);
  const expiresAt = ctx.now + body.expiresInHours * 60 * 60 * 1000;

  await insertInviteStatement(ctx.env.DB, {
    id: inviteId,
    eventId,
    role: body.role,
    tokenHash,
    invitedName: body.invitedName ?? null,
    invitedPhone: body.invitedPhone ?? null,
    createdBy: auth.user.id,
    createdAt: ctx.now,
    expiresAt,
  }).run();

  const payload: InviteCreatedPayload = {
    inviteId,
    token,
    // Fragment, not query: `#` is never sent to the server, so the token stays
    // out of access logs and Referer headers.
    activatePath: `/aktivasi#t=${token}`,
    expiresAt,
  };

  return { status: 201, data: payload };
}

async function listEventInvites(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "invite:manage");
  const rows = await listInvites(ctx.env.DB, eventId);

  const payload: InviteListPayload = {
    invites: rows.map((row) => ({
      id: row.id,
      role: row.role,
      invitedName: row.invited_name,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      status:
        row.used_at !== null ? "used" : row.expires_at <= ctx.now ? "expired" : "pending",
    })),
  };

  return { data: payload };
}

async function deleteInvite(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, inviteId } = parsePathParams(ctx.params, InviteParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "invite:manage");

  const changes = await deletePendingInvite(ctx.env.DB, eventId, inviteId);
  if (changes === 0) throw notFound("Undangan tidak ditemukan atau sudah dipakai");

  return { data: { deleted: true } };
}

export const eventRoutes: readonly RouteDefinition[] = [
  { method: "GET", pattern: "/api/events/:eventId/members", public: false, handler: listEventMembers },
  {
    method: "POST",
    pattern: "/api/events/:eventId/members/:userId/revoke",
    public: false,
    handler: revokeMember,
  },
  { method: "POST", pattern: "/api/events/:eventId/invites", public: false, handler: createInvite },
  { method: "GET", pattern: "/api/events/:eventId/invites", public: false, handler: listEventInvites },
  {
    method: "DELETE",
    pattern: "/api/events/:eventId/invites/:inviteId",
    public: false,
    handler: deleteInvite,
  },
];
