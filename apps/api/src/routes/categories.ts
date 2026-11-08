import { z } from "zod";

import type {
  CategoryDetailPayload,
  CategoryListPayload,
  CategorySummary,
} from "@absensi/shared";
import {
  CategoryCreateRequestSchema,
  CategoryIdSchema,
  CategoryListQuerySchema,
  CategoryStatusRequestSchema,
  CategoryUpdateRequestSchema,
  EventIdSchema,
  filterAuditFields,
} from "@absensi/shared";

import type { AuditEntry } from "../db/audit";
import {
  insertAuditAfterCategoryUpdateStatement,
  insertAuditStatement,
} from "../db/audit";
import type { CategoryRow } from "../db/categories";
import {
  findCategory,
  findCategoryByName,
  insertCategoryStatement,
  listCategories,
  updateCategoryStatement,
  updateCategoryStatusStatement,
} from "../db/categories";
import { newId } from "../domain/ids";
import { authOf, requireEventAccess, requireMutableEvent } from "../http/auth";
import { businessRule, conflict, notFound } from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { parseJsonBody, parsePathParams, parseQuery } from "../http/validate";

/**
 * Category management (DESAIN_API.md §5, ADR-0014).
 *
 * Categories are per Tema and archive-only. A category id from another Tema is
 * a 404, and all mutations write audit in the same batch as the write.
 */

const EventParamsSchema = z.object({ eventId: EventIdSchema });
const CategoryParamsSchema = z.object({
  eventId: EventIdSchema,
  categoryId: CategoryIdSchema,
});

function toCategory(row: CategoryRow, participantCount?: number): CategorySummary {
  return {
    id: row.id,
    themeId: row.theme_id,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    status: row.status,
    ...(participantCount === undefined ? {} : { participantCount }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function categorySnapshot(row: CategoryRow): Record<string, unknown> | null {
  return filterAuditFields("category", {
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    status: row.status,
    archivedAt: row.archived_at,
  });
}

function categoryAudit(
  ctx: RouteContext,
  authUserId: string,
  eventId: string,
  action: string,
  categoryId: string,
  snapshots: { before?: unknown; after?: unknown },
): AuditEntry {
  return {
    id: newId(ctx.now),
    eventId,
    actorUserId: authUserId,
    action,
    entityType: "category",
    entityId: categoryId,
    before: snapshots.before,
    after: snapshots.after,
    createdAt: ctx.now,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

async function listThemeCategories(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);
  await requireEventAccess(ctx.env, auth, eventId, "category:read");

  const query = parseQuery(ctx.request, CategoryListQuerySchema);
  const rows = await listCategories(ctx.env.DB, eventId, query.status);

  const payload: CategoryListPayload = {
    categories: rows.map((row) => toCategory(row, row.participant_count)),
  };
  return { data: payload };
}

async function createCategory(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);
  await requireMutableEvent(ctx.env, auth, eventId);

  const body = await parseJsonBody(ctx.request, CategoryCreateRequestSchema);
  const duplicate = await findCategoryByName(ctx.env.DB, eventId, body.name);
  if (duplicate) throw conflict("Nama kategori sudah dipakai di acara ini");

  const id = newId(ctx.now);
  const category: CategoryRow = {
    id,
    theme_id: eventId,
    name: body.name,
    description: body.description ?? null,
    sort_order: body.sortOrder,
    status: "active",
    created_at: ctx.now,
    created_by: auth.user.id,
    updated_at: ctx.now,
    updated_by: auth.user.id,
    archived_at: null,
  };

  try {
    await ctx.env.DB.batch([
      insertCategoryStatement(ctx.env.DB, {
        id,
        themeId: eventId,
        name: body.name,
        description: category.description,
        sortOrder: body.sortOrder,
        createdBy: auth.user.id,
        createdAt: ctx.now,
      }),
      insertAuditStatement(
        ctx.env.DB,
        categoryAudit(ctx, auth.user.id, eventId, "category.created", id, {
          after: categorySnapshot(category),
        }),
      ),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("Nama kategori sudah dipakai di acara ini");
    }
    throw error;
  }

  const payload: CategoryDetailPayload = { category: toCategory(category) };
  return { status: 201, data: payload };
}

async function getCategory(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, categoryId } = parsePathParams(ctx.params, CategoryParamsSchema);
  await requireEventAccess(ctx.env, auth, eventId, "category:read");

  const row = await findCategory(ctx.env.DB, eventId, categoryId);
  if (!row) throw notFound("Kategori tidak ditemukan");

  const payload: CategoryDetailPayload = { category: toCategory(row) };
  return { data: payload };
}

async function patchCategory(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, categoryId } = parsePathParams(ctx.params, CategoryParamsSchema);
  await requireMutableEvent(ctx.env, auth, eventId);

  const existing = await findCategory(ctx.env.DB, eventId, categoryId);
  if (!existing) throw notFound("Kategori tidak ditemukan");
  if (existing.status === "archived") {
    throw businessRule("Kategori yang sudah diarsipkan tidak dapat diubah");
  }

  const body = await parseJsonBody(ctx.request, CategoryUpdateRequestSchema);

  if (body.name !== undefined && body.name !== existing.name) {
    const duplicate = await findCategoryByName(ctx.env.DB, eventId, body.name);
    if (duplicate && duplicate.id !== categoryId) {
      throw conflict("Nama kategori sudah dipakai di acara ini");
    }
  }

  const updated: CategoryRow = {
    ...existing,
    name: body.name ?? existing.name,
    description:
      body.description === undefined ? existing.description : body.description,
    sort_order: body.sortOrder ?? existing.sort_order,
    updated_at: ctx.now,
    updated_by: auth.user.id,
  };

  let results: D1Result[];
  try {
    results = await ctx.env.DB.batch([
      updateCategoryStatement(ctx.env.DB, {
        themeId: eventId,
        categoryId,
        update: body,
        actorUserId: auth.user.id,
        now: ctx.now,
        expectedUpdatedAt: existing.updated_at,
      }),
      insertAuditAfterCategoryUpdateStatement(
        ctx.env.DB,
        categoryAudit(ctx, auth.user.id, eventId, "category.updated", categoryId, {
          before: categorySnapshot(existing),
          after: categorySnapshot(updated),
        }),
        categoryId,
        ctx.now,
      ),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("Nama kategori sudah dipakai di acara ini");
    }
    throw error;
  }

  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw conflict("Kategori berubah di perangkat lain. Muat ulang lalu coba lagi.");
  }

  const row = await findCategory(ctx.env.DB, eventId, categoryId);
  if (!row) throw notFound("Kategori tidak ditemukan");

  const payload: CategoryDetailPayload = { category: toCategory(row) };
  return { data: payload };
}

async function changeCategoryStatus(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, categoryId } = parsePathParams(ctx.params, CategoryParamsSchema);
  await requireMutableEvent(ctx.env, auth, eventId);

  const existing = await findCategory(ctx.env.DB, eventId, categoryId);
  if (!existing) throw notFound("Kategori tidak ditemukan");

  const body = await parseJsonBody(ctx.request, CategoryStatusRequestSchema);
  if (body.status === existing.status) {
    throw businessRule(
      body.status === "archived" ? "Kategori sudah diarsipkan" : "Kategori sudah aktif",
    );
  }

  const updated: CategoryRow = {
    ...existing,
    status: body.status,
    archived_at: body.status === "archived" ? ctx.now : null,
    updated_at: ctx.now,
    updated_by: auth.user.id,
  };

  const results = await ctx.env.DB.batch([
    updateCategoryStatusStatement(ctx.env.DB, {
      themeId: eventId,
      categoryId,
      fromStatus: existing.status,
      status: body.status,
      actorUserId: auth.user.id,
      now: ctx.now,
      expectedUpdatedAt: existing.updated_at,
    }),
    insertAuditAfterCategoryUpdateStatement(
      ctx.env.DB,
      categoryAudit(
        ctx,
        auth.user.id,
        eventId,
        body.status === "archived" ? "category.archived" : "category.activated",
        categoryId,
        { before: categorySnapshot(existing), after: categorySnapshot(updated) },
      ),
      categoryId,
      ctx.now,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw conflict("Kategori berubah di perangkat lain. Muat ulang lalu coba lagi.");
  }

  const row = await findCategory(ctx.env.DB, eventId, categoryId);
  if (!row) throw notFound("Kategori tidak ditemukan");

  const payload: CategoryDetailPayload = { category: toCategory(row) };
  return { data: payload };
}

export const categoryRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    pattern: "/api/events/:eventId/categories",
    public: false,
    handler: listThemeCategories,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/categories",
    public: false,
    handler: createCategory,
  },
  {
    method: "GET",
    pattern: "/api/events/:eventId/categories/:categoryId",
    public: false,
    handler: getCategory,
  },
  {
    method: "PATCH",
    pattern: "/api/events/:eventId/categories/:categoryId",
    public: false,
    handler: patchCategory,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/categories/:categoryId/status",
    public: false,
    handler: changeCategoryStatus,
  },
];
