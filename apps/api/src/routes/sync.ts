import { z } from "zod";

import type {
  OutboxItem,
  OutboxListPayload,
  OutboxRetryPayload,
  SyncConfig,
  SyncConfigPayload,
  SyncFullPayload,
  SyncStatusPayload,
  SyncTestPayload,
} from "@absensi/shared";
import {
  EventIdSchema,
  OutboxListQuerySchema,
  SyncConfigRequestSchema,
  SyncRunRequestSchema,
} from "@absensi/shared";

import { countParticipantsByStatus } from "../db/events";
import {
  countOutbox,
  enqueueEventParticipantsStatement,
  findOutboxById,
  listOutbox,
  retryOutboxStatement,
} from "../db/outbox";
import type { OutboxJoinedRow } from "../db/outbox";
import { consumeRateLimit } from "../db/rate-limit";
import {
  findSyncState,
  setFullSyncStatement,
  upsertSyncStateStatement,
} from "../db/sync";
import type { SyncStateRow } from "../db/sync";
import { describeSyncFailure } from "../domain/outbox-policy";
import {
  GoogleApiError,
  GoogleSheetsGateway,
  SheetsConfigError,
  serviceAccountEmail,
} from "../domain/sheets";
import type { SheetsGateway } from "../domain/sheets";
import { authOf, requireEventAccess } from "../http/auth";
import { ApiError, businessRule, notFound, rateLimited } from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { parseJsonBody, parsePathParams, parseQuery } from "../http/validate";
import { processOutbox } from "../services/outbox";

/**
 * Google Sheets sync administration (DESAIN_API.md §8).
 *
 * D1 is authoritative. These endpoints only configure and observe the
 * projection; attendance succeeds without them. Credentials stay in Worker
 * secrets and the response exposes only the service account email.
 */

const EventParamsSchema = z.object({ eventId: EventIdSchema });
const OutboxParamsSchema = z.object({
  eventId: EventIdSchema,
  outboxId: z.string().min(1).max(64),
});

/**
 * A manual run performs Google API calls and ~2 D1 queries per item, so it is
 * the most expensive endpoint in the app. One run per event per minute matches
 * DESAIN_API.md §10; cron handles the backlog in between.
 */
const SYNC_RUN_LIMIT = { windowMs: 60_000, limit: 1 };

function configPayload(env: ContextEnv, state: SyncStateRow | null): SyncConfig {
  return {
    eventId: state?.event_id ?? "",
    configured: state !== null,
    spreadsheetId: state?.spreadsheet_id ?? null,
    sheetTab: state?.sheet_tab ?? null,
    syncEnabled: state?.sync_enabled === 1,
    schemaVersion: state?.schema_version ?? 1,
    lastFullSyncAt: state?.last_full_sync_at ?? null,
    lastError: state?.last_error ?? null,
    updatedAt: state?.updated_at ?? null,
    serviceAccountEmail: serviceAccountEmail(env),
  };
}

type ContextEnv = RouteContext["env"];

function toItem(row: OutboxJoinedRow): OutboxItem {
  return {
    id: row.id,
    participantId: row.participant_id,
    participantName: row.participant_name,
    kind: row.kind,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

function syncFailure(error: unknown): never {
  if (error instanceof SheetsConfigError) {
    throw new ApiError(
      422,
      "BUSINESS_RULE",
      "Kredensial Google Sheets belum diatur di server. Hubungi superadmin.",
    );
  }

  if (error instanceof GoogleApiError) {
    throw new ApiError(422, "BUSINESS_RULE", describeSyncFailure(error));
  }

  throw error;
}

function gateway(ctx: RouteContext): SheetsGateway {
  return new GoogleSheetsGateway(ctx.env, fetch, () => ctx.now);
}

async function getSync(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "sync:configure");

  const state = await findSyncState(ctx.env.DB, eventId);
  const counts = await countOutbox(ctx.env.DB, eventId);
  const items = await listOutbox(ctx.env.DB, eventId, "all", 10);

  const payload: SyncStatusPayload = {
    config: { ...configPayload(ctx.env, state), eventId },
    counts,
    items: items.map(toItem),
  };

  return { data: payload };
}

async function putSync(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "sync:configure");
  const body = await parseJsonBody(ctx.request, SyncConfigRequestSchema);

  await upsertSyncStateStatement(ctx.env.DB, {
    eventId,
    spreadsheetId: body.spreadsheetId,
    sheetTab: body.sheetTab,
    syncEnabled: body.syncEnabled,
    now: ctx.now,
  }).run();

  const state = await findSyncState(ctx.env.DB, eventId);
  const payload: SyncConfigPayload = {
    config: { ...configPayload(ctx.env, state), eventId },
  };

  return { data: payload };
}

async function testSync(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "sync:configure");

  const state = await findSyncState(ctx.env.DB, eventId);
  if (!state) throw businessRule("Konfigurasi sinkronisasi belum diisi");

  let title: string;
  try {
    const result = await gateway(ctx).test(
      { spreadsheetId: state.spreadsheet_id, sheetTab: state.sheet_tab },
      `absensi:sync-test:${eventId}:${ctx.now}`,
    );
    title = result.spreadsheetTitle;
  } catch (error) {
    syncFailure(error);
  }

  const payload: SyncTestPayload = {
    ok: true,
    spreadsheetTitle: title,
    sheetTab: state.sheet_tab,
    serviceAccountEmail: serviceAccountEmail(ctx.env) ?? "",
  };

  return { data: payload };
}

async function runSync(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "sync:configure");
  const budget = await consumeRateLimit(ctx.env.DB, {
    bucket: `sync:run:${eventId}`,
    now: ctx.now,
    ...SYNC_RUN_LIMIT,
  });
  if (!budget.allowed) throw rateLimited(budget.retryAfterSeconds);

  const body = await parseJsonBody(ctx.request, SyncRunRequestSchema);

  const state = await findSyncState(ctx.env.DB, eventId);
  if (!state) throw businessRule("Konfigurasi sinkronisasi belum diisi");

  const result = await processOutbox(ctx.env, {
    now: ctx.now,
    limit: body.limit,
    eventId,
    gateway: gateway(ctx),
  });

  return { data: result };
}

async function fullSync(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "sync:configure");

  const state = await findSyncState(ctx.env.DB, eventId);
  if (!state) throw businessRule("Konfigurasi sinkronisasi belum diisi");

  const participants = await countParticipantsByStatus(ctx.env.DB, eventId);

  await ctx.env.DB.batch([
    enqueueEventParticipantsStatement(ctx.env.DB, { eventId, now: ctx.now }),
    setFullSyncStatement(ctx.env.DB, { eventId, now: ctx.now }),
  ]);

  const payload: SyncFullPayload = { enqueued: participants.total };
  return { data: payload };
}

async function listEventOutbox(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "sync:configure");
  const query = parseQuery(ctx.request, OutboxListQuerySchema);

  const rows = await listOutbox(ctx.env.DB, eventId, query.status, query.limit);
  const payload: OutboxListPayload = { items: rows.map(toItem) };
  return { data: payload };
}

async function retryOutboxItem(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, outboxId } = parsePathParams(ctx.params, OutboxParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "sync:configure");

  const result = await retryOutboxStatement(ctx.env.DB, {
    eventId,
    outboxId,
    now: ctx.now,
  }).run();

  if ((result.meta.changes ?? 0) === 0) {
    throw notFound("Item antrean tidak ditemukan atau tidak bisa diulang");
  }

  const row = await findOutboxById(ctx.env.DB, eventId, outboxId);
  if (!row) throw notFound("Item antrean tidak ditemukan");

  const payload: OutboxRetryPayload = { item: toItem(row) };
  return { data: payload };
}

export const syncRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    pattern: "/api/events/:eventId/sync",
    public: false,
    handler: getSync,
  },
  {
    method: "PUT",
    pattern: "/api/events/:eventId/sync",
    public: false,
    handler: putSync,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/sync/test",
    public: false,
    handler: testSync,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/sync/run",
    public: false,
    handler: runSync,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/sync/full",
    public: false,
    handler: fullSync,
  },
  {
    method: "GET",
    pattern: "/api/events/:eventId/sync/outbox",
    public: false,
    handler: listEventOutbox,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/sync/outbox/:outboxId/retry",
    public: false,
    handler: retryOutboxItem,
  },
];
