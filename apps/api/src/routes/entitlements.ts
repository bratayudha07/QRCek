import type {
  EntitlementCategoryCell,
  EntitlementCategoryRulesPayload,
  EntitlementDefaultPayload,
  EntitlementMatrixPayload,
  EntitlementParticipantCell,
  EntitlementParticipantRulePayload,
  EntitlementResolvePayload,
  EntitlementSessionMatrix,
  EntitlementStatus,
} from "@absensi/shared";
import {
  EntitlementActivityParamsSchema,
  EntitlementActivityParticipantParamsSchema,
  EntitlementCategoryRulesRequestSchema,
  EntitlementDefaultRequestSchema,
  EntitlementEventParamsSchema,
  EntitlementParticipantRuleRequestSchema,
  EntitlementResolveQuerySchema,
  EntitlementSessionParamsSchema,
  EntitlementSessionParticipantParamsSchema,
  filterAuditFields,
  resolveEntitlement,
} from "@absensi/shared";
import type { z } from "zod";

import { findActivity } from "../db/activities";
import {
  findActivitySession,
  listActivitySessions,
} from "../db/activity-sessions";
import type { AuditEntry } from "../db/audit";
import {
  insertAuditAfterEntitlementRuleDeleteStatement,
  insertAuditAfterEntitlementRuleUpdateStatement,
  insertAuditStatement,
} from "../db/audit";
import { listCategories } from "../db/categories";
import type { EntitlementRuleRow } from "../db/entitlement-rules";
import {
  deleteEntitlementRuleStatement,
  findIndividualActivityRule,
  findIndividualSessionRule,
  findThemeDefault,
  getEntitlementCompleteness,
  insertEntitlementRuleStatement,
  listActivityCategoryRules,
  listParticipantOverrides,
  listRulesForContext,
  listSessionCategoryRules,
  listSessionCategoryRulesForActivity,
  listSessionParticipantOverrides,
  updateEntitlementRuleStatusStatement,
} from "../db/entitlement-rules";
import { findParticipant } from "../db/participants";
import { newId } from "../domain/ids";
import { ApiError, businessRule, conflict, notFound } from "../http/errors";
import { authOf, requireEventAccess, requireMutableEvent } from "../http/auth";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { parseJsonBody, parsePathParams, parseQuery } from "../http/validate";

/**
 * Entitlement configuration (DESAIN_API.md §6, ADR-0016, Q3 API-only).
 *
 * The resolver itself is pure (`@absensi/shared`); this file only translates
 * HTTP into validated writes. Every mutation writes its audit row in the same
 * `db.batch()` as the rule change, and every mutation is scoped by the Tema so a
 * child id from another Tema is a 404, never a cross-theme write.
 */

type ActivityParams = z.infer<typeof EntitlementActivityParamsSchema>;
type SessionParams = z.infer<typeof EntitlementSessionParamsSchema>;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

/**
 * One batch for a rule mutation plus its audit row. A concurrent writer that
 * wins the unique index is a business outcome (`409`), never a 500.
 */
async function batchEntitlementStatements(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<D1Result[]> {
  try {
    return await db.batch(statements);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("Aturan entitlement sudah ada. Muat ulang lalu coba lagi.");
    }
    throw error;
  }
}

/**
 * Entitlement input errors are business rules (422), not generic bad requests:
 * the batch limit, duplicate cells, and `inherit` on the Theme default are all
 * configuration mistakes an admin must correct.
 */
async function parseEntitlementBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    return await parseJsonBody(request, schema);
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      throw businessRule(error.message, error.details);
    }
    throw error;
  }
}

function ruleSnapshot(row: {
  themeId: string;
  activityId: string | null;
  sessionId: string | null;
  participantId: string | null;
  categoryId: string | null;
  status: EntitlementStatus;
}): Record<string, unknown> | null {
  return filterAuditFields("entitlement_rule", row);
}

function rowSnapshot(row: EntitlementRuleRow): Record<string, unknown> | null {
  return ruleSnapshot({
    themeId: row.theme_id,
    activityId: row.activity_id,
    sessionId: row.session_id,
    participantId: row.participant_id,
    categoryId: row.category_id,
    status: row.status,
  });
}

function entitlementAudit(
  ctx: RouteContext,
  authUserId: string,
  eventId: string,
  action: "entitlement_rule.created" | "entitlement_rule.updated" | "entitlement_rule.deleted",
  ruleId: string,
  snapshots: { before?: unknown; after?: unknown },
): AuditEntry {
  return {
    id: newId(ctx.now),
    eventId,
    actorUserId: authUserId,
    action,
    entityType: "entitlement_rule",
    entityId: ruleId,
    before: snapshots.before,
    after: snapshots.after,
    createdAt: ctx.now,
  };
}

async function requireActivity(
  ctx: RouteContext,
  eventId: string,
  activityId: string,
): Promise<void> {
  const activity = await findActivity(ctx.env.DB, eventId, activityId);
  if (!activity) throw notFound("Aktivitas tidak ditemukan");
}

async function requireSession(
  ctx: RouteContext,
  activityId: string,
  sessionId: string,
): Promise<void> {
  const session = await findActivitySession(ctx.env.DB, activityId, sessionId);
  if (!session) throw notFound("Sesi tidak ditemukan");
}

async function requireParticipant(
  ctx: RouteContext,
  eventId: string,
  participantId: string,
): Promise<string> {
  const participant = await findParticipant(ctx.env.DB, eventId, participantId);
  if (!participant) throw notFound("Peserta tidak ditemukan");
  return participant.category_id;
}

function assertUpdateLanded(
  results: D1Result[],
  updateIndexes: readonly number[],
): void {
  for (const index of updateIndexes) {
    if ((results[index]?.meta.changes ?? 0) === 0) {
      throw conflict("Aturan entitlement berubah di perangkat lain. Muat ulang lalu coba lagi.");
    }
  }
}

// ───────────────────────────────────────────── Theme default

async function getThemeDefault(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EntitlementEventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "entitlement:read");

  const row = await findThemeDefault(ctx.env.DB, eventId);
  const payload: EntitlementDefaultPayload = {
    themeDefault: row ? { status: row.status } : null,
  };
  return { data: payload };
}

async function putThemeDefault(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EntitlementEventParamsSchema);

  await requireMutableEvent(ctx.env, auth, eventId, "entitlement:write");
  const body = await parseEntitlementBody(ctx.request, EntitlementDefaultRequestSchema);
  const existing = await findThemeDefault(ctx.env.DB, eventId);

  if (existing) {
    const results = await batchEntitlementStatements(ctx.env.DB, [
      updateEntitlementRuleStatusStatement(ctx.env.DB, {
        themeId: eventId,
        ruleId: existing.id,
        status: body.status,
        actorUserId: auth.user.id,
        now: ctx.now,
        expectedUpdatedAt: existing.updated_at,
      }),
      insertAuditAfterEntitlementRuleUpdateStatement(
        ctx.env.DB,
        entitlementAudit(
          ctx,
          auth.user.id,
          eventId,
          "entitlement_rule.updated",
          existing.id,
          {
            before: rowSnapshot(existing),
            after: ruleSnapshot({
              themeId: eventId,
              activityId: null,
              sessionId: null,
              participantId: null,
              categoryId: null,
              status: body.status,
            }),
          },
        ),
        existing.id,
        ctx.now,
      ),
    ]);

    assertUpdateLanded(results, [0]);
  } else {
    const id = newId(ctx.now);
    await batchEntitlementStatements(ctx.env.DB, [
      insertEntitlementRuleStatement(ctx.env.DB, {
        id,
        themeId: eventId,
        activityId: null,
        sessionId: null,
        participantId: null,
        categoryId: null,
        status: body.status,
        createdAt: ctx.now,
        createdBy: auth.user.id,
      }),
      insertAuditStatement(
        ctx.env.DB,
        entitlementAudit(ctx, auth.user.id, eventId, "entitlement_rule.created", id, {
          after: ruleSnapshot({
            themeId: eventId,
            activityId: null,
            sessionId: null,
            participantId: null,
            categoryId: null,
            status: body.status,
          }),
        }),
      ),
    ]);
  }

  const payload: EntitlementDefaultPayload = { themeDefault: { status: body.status } };
  return { data: payload };
}

async function deleteThemeDefault(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EntitlementEventParamsSchema);

  await requireMutableEvent(ctx.env, auth, eventId, "entitlement:write");
  const existing = await findThemeDefault(ctx.env.DB, eventId);
  if (!existing) throw notFound("Aturan default belum ada");

  const results = await batchEntitlementStatements(ctx.env.DB, [
    deleteEntitlementRuleStatement(ctx.env.DB, {
      themeId: eventId,
      ruleId: existing.id,
      expectedUpdatedAt: existing.updated_at,
    }),
    insertAuditAfterEntitlementRuleDeleteStatement(
      ctx.env.DB,
      entitlementAudit(
        ctx,
        auth.user.id,
        eventId,
        "entitlement_rule.deleted",
        existing.id,
        { before: rowSnapshot(existing) },
      ),
      existing.id,
    ),
  ]);

  assertUpdateLanded(results, [0]);

  const payload: EntitlementDefaultPayload = { themeDefault: null };
  return { data: payload };
}

// ───────────────────────────────────────────── Activity matrix

async function getActivityMatrix(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, activityId } = parsePathParams(
    ctx.params,
    EntitlementActivityParamsSchema,
  );

  await requireEventAccess(ctx.env, auth, eventId, "entitlement:read");
  await requireActivity(ctx, eventId, activityId);

  const [
    defaultRow,
    categories,
    sessions,
    activityCategoryRows,
    sessionCategoryRows,
    activityParticipantRows,
    sessionParticipantRows,
    completeness,
  ] = await Promise.all([
    findThemeDefault(ctx.env.DB, eventId),
    listCategories(ctx.env.DB, eventId, "all"),
    listActivitySessions(ctx.env.DB, activityId),
    listActivityCategoryRules(ctx.env.DB, eventId, activityId),
    listSessionCategoryRulesForActivity(ctx.env.DB, eventId, activityId),
    listParticipantOverrides(ctx.env.DB, eventId, activityId, null),
    listSessionParticipantOverrides(ctx.env.DB, eventId, activityId),
    getEntitlementCompleteness(ctx.env.DB, eventId, activityId),
  ]);

  const activityCategoryStatus = new Map<string, EntitlementStatus>(
    activityCategoryRows.map((rule) => [rule.category_id as string, rule.status]),
  );
  const activityParticipants: EntitlementParticipantCell[] = activityParticipantRows.map(
    (rule) => ({
      participantId: rule.participant_id as string,
      status: rule.status,
    }),
  );

  const sessionCategoryStatus = new Map<string, Map<string, EntitlementStatus>>();
  for (const rule of sessionCategoryRows) {
    const sessionId = rule.session_id as string;
    const statuses = sessionCategoryStatus.get(sessionId) ?? new Map();
    statuses.set(rule.category_id as string, rule.status);
    sessionCategoryStatus.set(sessionId, statuses);
  }

  const sessionParticipants = new Map<string, EntitlementParticipantCell[]>();
  for (const rule of sessionParticipantRows) {
    const sessionId = rule.session_id as string;
    const bucket = sessionParticipants.get(sessionId) ?? [];
    bucket.push({
      participantId: rule.participant_id as string,
      status: rule.status,
    });
    sessionParticipants.set(sessionId, bucket);
  }

  const categoryCells: EntitlementCategoryCell[] = categories.map((category) => ({
    categoryId: category.id,
    name: category.name,
    status: activityCategoryStatus.get(category.id) ?? null,
  }));

  const sessionMatrices: EntitlementSessionMatrix[] = sessions.map((session) => {
    const statuses = sessionCategoryStatus.get(session.id);
    return {
      sessionId: session.id,
      categories: categoryCells.map((category) => ({
        categoryId: category.categoryId,
        name: category.name,
        status: statuses?.get(category.categoryId) ?? null,
      })),
      participants: sessionParticipants.get(session.id) ?? [],
    };
  });

  const payload: EntitlementMatrixPayload = {
    activityId,
    entitlementComplete: completeness.complete,
    missingCategoryIds: completeness.missingCategoryIds,
    themeDefault: defaultRow ? { status: defaultRow.status } : null,
    categories: categoryCells,
    sessions: sessionMatrices,
    participants: activityParticipants,
  };

  return { data: payload };
}

// ───────────────────────────────────────────── Category rules (batch)

async function upsertCategoryRules(
  ctx: RouteContext,
  params: ActivityParams | SessionParams,
  sessionId: string | null,
): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, activityId } = params;

  await requireMutableEvent(ctx.env, auth, eventId, "entitlement:write");
  await requireActivity(ctx, eventId, activityId);
  if (sessionId !== null) await requireSession(ctx, activityId, sessionId);

  const body = await parseEntitlementBody(ctx.request, EntitlementCategoryRulesRequestSchema);

  // One read for the whole batch, rather than one per row: the statement budget
  // is upsert + audit per rule plus the completeness query.
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

  const existingRows =
    sessionId === null
      ? await listActivityCategoryRules(ctx.env.DB, eventId, activityId)
      : await listSessionCategoryRules(ctx.env.DB, eventId, activityId, sessionId);
  const existingByCategory = new Map(
    existingRows
      .filter((row) => row.category_id !== null)
      .map((row) => [row.category_id as string, row]),
  );

  const statements: D1PreparedStatement[] = [];
  const updateIndexes: number[] = [];

  for (const rule of body.rules) {
    const existing = existingByCategory.get(rule.categoryId);

    if (existing) {
      updateIndexes.push(statements.length);
      statements.push(
        updateEntitlementRuleStatusStatement(ctx.env.DB, {
          themeId: eventId,
          ruleId: existing.id,
          status: rule.status,
          actorUserId: auth.user.id,
          now: ctx.now,
          expectedUpdatedAt: existing.updated_at,
        }),
      );
      statements.push(
        insertAuditAfterEntitlementRuleUpdateStatement(
          ctx.env.DB,
          entitlementAudit(
            ctx,
            auth.user.id,
            eventId,
            "entitlement_rule.updated",
            existing.id,
            {
              before: rowSnapshot(existing),
              after: ruleSnapshot({
                themeId: eventId,
                activityId,
                sessionId,
                participantId: null,
                categoryId: rule.categoryId,
                status: rule.status,
              }),
            },
          ),
          existing.id,
          ctx.now,
        ),
      );
    } else {
      const id = newId(ctx.now);
      statements.push(
        insertEntitlementRuleStatement(ctx.env.DB, {
          id,
          themeId: eventId,
          activityId,
          sessionId,
          participantId: null,
          categoryId: rule.categoryId,
          status: rule.status,
          createdAt: ctx.now,
          createdBy: auth.user.id,
        }),
      );
      statements.push(
        insertAuditStatement(
          ctx.env.DB,
          entitlementAudit(
            ctx,
            auth.user.id,
            eventId,
            "entitlement_rule.created",
            id,
            {
              after: ruleSnapshot({
                themeId: eventId,
                activityId,
                sessionId,
                participantId: null,
                categoryId: rule.categoryId,
                status: rule.status,
              }),
            },
          ),
        ),
      );
    }
  }

  const results = await batchEntitlementStatements(ctx.env.DB, statements);

  assertUpdateLanded(results, updateIndexes);

  const completeness = await getEntitlementCompleteness(ctx.env.DB, eventId, activityId);
  const payload: EntitlementCategoryRulesPayload = {
    activityId,
    sessionId,
    rules: body.rules.map((rule) => ({
      categoryId: rule.categoryId,
      status: rule.status,
    })),
    entitlementComplete: completeness.complete,
    missingCategoryIds: completeness.missingCategoryIds,
  };
  return { data: payload };
}

async function putActivityCategoryRules(ctx: RouteContext): Promise<RouteResult> {
  const params = parsePathParams(ctx.params, EntitlementActivityParamsSchema);
  return upsertCategoryRules(ctx, params, null);
}

async function putSessionCategoryRules(ctx: RouteContext): Promise<RouteResult> {
  const params = parsePathParams(ctx.params, EntitlementSessionParamsSchema);
  return upsertCategoryRules(ctx, params, params.sessionId);
}

// ───────────────────────────────────────────── Individual overrides

async function upsertParticipantOverride(
  ctx: RouteContext,
  params: ActivityParams | (SessionParams & { participantId: string }),
  participantId: string,
  sessionId: string | null,
): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, activityId } = params;

  await requireMutableEvent(ctx.env, auth, eventId, "entitlement:write");
  await requireActivity(ctx, eventId, activityId);
  if (sessionId !== null) await requireSession(ctx, activityId, sessionId);
  await requireParticipant(ctx, eventId, participantId);

  const body = await parseEntitlementBody(
    ctx.request,
    EntitlementParticipantRuleRequestSchema,
  );

  const existing =
    sessionId === null
      ? await findIndividualActivityRule(ctx.env.DB, eventId, activityId, participantId)
      : await findIndividualSessionRule(
          ctx.env.DB,
          eventId,
          activityId,
          sessionId,
          participantId,
        );

  if (existing) {
    const results = await batchEntitlementStatements(ctx.env.DB, [
      updateEntitlementRuleStatusStatement(ctx.env.DB, {
        themeId: eventId,
        ruleId: existing.id,
        status: body.status,
        actorUserId: auth.user.id,
        now: ctx.now,
        expectedUpdatedAt: existing.updated_at,
      }),
      insertAuditAfterEntitlementRuleUpdateStatement(
        ctx.env.DB,
        entitlementAudit(
          ctx,
          auth.user.id,
          eventId,
          "entitlement_rule.updated",
          existing.id,
          {
            before: rowSnapshot(existing),
            after: ruleSnapshot({
              themeId: eventId,
              activityId,
              sessionId,
              participantId,
              categoryId: null,
              status: body.status,
            }),
          },
        ),
        existing.id,
        ctx.now,
      ),
    ]);

    assertUpdateLanded(results, [0]);
  } else {
    const id = newId(ctx.now);
    await batchEntitlementStatements(ctx.env.DB, [
      insertEntitlementRuleStatement(ctx.env.DB, {
        id,
        themeId: eventId,
        activityId,
        sessionId,
        participantId,
        categoryId: null,
        status: body.status,
        createdAt: ctx.now,
        createdBy: auth.user.id,
      }),
      insertAuditStatement(
        ctx.env.DB,
        entitlementAudit(ctx, auth.user.id, eventId, "entitlement_rule.created", id, {
          after: ruleSnapshot({
            themeId: eventId,
            activityId,
            sessionId,
            participantId,
            categoryId: null,
            status: body.status,
          }),
        }),
      ),
    ]);
  }

  const payload: EntitlementParticipantRulePayload = {
    participantOverride: { participantId, sessionId, status: body.status },
  };
  return { data: payload };
}

async function putActivityParticipantOverride(ctx: RouteContext): Promise<RouteResult> {
  const params = parsePathParams(
    ctx.params,
    EntitlementActivityParticipantParamsSchema,
  );
  return upsertParticipantOverride(ctx, params, params.participantId, null);
}

async function putSessionParticipantOverride(ctx: RouteContext): Promise<RouteResult> {
  const params = parsePathParams(
    ctx.params,
    EntitlementSessionParticipantParamsSchema,
  );
  return upsertParticipantOverride(ctx, params, params.participantId, params.sessionId);
}

async function deleteParticipantOverride(
  ctx: RouteContext,
  params: ActivityParams | (SessionParams & { participantId: string }),
  participantId: string,
  sessionId: string | null,
): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, activityId } = params;

  await requireMutableEvent(ctx.env, auth, eventId, "entitlement:write");
  await requireActivity(ctx, eventId, activityId);
  if (sessionId !== null) await requireSession(ctx, activityId, sessionId);
  await requireParticipant(ctx, eventId, participantId);

  const existing =
    sessionId === null
      ? await findIndividualActivityRule(ctx.env.DB, eventId, activityId, participantId)
      : await findIndividualSessionRule(
          ctx.env.DB,
          eventId,
          activityId,
          sessionId,
          participantId,
        );

  if (!existing) throw notFound("Override peserta belum ada");

  const results = await batchEntitlementStatements(ctx.env.DB, [
    deleteEntitlementRuleStatement(ctx.env.DB, {
      themeId: eventId,
      ruleId: existing.id,
      expectedUpdatedAt: existing.updated_at,
    }),
    insertAuditAfterEntitlementRuleDeleteStatement(
      ctx.env.DB,
      entitlementAudit(
        ctx,
        auth.user.id,
        eventId,
        "entitlement_rule.deleted",
        existing.id,
        { before: rowSnapshot(existing) },
      ),
      existing.id,
    ),
  ]);

  assertUpdateLanded(results, [0]);

  const payload: EntitlementParticipantRulePayload = { participantOverride: null };
  return { data: payload };
}

async function deleteActivityParticipantOverride(
  ctx: RouteContext,
): Promise<RouteResult> {
  const params = parsePathParams(
    ctx.params,
    EntitlementActivityParticipantParamsSchema,
  );
  return deleteParticipantOverride(ctx, params, params.participantId, null);
}

async function deleteSessionParticipantOverride(
  ctx: RouteContext,
): Promise<RouteResult> {
  const params = parsePathParams(
    ctx.params,
    EntitlementSessionParticipantParamsSchema,
  );
  return deleteParticipantOverride(ctx, params, params.participantId, params.sessionId);
}

// ───────────────────────────────────────────── Resolver preview

async function resolvePreview(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, activityId } = parsePathParams(
    ctx.params,
    EntitlementActivityParamsSchema,
  );

  await requireEventAccess(ctx.env, auth, eventId, "entitlement:read");
  await requireActivity(ctx, eventId, activityId);

  const query = parseQuery(ctx.request, EntitlementResolveQuerySchema);
  const categoryId = await requireParticipant(ctx, eventId, query.participantId);
  if (query.sessionId !== undefined) {
    await requireSession(ctx, activityId, query.sessionId);
  }

  const rules = await listRulesForContext(ctx.env.DB, {
    themeId: eventId,
    participantId: query.participantId,
    categoryId,
    activityId,
    sessionId: query.sessionId ?? null,
  });

  const result = resolveEntitlement(
    {
      participantId: query.participantId,
      categoryId,
      activityId,
      sessionId: query.sessionId ?? null,
    },
    rules,
  );

  const payload: EntitlementResolvePayload = {
    allowed: result.allowed,
    status: result.status,
    decidedBy: result.decidedBy,
  };
  return { data: payload };
}

// ───────────────────────────────────────────── Route table

export const entitlementRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    pattern: "/api/events/:eventId/entitlements/default",
    public: false,
    handler: getThemeDefault,
  },
  {
    method: "PUT",
    pattern: "/api/events/:eventId/entitlements/default",
    public: false,
    handler: putThemeDefault,
  },
  {
    method: "DELETE",
    pattern: "/api/events/:eventId/entitlements/default",
    public: false,
    handler: deleteThemeDefault,
  },
  {
    method: "GET",
    pattern: "/api/events/:eventId/activities/:activityId/entitlements",
    public: false,
    handler: getActivityMatrix,
  },
  {
    method: "PUT",
    pattern: "/api/events/:eventId/activities/:activityId/entitlements/categories",
    public: false,
    handler: putActivityCategoryRules,
  },
  {
    method: "PUT",
    pattern:
      "/api/events/:eventId/activities/:activityId/sessions/:sessionId/entitlements/categories",
    public: false,
    handler: putSessionCategoryRules,
  },
  {
    method: "PUT",
    pattern:
      "/api/events/:eventId/activities/:activityId/entitlements/participants/:participantId",
    public: false,
    handler: putActivityParticipantOverride,
  },
  {
    method: "DELETE",
    pattern:
      "/api/events/:eventId/activities/:activityId/entitlements/participants/:participantId",
    public: false,
    handler: deleteActivityParticipantOverride,
  },
  {
    method: "PUT",
    pattern:
      "/api/events/:eventId/activities/:activityId/sessions/:sessionId/entitlements/participants/:participantId",
    public: false,
    handler: putSessionParticipantOverride,
  },
  {
    method: "DELETE",
    pattern:
      "/api/events/:eventId/activities/:activityId/sessions/:sessionId/entitlements/participants/:participantId",
    public: false,
    handler: deleteSessionParticipantOverride,
  },
  {
    method: "GET",
    pattern: "/api/events/:eventId/activities/:activityId/entitlements/resolve",
    public: false,
    handler: resolvePreview,
  },
];
