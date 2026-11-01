import { z } from "zod";

import type {
  EventDetailPayload,
  EventListPayload,
  EventSummary,
  EventSummaryPayload,
  InviteCreatedPayload,
  InviteListPayload,
  MemberListPayload,
} from "@absensi/shared";
import {
  EventCreateRequestSchema,
  EventIdSchema,
  EventStatusRequestSchema,
  EventUpdateRequestSchema,
  InviteCreateRequestSchema,
  InviteIdSchema,
  UserIdSchema,
} from "@absensi/shared";

import type { EventRow } from "../db/events";
import {
  countParticipantsByStatus,
  deleteEmptyDraft,
  findAccessibleEvent,
  insertEventStatement,
  listAccessibleEvents,
  updateEvent,
  updateEventStatus,
} from "../db/events";
import { listMembers, revokeMembership } from "../db/users";
import {
  countActiveInvites,
  deletePendingInvite,
  insertInviteStatement,
  listInvites,
} from "../db/invites";
import { revokeAllCredentialsStatement, revokeAllSessionsStatement } from "../db/sessions";
import { canTransition } from "../domain/event-status";
import { newId } from "../domain/ids";
import { eventSlug } from "../domain/slug";
import { hmacSha256, randomToken } from "../domain/token";
import { authOf, requireEventAccess, requireGlobalAction } from "../http/auth";
import { businessRule, notFound, validationError } from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { parseJsonBody, parsePathParams } from "../http/validate";

/**
 * Event management (DESAIN_API.md §3) and membership/invites (§4).
 *
 * Every event-scoped handler resolves access through `requireEventAccess`, so a
 * route cannot accidentally rely on a UI guard. Mutations also check lifecycle
 * state on the server: an archived event is read-only for everyone.
 */

/** DESAIN_API.md §4: 50 active invites per event, to bound abuse on the free tier. */
const MAX_ACTIVE_INVITES = 50;

const EventParamsSchema = z.object({ eventId: EventIdSchema });
const MemberParamsSchema = z.object({ eventId: EventIdSchema, userId: UserIdSchema });
const InviteParamsSchema = z.object({
  eventId: EventIdSchema,
  inviteId: InviteIdSchema,
});

function toEventSummary(
  row: EventRow & { participant_count: number },
  accessRole: EventSummary["accessRole"],
): EventSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    timezone: row.timezone,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    allowManual: row.allow_manual === 1,
    createdAt: row.created_at,
    accessRole,
    participantCount: row.participant_count,
  };
}

async function listEvents(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const rows = await listAccessibleEvents(ctx.env.DB, {
    userId: auth.user.id,
    role: auth.user.role,
  });

  const payload: EventListPayload = {
    events: rows.map((row) => toEventSummary(row, row.access_role)),
  };

  return { data: payload };
}

async function createEvent(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  requireGlobalAction(auth, "event:create");

  const body = await parseJsonBody(ctx.request, EventCreateRequestSchema);
  const id = newId(ctx.now);

  await insertEventStatement(ctx.env.DB, {
    id,
    slug: eventSlug(body.name, id),
    name: body.name,
    description: body.description ?? null,
    timezone: body.timezone,
    startsAt: body.startsAt ?? null,
    endsAt: body.endsAt ?? null,
    allowManual: body.allowManual,
    createdAt: ctx.now,
    createdBy: auth.user.id,
  }).run();

  const row = await findAccessibleEvent(ctx.env.DB, id);
  if (!row) throw notFound("Acara tidak ditemukan setelah dibuat");

  const payload: EventDetailPayload = { event: toEventSummary(row, "superadmin") };
  return { status: 201, data: payload };
}

async function getEvent(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  const access = await requireEventAccess(ctx.env, auth, eventId, "event:read");
  const row = await findAccessibleEvent(ctx.env.DB, eventId);
  if (!row) throw notFound("Acara tidak ditemukan");

  const payload: EventDetailPayload = {
    event: toEventSummary(row, access.membershipRole ?? "superadmin"),
  };
  return { data: payload };
}

async function patchEvent(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  const access = await requireEventAccess(ctx.env, auth, eventId, "event:update");
  const existing = await findAccessibleEvent(ctx.env.DB, eventId);
  if (!existing) throw notFound("Acara tidak ditemukan");
  if (existing.status === "archived") {
    throw businessRule("Acara yang sudah diarsipkan tidak dapat diubah");
  }

  const body = await parseJsonBody(ctx.request, EventUpdateRequestSchema);
  const startsAt = body.startsAt === undefined ? existing.starts_at : body.startsAt;
  const endsAt = body.endsAt === undefined ? existing.ends_at : body.endsAt;

  if (startsAt !== null && endsAt !== null && endsAt < startsAt) {
    throw validationError("Waktu selesai tidak boleh sebelum waktu mulai", {
      fieldErrors: { endsAt: ["Waktu selesai tidak boleh sebelum waktu mulai"] },
    });
  }

  await updateEvent(ctx.env.DB, eventId, body);
  const row = await findAccessibleEvent(ctx.env.DB, eventId);
  if (!row) throw notFound("Acara tidak ditemukan");

  const payload: EventDetailPayload = {
    event: toEventSummary(row, access.membershipRole ?? "superadmin"),
  };
  return { data: payload };
}

async function changeEventStatus(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  const access = await requireEventAccess(ctx.env, auth, eventId, "event:update");
  const body = await parseJsonBody(ctx.request, EventStatusRequestSchema);
  const existing = await findAccessibleEvent(ctx.env.DB, eventId);
  if (!existing) throw notFound("Acara tidak ditemukan");

  if (!canTransition(existing.status, body.status)) {
    throw businessRule(
      existing.status === "archived"
        ? "Acara yang sudah diarsipkan bersifat final"
        : `Status tidak dapat berubah dari ${existing.status} ke ${body.status}`,
    );
  }

  await updateEventStatus(ctx.env.DB, eventId, body.status, ctx.now);
  const row = await findAccessibleEvent(ctx.env.DB, eventId);
  if (!row) throw notFound("Acara tidak ditemukan");

  const payload: EventDetailPayload = {
    event: toEventSummary(row, access.membershipRole ?? "superadmin"),
  };
  return { data: payload };
}

async function deleteEvent(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  requireGlobalAction(auth, "event:delete");
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  const existing = await findAccessibleEvent(ctx.env.DB, eventId);
  if (!existing) throw notFound("Acara tidak ditemukan");

  const changes = await deleteEmptyDraft(ctx.env.DB, eventId);
  if (changes === 0) {
    throw businessRule(
      "Hanya acara berstatus draft tanpa peserta yang dapat dihapus. Arsipkan acara lain.",
    );
  }

  return { data: { deleted: true } };
}

async function eventSummary(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "event:read");
  const counts = await countParticipantsByStatus(ctx.env.DB, eventId);

  const payload: EventSummaryPayload = {
    participantCount: counts.total,
    activeParticipantCount: counts.active,
    inactiveParticipantCount: counts.inactive,
  };
  return { data: payload };
}

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
  { method: "GET", pattern: "/api/events", public: false, handler: listEvents },
  { method: "POST", pattern: "/api/events", public: false, handler: createEvent },
  { method: "GET", pattern: "/api/events/:eventId", public: false, handler: getEvent },
  { method: "PATCH", pattern: "/api/events/:eventId", public: false, handler: patchEvent },
  { method: "DELETE", pattern: "/api/events/:eventId", public: false, handler: deleteEvent },
  {
    method: "POST",
    pattern: "/api/events/:eventId/status",
    public: false,
    handler: changeEventStatus,
  },
  {
    method: "GET",
    pattern: "/api/events/:eventId/summary",
    public: false,
    handler: eventSummary,
  },
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
