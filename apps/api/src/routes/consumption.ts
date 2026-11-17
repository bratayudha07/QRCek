import type {
  ConsumptionCategoryQuotaRulesPayload,
  ConsumptionParticipantQuotaRulesPayload,
  ConsumptionQuotaDefaultPayload,
  ConsumptionQuotaPayload,
  TransactionDetailPayload,
} from "@absensi/shared";
import {
  CONSUMPTION_MESSAGES,
  ConsumptionActivityParamsSchema,
  ConsumptionCategoryQuotaRulesRequestSchema,
  ConsumptionEventParamsSchema,
  ConsumptionManualRequestSchema,
  ConsumptionParticipantQuotaRulesRequestSchema,
  ConsumptionQuotaDefaultRequestSchema,
  filterAuditFields,
  resolveEntitlement,
} from "@absensi/shared";

import { findActivity, updateActivityQuotaStatement } from "../db/activities";
import type { ActivityRow } from "../db/activities";
import type { AuditEntry } from "../db/audit";
import {
  insertAuditAfterActivityUpdateStatement,
  insertAuditAfterConsumptionQuotaDeleteStatement,
  insertAuditAfterConsumptionQuotaUpdateStatement,
  insertAuditAfterTransactionStatement,
  insertAuditStatement,
} from "../db/audit";
import { listCategories } from "../db/categories";
import type { ConsumptionQuotaRow } from "../db/consumption-quotas";
import {
  deleteConsumptionQuotaStatement,
  findCategoryQuotasByIds,
  findParticipantQuotasByIds,
  findQuotaOverrides,
  insertConsumptionQuotaStatement,
  listCategoryQuotas,
  listConsumptionUsage,
  listEffectiveConsumptionSlots,
  listParticipantQuotas,
  updateConsumptionQuotaStatement,
} from "../db/consumption-quotas";
import { listRulesForContext } from "../db/entitlement-rules";
import { findEventById } from "../db/events";
import { findParticipant, listParticipantsByIds } from "../db/participants";
import { findEffectiveAssignment } from "../db/staff-assignments";
import {
  findTransactionById,
  insertTransactionStatement,
} from "../db/transactions";
import {
  consumptionMessage,
  isQuotaExhaustedError,
  nextSlotNo,
  quotaRejection,
  resolveQuota,
} from "../domain/consumption";
import { newId } from "../domain/ids";
import {
  lifecycleRejection,
  scanMessage,
  toTransactionRecord,
  transactionSnapshot,
} from "../domain/transactions";
import { resolveConsumptionContext } from "../services/transaction-context";
import { authOf, requireEventAccess, requireMutableEvent } from "../http/auth";
import {
  ApiError,
  businessRule,
  conflict,
  forbidden,
  notFound,
} from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { clientIpHash } from "../http/security";
import { parseJsonBody, parsePathParams } from "../http/validate";

/**
 * Consumption quota configuration and Manual Entry (DESAIN_API.md §6–§7, Q7).
 *
 * The ceiling is a database trigger (`trg_transaction_consumption_quota`); these
 * routes only translate HTTP into validated writes and read the configuration
 * back. Every mutation writes its audit row in the same `db.batch()` as the
 * change, and every query is scoped by the Tema and the Aktivitas.
 */

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

/**
 * One batch for a quota mutation plus its audit row. A concurrent writer that
 * wins the unique index is a business outcome (409), never a 500.
 */
async function batchQuotaStatements(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<D1Result[]> {
  if (statements.length === 0) return [];

  try {
    return await db.batch(statements);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("Kuota sudah diatur di perangkat lain. Muat ulang lalu coba lagi.");
    }
    throw error;
  }
}

function assertQuotaWritesLanded(
  results: D1Result[],
  indexes: readonly number[],
): void {
  for (const index of indexes) {
    if ((results[index]?.meta.changes ?? 0) === 0) {
      throw conflict("Kuota berubah di perangkat lain. Muat ulang lalu coba lagi.");
    }
  }
}

async function requireConsumptionActivity(
  ctx: RouteContext,
  eventId: string,
  activityId: string,
): Promise<ActivityRow> {
  const activity = await findActivity(ctx.env.DB, eventId, activityId);
  if (!activity) throw notFound("Aktivitas tidak ditemukan");
  if (activity.transaction_type !== "consumption") {
    throw businessRule("Aktivitas ini bukan Aktivitas konsumsi");
  }
  return activity;
}

/** Archiving makes the Aktivitas read-only; `updateActivityQuotaStatement` also guards it. */
function assertWritableActivity(activity: ActivityRow): void {
  if (activity.status === "archived") {
    throw businessRule("Aktivitas yang sudah diarsipkan tidak dapat diubah");
  }
}

/**
 * The trigger guarantees a `consumption` Aktivitas has a quota. Reading `null`
 * means the schema drifted, which is an internal error — not "quota 0", which
 * would silently block every distribution.
 */
function defaultQuotaOf(activity: ActivityRow): number {
  if (activity.quota === null) {
    throw new ApiError(500, "SYSTEM_ERROR", "Kuota Aktivitas konsumsi tidak terbaca");
  }
  return activity.quota;
}

function activityQuotaSnapshot(quota: number | null): Record<string, unknown> | null {
  return filterAuditFields("activity", { quota });
}

function quotaRowSnapshot(row: ConsumptionQuotaRow): Record<string, unknown> | null {
  return filterAuditFields("consumption_quota", {
    themeId: row.theme_id,
    activityId: row.activity_id,
    categoryId: row.category_id,
    participantId: row.participant_id,
    quota: row.quota,
  });
}

function quotaAudit(
  ctx: RouteContext,
  actorUserId: string,
  eventId: string,
  action:
    | "activity.quota_updated"
    | "consumption_quota.created"
    | "consumption_quota.updated"
    | "consumption_quota.deleted",
  entityType: "activity" | "consumption_quota",
  entityId: string,
  snapshots: { before?: unknown; after?: unknown },
): AuditEntry {
  return {
    id: newId(ctx.now),
    eventId,
    actorUserId,
    action,
    entityType,
    entityId,
    before: snapshots.before,
    after: snapshots.after,
    createdAt: ctx.now,
  };
}

// ───────────────────────────────────────────── Quota read

async function getActivityQuota(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, activityId } = parsePathParams(
    ctx.params,
    ConsumptionActivityParamsSchema,
  );

  await requireEventAccess(ctx.env, auth, eventId, "entitlement:read");
  const activity = await requireConsumptionActivity(ctx, eventId, activityId);

  const [categories, participants, usage] = await Promise.all([
    listCategoryQuotas(ctx.env.DB, eventId, activityId),
    listParticipantQuotas(ctx.env.DB, eventId, activityId),
    listConsumptionUsage(ctx.env.DB, eventId, activityId),
  ]);

  const payload: ConsumptionQuotaPayload = {
    activityId,
    defaultQuota: defaultQuotaOf(activity),
    categoryOverrides: categories.map((row) => ({
      categoryId: row.category_id as string,
      quota: row.quota,
    })),
    participantOverrides: participants.map((row) => ({
      participantId: row.participant_id as string,
      quota: row.quota,
    })),
    usage: usage.map((row) => ({ participantId: row.participant_id, used: row.used })),
  };

  return { data: payload };
}

// ───────────────────────────────────────────── Default quota

async function putActivityQuota(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, activityId } = parsePathParams(
    ctx.params,
    ConsumptionActivityParamsSchema,
  );

  await requireMutableEvent(ctx.env, auth, eventId, "entitlement:write");
  const activity = await requireConsumptionActivity(ctx, eventId, activityId);
  assertWritableActivity(activity);

  const body = await parseJsonBody(ctx.request, ConsumptionQuotaDefaultRequestSchema);

  const results = await batchQuotaStatements(ctx.env.DB, [
    updateActivityQuotaStatement(ctx.env.DB, {
      themeId: eventId,
      activityId,
      quota: body.quota,
      actorUserId: auth.user.id,
      now: ctx.now,
      expectedUpdatedAt: activity.updated_at,
    }),
    insertAuditAfterActivityUpdateStatement(
      ctx.env.DB,
      quotaAudit(
        ctx,
        auth.user.id,
        eventId,
        "activity.quota_updated",
        "activity",
        activityId,
        {
          before: activityQuotaSnapshot(activity.quota),
          after: activityQuotaSnapshot(body.quota),
        },
      ),
      activityId,
      ctx.now,
    ),
  ]);

  assertQuotaWritesLanded(results, [0]);

  const payload: ConsumptionQuotaDefaultPayload = { activityId, quota: body.quota };
  return { data: payload };
}

// ───────────────────────────────────────────── Category overrides

async function putCategoryQuotas(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, activityId } = parsePathParams(
    ctx.params,
    ConsumptionActivityParamsSchema,
  );

  await requireMutableEvent(ctx.env, auth, eventId, "entitlement:write");
  const activity = await requireConsumptionActivity(ctx, eventId, activityId);
  assertWritableActivity(activity);

  const body = await parseJsonBody(
    ctx.request,
    ConsumptionCategoryQuotaRulesRequestSchema,
  );

  // One read for the whole batch, rather than one per rule: the statement budget
  // is upsert + audit per rule plus the lookups.
  const categories = await listCategories(ctx.env.DB, eventId, "all");
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  for (const rule of body.rules) {
    const category = categoryById.get(rule.categoryId);
    if (!category) throw notFound("Kategori tidak ditemukan");
    if (category.status === "archived") {
      throw businessRule(
        `Kategori ${category.name} sudah diarsipkan dan tidak dapat dikonfigurasi`,
      );
    }
  }

  const existing = await findCategoryQuotasByIds(
    ctx.env.DB,
    eventId,
    activityId,
    body.rules.map((rule) => rule.categoryId),
  );
  const existingByCategory = new Map(
    existing
      .filter((row) => row.category_id !== null)
      .map((row) => [row.category_id as string, row]),
  );

  const statements: D1PreparedStatement[] = [];
  const guardedIndexes: number[] = [];

  for (const rule of body.rules) {
    const row = existingByCategory.get(rule.categoryId);

    if (rule.quota === null) {
      // Removing an override falls back to the next level; nothing to delete
      // when the cell already inherits.
      if (!row) continue;

      guardedIndexes.push(statements.length);
      statements.push(
        deleteConsumptionQuotaStatement(ctx.env.DB, {
          themeId: eventId,
          quotaId: row.id,
          expectedUpdatedAt: row.updated_at,
        }),
      );
      statements.push(
        insertAuditAfterConsumptionQuotaDeleteStatement(
          ctx.env.DB,
          quotaAudit(
            ctx,
            auth.user.id,
            eventId,
            "consumption_quota.deleted",
            "consumption_quota",
            row.id,
            { before: quotaRowSnapshot(row) },
          ),
          row.id,
        ),
      );
      continue;
    }

    if (row) {
      guardedIndexes.push(statements.length);
      statements.push(
        updateConsumptionQuotaStatement(ctx.env.DB, {
          themeId: eventId,
          quotaId: row.id,
          quota: rule.quota,
          actorUserId: auth.user.id,
          now: ctx.now,
          expectedUpdatedAt: row.updated_at,
        }),
      );
      statements.push(
        insertAuditAfterConsumptionQuotaUpdateStatement(
          ctx.env.DB,
          quotaAudit(
            ctx,
            auth.user.id,
            eventId,
            "consumption_quota.updated",
            "consumption_quota",
            row.id,
            {
              before: quotaRowSnapshot(row),
              after: filterAuditFields("consumption_quota", {
                themeId: eventId,
                activityId,
                categoryId: rule.categoryId,
                participantId: null,
                quota: rule.quota,
              }),
            },
          ),
          row.id,
          ctx.now,
        ),
      );
      continue;
    }

    const id = newId(ctx.now);
    statements.push(
      insertConsumptionQuotaStatement(ctx.env.DB, {
        id,
        themeId: eventId,
        activityId,
        categoryId: rule.categoryId,
        participantId: null,
        quota: rule.quota,
        createdAt: ctx.now,
        createdBy: auth.user.id,
      }),
    );
    statements.push(
      insertAuditStatement(
        ctx.env.DB,
        quotaAudit(
          ctx,
          auth.user.id,
          eventId,
          "consumption_quota.created",
          "consumption_quota",
          id,
          {
            after: filterAuditFields("consumption_quota", {
              themeId: eventId,
              activityId,
              categoryId: rule.categoryId,
              participantId: null,
              quota: rule.quota,
            }),
          },
        ),
      ),
    );
  }

  const results = await batchQuotaStatements(ctx.env.DB, statements);
  assertQuotaWritesLanded(results, guardedIndexes);

  const payload: ConsumptionCategoryQuotaRulesPayload = {
    activityId,
    rules: body.rules.map((rule) => ({
      categoryId: rule.categoryId,
      quota: rule.quota,
    })),
  };
  return { data: payload };
}

// ───────────────────────────────────────────── Participant overrides

async function putParticipantQuotas(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, activityId } = parsePathParams(
    ctx.params,
    ConsumptionActivityParamsSchema,
  );

  await requireMutableEvent(ctx.env, auth, eventId, "entitlement:write");
  const activity = await requireConsumptionActivity(ctx, eventId, activityId);
  assertWritableActivity(activity);

  const body = await parseJsonBody(
    ctx.request,
    ConsumptionParticipantQuotaRulesRequestSchema,
  );

  const participants = await listParticipantsByIds(
    ctx.env.DB,
    eventId,
    body.rules.map((rule) => rule.participantId),
  );
  const participantById = new Map(
    participants.map((participant) => [participant.id, participant]),
  );

  for (const rule of body.rules) {
    if (!participantById.has(rule.participantId)) {
      throw notFound("Peserta tidak ditemukan");
    }
  }

  const existing = await findParticipantQuotasByIds(
    ctx.env.DB,
    eventId,
    activityId,
    body.rules.map((rule) => rule.participantId),
  );
  const existingByParticipant = new Map(
    existing
      .filter((row) => row.participant_id !== null)
      .map((row) => [row.participant_id as string, row]),
  );

  const statements: D1PreparedStatement[] = [];
  const guardedIndexes: number[] = [];

  for (const rule of body.rules) {
    const row = existingByParticipant.get(rule.participantId);

    if (rule.quota === null) {
      if (!row) continue;

      guardedIndexes.push(statements.length);
      statements.push(
        deleteConsumptionQuotaStatement(ctx.env.DB, {
          themeId: eventId,
          quotaId: row.id,
          expectedUpdatedAt: row.updated_at,
        }),
      );
      statements.push(
        insertAuditAfterConsumptionQuotaDeleteStatement(
          ctx.env.DB,
          quotaAudit(
            ctx,
            auth.user.id,
            eventId,
            "consumption_quota.deleted",
            "consumption_quota",
            row.id,
            { before: quotaRowSnapshot(row) },
          ),
          row.id,
        ),
      );
      continue;
    }

    if (row) {
      guardedIndexes.push(statements.length);
      statements.push(
        updateConsumptionQuotaStatement(ctx.env.DB, {
          themeId: eventId,
          quotaId: row.id,
          quota: rule.quota,
          actorUserId: auth.user.id,
          now: ctx.now,
          expectedUpdatedAt: row.updated_at,
        }),
      );
      statements.push(
        insertAuditAfterConsumptionQuotaUpdateStatement(
          ctx.env.DB,
          quotaAudit(
            ctx,
            auth.user.id,
            eventId,
            "consumption_quota.updated",
            "consumption_quota",
            row.id,
            {
              before: quotaRowSnapshot(row),
              after: filterAuditFields("consumption_quota", {
                themeId: eventId,
                activityId,
                categoryId: null,
                participantId: rule.participantId,
                quota: rule.quota,
              }),
            },
          ),
          row.id,
          ctx.now,
        ),
      );
      continue;
    }

    const id = newId(ctx.now);
    statements.push(
      insertConsumptionQuotaStatement(ctx.env.DB, {
        id,
        themeId: eventId,
        activityId,
        categoryId: null,
        participantId: rule.participantId,
        quota: rule.quota,
        createdAt: ctx.now,
        createdBy: auth.user.id,
      }),
    );
    statements.push(
      insertAuditStatement(
        ctx.env.DB,
        quotaAudit(
          ctx,
          auth.user.id,
          eventId,
          "consumption_quota.created",
          "consumption_quota",
          id,
          {
            after: filterAuditFields("consumption_quota", {
              themeId: eventId,
              activityId,
              categoryId: null,
              participantId: rule.participantId,
              quota: rule.quota,
            }),
          },
        ),
      ),
    );
  }

  const results = await batchQuotaStatements(ctx.env.DB, statements);
  assertQuotaWritesLanded(results, guardedIndexes);

  const payload: ConsumptionParticipantQuotaRulesPayload = {
    activityId,
    rules: body.rules.map((rule) => ({
      participantId: rule.participantId,
      quota: rule.quota,
    })),
  };
  return { data: payload };
}

// ───────────────────────────────────────────── Manual Entry (A5)

async function manualConsumption(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, ConsumptionEventParamsSchema);

  const access = await requireEventAccess(ctx.env, auth, eventId, "consumption:manual");

  // ADR-0021/OQ-034: Super Admin never performs Manual Entry, even though
  // `isAllowed` lets it pass every matrix entry.
  if (auth.user.role === "superadmin") {
    throw forbidden("Super Admin tidak berwenang melakukan pencatatan konsumsi manual");
  }

  const body = await parseJsonBody(ctx.request, ConsumptionManualRequestSchema);

  const event = await findEventById(ctx.env.DB, eventId);
  if (!event) throw notFound("Acara tidak ditemukan");
  if (event.allow_manual !== 1) {
    throw businessRule("Acara ini tidak mengizinkan pencatatan manual");
  }

  const participant = await findParticipant(ctx.env.DB, eventId, body.participantId);
  if (!participant) throw notFound("Peserta tidak ditemukan pada acara ini");

  const context = await resolveConsumptionContext(ctx.env.DB, {
    eventId,
    activityId: body.activityId,
    sessionId: body.sessionId,
  });
  const activity = context.activity;
  const sessionId = context.session?.id ?? null;

  const rejection = lifecycleRejection({
    event,
    activity,
    session: context.session,
    participant,
    now: ctx.now,
  });

  if (rejection !== null) {
    throw businessRule(consumptionMessage(rejection), { reason: rejection });
  }

  const rules = await listRulesForContext(ctx.env.DB, {
    themeId: eventId,
    participantId: participant.id,
    categoryId: participant.category_id,
    activityId: activity.id,
    sessionId,
  });

  const entitlement = resolveEntitlement(
    {
      participantId: participant.id,
      categoryId: participant.category_id,
      activityId: activity.id,
      sessionId,
    },
    rules,
  );

  if (!entitlement.allowed) {
    throw businessRule(scanMessage("entitlement_denied"), {
      reason: "entitlement_denied",
    });
  }

  if (access.membershipRole === "officer") {
    const assignment = await findEffectiveAssignment(ctx.env.DB, {
      themeId: eventId,
      activityId: activity.id,
      sessionId,
      userId: auth.user.id,
    });

    if (!assignment) {
      throw forbidden("Anda tidak ditugaskan pada Aktivitas/Sesi ini");
    }
    if (assignment.can_manual_check_in !== 1) {
      throw forbidden("Manual Check-in belum diaktifkan untuk penugasan Anda");
    }
  }

  const usedSlots = await listEffectiveConsumptionSlots(ctx.env.DB, {
    themeId: eventId,
    activityId: activity.id,
    participantId: participant.id,
  });
  const used = usedSlots.length;

  const overrides = await findQuotaOverrides(ctx.env.DB, {
    themeId: eventId,
    activityId: activity.id,
    participantId: participant.id,
    categoryId: participant.category_id,
  });

  const quota = resolveQuota({
    activityQuota: activity.quota,
    categoryOverride: overrides.categoryOverride,
    participantOverride: overrides.participantOverride,
  });

  if (quotaRejection({ used, quota }) !== null) {
    // Manual Entry is a request the admin can correct, so an exhausted quota is
    // a 422 rather than the scanner's HTTP 200 `DUPLICATE` (A4).
    throw businessRule(CONSUMPTION_MESSAGES.quotaExhausted, {
      reason: "quota_exhausted",
    });
  }

  const transactionId = newId(ctx.now);
  const note = body.note ?? null;
  const slotNo = nextSlotNo({ usedSlots });
  const ipHash = await clientIpHash(ctx.request, ctx.env.SESSION_PEPPER);

  let inserted: boolean;

  try {
    const results = await ctx.env.DB.batch([
      insertTransactionStatement(ctx.env.DB, {
        id: transactionId,
        themeId: eventId,
        activityId: activity.id,
        sessionId,
        participantId: participant.id,
        type: "consumption",
        source: "manual",
        // A Consumption transaction has no attendance status (CHECK in 0011).
        status: null,
        occurredAt: ctx.now,
        deviceTs: null,
        recordedBy: auth.user.id,
        note,
        slotNo,
        adjustsTransactionId: null,
        now: ctx.now,
      }),
      insertAuditAfterTransactionStatement(
        ctx.env.DB,
        {
          id: newId(ctx.now),
          eventId,
          actorUserId: auth.user.id,
          action: "transaction.manual",
          entityType: "transaction",
          entityId: transactionId,
          after: filterAuditFields(
            "transaction",
            transactionSnapshot(
              {
                id: transactionId,
                theme_id: eventId,
                activity_id: activity.id,
                session_id: sessionId,
                participant_id: participant.id,
                type: "consumption",
                source: "manual",
                status: null,
                occurred_at: ctx.now,
                adjusts_transaction_id: null,
                reversed_at: null,
                superseded_at: null,
                slot_no: slotNo,
              },
              { noteChanged: note !== null },
            ),
          ),
          ipHash,
          createdAt: ctx.now,
        },
        transactionId,
      ),
    ]);

    inserted = (results[0]?.meta.changes ?? 0) > 0;
  } catch (error) {
    // A parallel request may have taken the last slot after our count; the
    // trigger is the authority and its rejection is a business outcome.
    if (!isQuotaExhaustedError(error)) throw error;

    throw businessRule(CONSUMPTION_MESSAGES.quotaExhausted, {
      reason: "quota_exhausted",
    });
  }

  if (!inserted) {
    throw conflict("Peserta ini sudah mengambil jatah pada Aktivitas/Sesi tersebut");
  }

  const created = await findTransactionById(ctx.env.DB, eventId, transactionId);

  if (!created) {
    throw new ApiError(
      500,
      "SYSTEM_ERROR",
      "Transaksi tidak dapat dibaca setelah pencatatan. Coba lagi.",
    );
  }

  const payload: TransactionDetailPayload = { transaction: toTransactionRecord(created) };
  return { status: 201, data: payload };
}

export const consumptionRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    pattern: "/api/events/:eventId/activities/:activityId/quota",
    public: false,
    handler: getActivityQuota,
  },
  {
    method: "PUT",
    pattern: "/api/events/:eventId/activities/:activityId/quota",
    public: false,
    handler: putActivityQuota,
  },
  {
    method: "PUT",
    pattern: "/api/events/:eventId/activities/:activityId/quota/categories",
    public: false,
    handler: putCategoryQuotas,
  },
  {
    method: "PUT",
    pattern: "/api/events/:eventId/activities/:activityId/quota/participants",
    public: false,
    handler: putParticipantQuotas,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/consumption/manual",
    public: false,
    handler: manualConsumption,
  },
];
