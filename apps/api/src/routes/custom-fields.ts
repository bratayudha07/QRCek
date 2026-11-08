import { z } from "zod";

import type {
  CustomFieldDetailPayload,
  CustomFieldListPayload,
  CustomFieldSummary,
} from "@absensi/shared";
import {
  CUSTOM_FIELD_ACTIVE_LIMIT,
  CUSTOM_FIELD_OPTION_LIMIT,
  CustomFieldCreateRequestSchema,
  CustomFieldIdSchema,
  CustomFieldListQuerySchema,
  CustomFieldStatusRequestSchema,
  CustomFieldTypeRequestSchema,
  CustomFieldUpdateRequestSchema,
  EventIdSchema,
  filterAuditFields,
  isTypeChangeAllowed,
  validateTypeChange,
} from "@absensi/shared";

import type { AuditEntry } from "../db/audit";
import {
  insertAuditAfterCustomFieldUpdateStatement,
  insertAuditStatement,
} from "../db/audit";
import type { CustomFieldRow } from "../db/custom-fields";
import {
  countActiveFields,
  findCustomField,
  findCustomFieldByKey,
  insertCustomFieldStatement,
  listCustomFields,
  parseOptions,
  updateCustomFieldStatement,
  updateCustomFieldStatusStatement,
} from "../db/custom-fields";
import { listParticipantAttributes } from "../db/participants";
import { newId } from "../domain/ids";
import { authOf, requireEventAccess, requireMutableEvent } from "../http/auth";
import { businessRule, conflict, notFound } from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { parseJsonBody, parsePathParams, parseQuery } from "../http/validate";

/**
 * Custom field catalogue (DESAIN_API.md §5, ADR-0014).
 *
 * Definitions are per Tema. `key` is immutable; `label` is the mutable display
 * name. Values are validated in `packages/shared` and stored once per
 * participant in `attributes_json`.
 */

const EventParamsSchema = z.object({ eventId: EventIdSchema });
const FieldParamsSchema = z.object({
  eventId: EventIdSchema,
  fieldId: CustomFieldIdSchema,
});

function toField(row: CustomFieldRow): CustomFieldSummary {
  return {
    id: row.id,
    themeId: row.theme_id,
    key: row.key,
    label: row.label,
    description: row.description,
    type: row.type,
    required: row.required === 1,
    options: parseOptions(row),
    scope: row.scope,
    sortOrder: row.sort_order,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function fieldSnapshot(row: CustomFieldRow): Record<string, unknown> | null {
  return filterAuditFields("custom_field", {
    key: row.key,
    label: row.label,
    description: row.description,
    type: row.type,
    required: row.required === 1,
    scope: row.scope,
    sortOrder: row.sort_order,
    status: row.status,
    archivedAt: row.archived_at,
  });
}

function fieldAudit(
  ctx: RouteContext,
  authUserId: string,
  eventId: string,
  action: string,
  fieldId: string,
  snapshots: { before?: unknown; after?: unknown },
): AuditEntry {
  return {
    id: newId(ctx.now),
    eventId,
    actorUserId: authUserId,
    action,
    entityType: "custom_field",
    entityId: fieldId,
    before: snapshots.before,
    after: snapshots.after,
    createdAt: ctx.now,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function parseAttributes(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function storedValues(
  ctx: RouteContext,
  eventId: string,
  key: string,
): Promise<unknown[]> {
  const rows = await listParticipantAttributes(ctx.env.DB, eventId);
  const values: unknown[] = [];
  for (const row of rows) {
    const value = parseAttributes(row.attributes_json)[key];
    if (value !== undefined) values.push(value);
  }
  return values;
}

async function listThemeCustomFields(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);
  await requireEventAccess(ctx.env, auth, eventId, "custom_field:read");

  const query = parseQuery(ctx.request, CustomFieldListQuerySchema);
  const rows = await listCustomFields(ctx.env.DB, eventId, {
    scope: query.scope,
    status: query.status,
  });

  const payload: CustomFieldListPayload = { fields: rows.map(toField) };
  return { data: payload };
}

async function createCustomField(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);
  await requireMutableEvent(ctx.env, auth, eventId);

  const body = await parseJsonBody(ctx.request, CustomFieldCreateRequestSchema);
  if (body.options !== undefined && body.options.length > CUSTOM_FIELD_OPTION_LIMIT) {
    throw businessRule(`Maksimal ${CUSTOM_FIELD_OPTION_LIMIT} opsi per field`);
  }
  if ((await countActiveFields(ctx.env.DB, eventId)) >= CUSTOM_FIELD_ACTIVE_LIMIT) {
    throw businessRule(
      `Maksimal ${CUSTOM_FIELD_ACTIVE_LIMIT} field aktif per acara. Arsipkan field lain lebih dulu.`,
    );
  }

  const duplicate = await findCustomFieldByKey(ctx.env.DB, eventId, body.key);
  if (duplicate) throw conflict("Key field sudah dipakai di acara ini");

  const id = newId(ctx.now);
  const field: CustomFieldRow = {
    id,
    theme_id: eventId,
    key: body.key,
    label: body.label,
    description: body.description ?? null,
    type: body.type,
    required: body.required ? 1 : 0,
    options_json: body.options ? JSON.stringify(body.options) : null,
    scope: body.scope,
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
      insertCustomFieldStatement(ctx.env.DB, {
        id,
        themeId: eventId,
        key: body.key,
        label: body.label,
        description: field.description,
        type: body.type,
        required: body.required,
        optionsJson: field.options_json,
        scope: body.scope,
        sortOrder: body.sortOrder,
        createdBy: auth.user.id,
        createdAt: ctx.now,
      }),
      insertAuditStatement(
        ctx.env.DB,
        fieldAudit(ctx, auth.user.id, eventId, "custom_field.created", id, {
          after: fieldSnapshot(field),
        }),
      ),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("Key field sudah dipakai di acara ini");
    throw error;
  }

  const payload: CustomFieldDetailPayload = { field: toField(field) };
  return { status: 201, data: payload };
}

async function getCustomField(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, fieldId } = parsePathParams(ctx.params, FieldParamsSchema);
  await requireEventAccess(ctx.env, auth, eventId, "custom_field:read");

  const row = await findCustomField(ctx.env.DB, eventId, fieldId);
  if (!row) throw notFound("Custom field tidak ditemukan");

  const payload: CustomFieldDetailPayload = { field: toField(row) };
  return { data: payload };
}

async function patchCustomField(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, fieldId } = parsePathParams(ctx.params, FieldParamsSchema);
  await requireMutableEvent(ctx.env, auth, eventId);

  const existing = await findCustomField(ctx.env.DB, eventId, fieldId);
  if (!existing) throw notFound("Custom field tidak ditemukan");
  if (existing.status === "archived") {
    throw businessRule("Custom field yang sudah diarsipkan tidak dapat diubah");
  }

  const body = await parseJsonBody(ctx.request, CustomFieldUpdateRequestSchema);

  if (body.options !== undefined) {
    if (body.options.length > CUSTOM_FIELD_OPTION_LIMIT) {
      throw businessRule(`Maksimal ${CUSTOM_FIELD_OPTION_LIMIT} opsi per field`);
    }
    if (existing.type !== "select" && existing.type !== "multi_select") {
      throw businessRule("Opsi hanya berlaku untuk field select/multi_select");
    }

    const used = await storedValues(ctx, eventId, existing.key);
    const invalid = used.filter((value) => {
      if (existing.type === "select") {
        return typeof value !== "string" || !body.options?.includes(value);
      }
      return (
        !Array.isArray(value) ||
        value.some((item) => typeof item !== "string" || !body.options?.includes(item))
      );
    });

    if (invalid.length > 0) {
      throw businessRule(
        "Opsi tidak boleh dihapus selama masih dipakai peserta. Hapus nilainya lebih dulu.",
        { invalidCount: invalid.length },
      );
    }
  }

  const updated: CustomFieldRow = {
    ...existing,
    label: body.label ?? existing.label,
    description:
      body.description === undefined ? existing.description : body.description,
    required: body.required === undefined ? existing.required : body.required ? 1 : 0,
    options_json: body.options === undefined ? existing.options_json : JSON.stringify(body.options),
    sort_order: body.sortOrder ?? existing.sort_order,
    updated_at: ctx.now,
    updated_by: auth.user.id,
  };

  const results = await ctx.env.DB.batch([
    updateCustomFieldStatement(ctx.env.DB, {
      themeId: eventId,
      fieldId,
      update: {
        label: body.label,
        description: body.description,
        required: body.required,
        optionsJson: body.options === undefined ? undefined : JSON.stringify(body.options),
        sortOrder: body.sortOrder,
      },
      actorUserId: auth.user.id,
      now: ctx.now,
      expectedUpdatedAt: existing.updated_at,
    }),
    insertAuditAfterCustomFieldUpdateStatement(
      ctx.env.DB,
      fieldAudit(ctx, auth.user.id, eventId, "custom_field.updated", fieldId, {
        before: fieldSnapshot(existing),
        after: fieldSnapshot(updated),
      }),
      fieldId,
      ctx.now,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw conflict("Custom field berubah di perangkat lain. Muat ulang lalu coba lagi.");
  }

  const row = await findCustomField(ctx.env.DB, eventId, fieldId);
  if (!row) throw notFound("Custom field tidak ditemukan");

  const payload: CustomFieldDetailPayload = { field: toField(row) };
  return { data: payload };
}

async function changeCustomFieldStatus(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, fieldId } = parsePathParams(ctx.params, FieldParamsSchema);
  await requireMutableEvent(ctx.env, auth, eventId);

  const existing = await findCustomField(ctx.env.DB, eventId, fieldId);
  if (!existing) throw notFound("Custom field tidak ditemukan");

  const body = await parseJsonBody(ctx.request, CustomFieldStatusRequestSchema);
  if (body.status === existing.status) {
    throw businessRule(
      body.status === "archived" ? "Field sudah diarsipkan" : "Field sudah aktif",
    );
  }

  if (body.status === "active") {
    if ((await countActiveFields(ctx.env.DB, eventId, fieldId)) >= CUSTOM_FIELD_ACTIVE_LIMIT) {
      throw businessRule(
        `Maksimal ${CUSTOM_FIELD_ACTIVE_LIMIT} field aktif per acara. Arsipkan field lain lebih dulu.`,
      );
    }
  }

  const updated: CustomFieldRow = {
    ...existing,
    status: body.status,
    archived_at: body.status === "archived" ? ctx.now : null,
    updated_at: ctx.now,
    updated_by: auth.user.id,
  };

  const results = await ctx.env.DB.batch([
    updateCustomFieldStatusStatement(ctx.env.DB, {
      themeId: eventId,
      fieldId,
      fromStatus: existing.status,
      status: body.status,
      actorUserId: auth.user.id,
      now: ctx.now,
      expectedUpdatedAt: existing.updated_at,
    }),
    insertAuditAfterCustomFieldUpdateStatement(
      ctx.env.DB,
      fieldAudit(
        ctx,
        auth.user.id,
        eventId,
        body.status === "archived" ? "custom_field.archived" : "custom_field.activated",
        fieldId,
        { before: fieldSnapshot(existing), after: fieldSnapshot(updated) },
      ),
      fieldId,
      ctx.now,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw conflict("Custom field berubah di perangkat lain. Muat ulang lalu coba lagi.");
  }

  const row = await findCustomField(ctx.env.DB, eventId, fieldId);
  if (!row) throw notFound("Custom field tidak ditemukan");

  const payload: CustomFieldDetailPayload = { field: toField(row) };
  return { data: payload };
}

async function changeCustomFieldType(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, fieldId } = parsePathParams(ctx.params, FieldParamsSchema);
  await requireMutableEvent(ctx.env, auth, eventId);

  const existing = await findCustomField(ctx.env.DB, eventId, fieldId);
  if (!existing) throw notFound("Custom field tidak ditemukan");
  if (existing.status === "archived") {
    throw businessRule("Custom field yang sudah diarsipkan tidak dapat diubah");
  }

  const body = await parseJsonBody(ctx.request, CustomFieldTypeRequestSchema);
  if (body.options !== undefined && body.options.length > CUSTOM_FIELD_OPTION_LIMIT) {
    throw businessRule(`Maksimal ${CUSTOM_FIELD_OPTION_LIMIT} opsi per field`);
  }
  if (body.type === existing.type) {
    throw businessRule("Tipe field tidak berubah");
  }

  const options = body.options ?? parseOptions(existing);
  if (!isTypeChangeAllowed(existing.type, body.type)) {
    throw businessRule(`Tipe ${existing.type} tidak dapat diubah menjadi ${body.type}`);
  }

  const values = await storedValues(ctx, eventId, existing.key);
  const check = validateTypeChange(existing.type, body.type, options, values);
  if (!check.ok) {
    throw businessRule(
      "Sebagian nilai peserta tidak kompatibel dengan tipe baru. Buat field baru dan arsipkan yang lama.",
      { invalidCount: check.invalidValues.length },
    );
  }

  const updated: CustomFieldRow = {
    ...existing,
    type: body.type,
    options_json: body.options ? JSON.stringify(body.options) : existing.options_json,
    updated_at: ctx.now,
    updated_by: auth.user.id,
  };

  const results = await ctx.env.DB.batch([
    updateCustomFieldStatement(ctx.env.DB, {
      themeId: eventId,
      fieldId,
      update: {
        type: body.type,
        optionsJson: body.options ? JSON.stringify(body.options) : undefined,
      },
      actorUserId: auth.user.id,
      now: ctx.now,
      expectedUpdatedAt: existing.updated_at,
    }),
    insertAuditAfterCustomFieldUpdateStatement(
      ctx.env.DB,
      fieldAudit(ctx, auth.user.id, eventId, "custom_field.type_changed", fieldId, {
        before: fieldSnapshot(existing),
        after: fieldSnapshot(updated),
      }),
      fieldId,
      ctx.now,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw conflict("Custom field berubah di perangkat lain. Muat ulang lalu coba lagi.");
  }

  const row = await findCustomField(ctx.env.DB, eventId, fieldId);
  if (!row) throw notFound("Custom field tidak ditemukan");

  const payload: CustomFieldDetailPayload = { field: toField(row) };
  return { data: payload };
}

export const customFieldRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    pattern: "/api/events/:eventId/custom-fields",
    public: false,
    handler: listThemeCustomFields,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/custom-fields",
    public: false,
    handler: createCustomField,
  },
  {
    method: "GET",
    pattern: "/api/events/:eventId/custom-fields/:fieldId",
    public: false,
    handler: getCustomField,
  },
  {
    method: "PATCH",
    pattern: "/api/events/:eventId/custom-fields/:fieldId",
    public: false,
    handler: patchCustomField,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/custom-fields/:fieldId/status",
    public: false,
    handler: changeCustomFieldStatus,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/custom-fields/:fieldId/type",
    public: false,
    handler: changeCustomFieldType,
  },
];
