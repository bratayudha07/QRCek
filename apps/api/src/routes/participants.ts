import { z } from "zod";

import type {
  ImportPreviewRow,
  ParticipantDetailPayload,
  ParticipantImportPayload,
  ParticipantListPayload,
  ParticipantSummary,
} from "@absensi/shared";
import {
  EventIdSchema,
  IMPORT_MAX_BYTES,
  ParticipantCreateRequestSchema,
  ParticipantDeleteRequestSchema,
  ParticipantExportQuerySchema,
  ParticipantIdSchema,
  ParticipantImportJsonRequestSchema,
  ParticipantImportQuerySchema,
  ParticipantListQuerySchema,
  ParticipantUpdateRequestSchema,
  filterAuditFields,
  mergeParticipantAttributes,
  validateParticipantAttributes,
} from "@absensi/shared";

import type { AuditEntry } from "../db/audit";
import {
  insertAuditAfterParticipantUpdateStatement,
  insertAuditStatement,
} from "../db/audit";
import { findCategory, findCategoryByName, insertCategoryStatement, listCategories } from "../db/categories";
import { listCustomFields, parseOptions } from "../db/custom-fields";
import { findEventById } from "../db/events";
import {
  deactivateParticipantStatement,
  findExistingRefs,
  findParticipant,
  findParticipantByRef,
  insertParticipantStatement,
  listParticipants,
  listParticipantsForExport,
  updateParticipantStatement,
  upsertParticipantStatement,
} from "../db/participants";
import type { ParticipantInput, ParticipantRow } from "../db/participants";
import { consumeRateLimit } from "../db/rate-limit";
import { CsvFormatError, escapeCsvCell } from "../domain/csv";
import { decodeCursor, encodeCursor } from "../domain/cursor";
import { newId } from "../domain/ids";
import {
  normalizeEmail,
  normalizePhone,
  parseParticipantCsv,
  participantTemplateCsv,
} from "../domain/participant-import";
import { slugify } from "../domain/slug";
import { authOf, requireEventAccess } from "../http/auth";
import {
  businessRule,
  conflict,
  notFound,
  payloadTooLarge,
  rateLimited,
  validationError,
} from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { parseJsonBody, parsePathParams, parseQuery, readTextBody } from "../http/validate";

/**
 * Participant management (DESAIN_API.md §5).
 *
 * Every route is scoped by `:eventId`. A participant id from another event
 * resolves to 404 because the lookup includes `event_id`; there is no global
 * `/api/participants/:id` surface to leak across events.
 *
 * Deletion is a controlled soft-delete: the caller must send
 * `{ "confirm": true }`, the row is marked inactive (not physically removed),
 * and a later PATCH can restore it.
 */

const EventParamsSchema = z.object({ eventId: EventIdSchema });
const ParticipantParamsSchema = z.object({
  eventId: EventIdSchema,
  participantId: ParticipantIdSchema,
});

const IMPORT_RATE_LIMIT = { windowMs: 60 * 60_000, limit: 10 };

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

function toSummary(row: ParticipantRow): ParticipantSummary {
  return {
    id: row.id,
    externalRef: row.external_ref,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    category: row.category,
    categoryId: row.category_id,
    attributes: parseAttributes(row.attributes_json),
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

async function requireWritableEvent(ctx: RouteContext, eventId: string): Promise<void> {
  const event = await findEventById(ctx.env.DB, eventId);
  if (!event) throw notFound("Acara tidak ditemukan");
  if (event.status === "archived") {
    throw businessRule("Acara yang sudah diarsipkan tidak dapat diubah");
  }
}

async function participantFields(ctx: RouteContext, eventId: string) {
  const rows = await listCustomFields(ctx.env.DB, eventId, {
    scope: "participant",
    status: "all",
  });
  return rows.map((row) => ({
    key: row.key,
    type: row.type,
    required: row.required === 1,
    options: parseOptions(row),
    scope: row.scope,
    status: row.status,
  }));
}

async function resolveCategory(
  ctx: RouteContext,
  eventId: string,
  categoryId: string,
): Promise<{ id: string; name: string }> {
  const category = await findCategory(ctx.env.DB, eventId, categoryId);
  if (!category) throw notFound("Kategori tidak ditemukan pada acara ini");
  if (category.status === "archived") {
    throw businessRule("Kategori yang sudah diarsipkan tidak dapat dipakai peserta baru");
  }
  return { id: category.id, name: category.name };
}

/**
 * Accepts `categoryId` (canonical) or the Q1 UI's `category` name (deprecated).
 * A single-record write with a new name creates that category explicitly — the
 * admin typed it. CSV imports never do this: unknown names reject the row.
 */
async function resolveCategoryInput(
  ctx: RouteContext,
  eventId: string,
  input: { categoryId?: string; category?: string | null },
  actorUserId: string,
): Promise<{
  category: { id: string; name: string };
  createdStatement?: D1PreparedStatement;
  createdAudit?: AuditEntry;
}> {
  if (input.categoryId !== undefined) {
    return { category: await resolveCategory(ctx, eventId, input.categoryId) };
  }

  const name = (input.category ?? "").trim();
  if (name === "") {
    throw validationError("Kategori wajib diisi", { fieldErrors: { categoryId: ["wajib diisi"] } });
  }

  const existing = await findCategoryByName(ctx.env.DB, eventId, name);
  if (existing) {
    if (existing.status === "archived") {
      throw businessRule("Kategori yang sudah diarsipkan tidak dapat dipakai peserta baru");
    }
    return { category: { id: existing.id, name: existing.name } };
  }

  const id = newId(ctx.now);
  const createdStatement = insertCategoryStatement(ctx.env.DB, {
    id,
    themeId: eventId,
    name,
    description: null,
    sortOrder: 0,
    createdBy: actorUserId,
    createdAt: ctx.now,
  });
  const createdAudit = {
    id: newId(ctx.now),
    eventId,
    actorUserId,
    action: "category.created",
    entityType: "category",
    entityId: id,
    after: filterAuditFields("category", {
      name,
      description: null,
      sortOrder: 0,
      status: "active",
      archivedAt: null,
    }),
    createdAt: ctx.now,
  } satisfies AuditEntry;

  return { category: { id, name }, createdStatement, createdAudit };
}

function attributeKeysChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}

function participantSnapshot(input: {
  categoryId: string;
  status: string;
  attributesChanged?: string[];
}): Record<string, unknown> | null {
  return filterAuditFields("participant", {
    categoryId: input.categoryId,
    status: input.status,
    ...(input.attributesChanged === undefined
      ? {}
      : { attributesChanged: input.attributesChanged }),
  });
}

function participantAudit(
  ctx: RouteContext,
  authUserId: string,
  eventId: string,
  action: string,
  participantId: string | null,
  snapshots: { before?: unknown; after?: unknown },
): AuditEntry {
  return {
    id: newId(ctx.now),
    eventId,
    actorUserId: authUserId,
    action,
    entityType: "participant",
    entityId: participantId,
    before: snapshots.before,
    after: snapshots.after,
    createdAt: ctx.now,
  };
}

function buildParticipantInput(body: {
  externalRef?: string | null;
  fullName?: string;
  phone?: string | null;
  email?: string | null;
  categoryId: string;
  attributesJson?: string;
  note?: string | null;
}): ParticipantInput {
  const phone = normalizePhone(body.phone ?? "");
  if (phone.error) {
    throw validationError(phone.error, { fieldErrors: { phone: [phone.error] } });
  }

  const email = normalizeEmail(body.email ?? "");
  if (email.error) {
    throw validationError(email.error, { fieldErrors: { email: [email.error] } });
  }

  return {
    externalRef: optionalText(body.externalRef),
    fullName: normalizeName(body.fullName ?? ""),
    phone: phone.value,
    email: email.value,
    categoryId: body.categoryId,
    attributesJson: body.attributesJson,
    note: optionalText(body.note),
  };
}

async function listEventParticipants(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "participant:read");
  const query = parseQuery(ctx.request, ParticipantListQuerySchema);

  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (query.cursor && !cursor) throw validationError("Cursor tidak valid");

  const rows = await listParticipants(
    ctx.env.DB,
    eventId,
    { query: query.query, status: query.status },
    cursor,
    query.limit,
  );

  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const last = items.at(-1);

  const payload: ParticipantListPayload = {
    items: items.map(toSummary),
    nextCursor:
      hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
  };

  return { data: payload };
}

async function getEventParticipant(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, participantId } = parsePathParams(ctx.params, ParticipantParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "participant:read");
  const row = await findParticipant(ctx.env.DB, eventId, participantId);
  if (!row) throw notFound("Peserta tidak ditemukan pada acara ini");

  const payload: ParticipantDetailPayload = { participant: toSummary(row) };
  return { data: payload };
}

async function createEventParticipant(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "participant:write");
  await requireWritableEvent(ctx, eventId);

  const body = await parseJsonBody(ctx.request, ParticipantCreateRequestSchema);
  const resolvedCategory = await resolveCategoryInput(ctx, eventId, body, auth.user.id);
  const category = resolvedCategory.category;
  const fields = await participantFields(ctx, eventId);
  const attributes = validateParticipantAttributes(fields, body.attributes ?? {});
  if (!attributes.ok) {
    throw businessRule("Atribut peserta tidak valid", {
      fieldErrors: Object.fromEntries(
        attributes.errors.map((error) => [error.key || "attributes", [error.message]]),
      ),
    });
  }

  const input = buildParticipantInput({
    ...body,
    categoryId: category.id,
    attributesJson: JSON.stringify(attributes.value),
  });

  if (input.externalRef) {
    const duplicate = await findParticipantByRef(ctx.env.DB, eventId, input.externalRef);
    if (duplicate) throw conflict("external_ref sudah dipakai peserta lain di acara ini");
  }

  const id = newId(ctx.now);

  try {
    await ctx.env.DB.batch([
      ...(resolvedCategory.createdStatement ? [resolvedCategory.createdStatement] : []),
      ...(resolvedCategory.createdAudit
        ? [insertAuditStatement(ctx.env.DB, resolvedCategory.createdAudit)]
        : []),
      insertParticipantStatement(ctx.env.DB, {
        ...input,
        id,
        eventId,
        createdAt: ctx.now,
      }),
      insertAuditStatement(
        ctx.env.DB,
        participantAudit(ctx, auth.user.id, eventId, "participant.created", id, {
          after: participantSnapshot({ categoryId: category.id, status: "active" }),
        }),
      ),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("external_ref sudah dipakai peserta lain di acara ini");
    }
    throw error;
  }

  const row = await findParticipant(ctx.env.DB, eventId, id);
  if (!row) throw notFound("Peserta tidak ditemukan setelah dibuat");

  const payload: ParticipantDetailPayload = { participant: toSummary(row) };
  return { status: 201, data: payload };
}

async function patchEventParticipant(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, participantId } = parsePathParams(ctx.params, ParticipantParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "participant:write");
  await requireWritableEvent(ctx, eventId);

  const existing = await findParticipant(ctx.env.DB, eventId, participantId);
  if (!existing) throw notFound("Peserta tidak ditemukan pada acara ini");

  const body = await parseJsonBody(ctx.request, ParticipantUpdateRequestSchema);

  const update: Parameters<typeof updateParticipantStatement>[1]["update"] = {};
  let createdCategoryStatement: D1PreparedStatement | undefined;
  let createdCategoryAudit: AuditEntry | undefined;

  if (body.externalRef !== undefined) {
    update.externalRef = optionalText(body.externalRef);
  }
  if (body.fullName !== undefined) {
    update.fullName = normalizeName(body.fullName);
  }
  if (body.phone !== undefined) {
    const phone = normalizePhone(body.phone ?? "");
    if (phone.error) {
      throw validationError(phone.error, { fieldErrors: { phone: [phone.error] } });
    }
    update.phone = phone.value;
  }
  if (body.email !== undefined) {
    const email = normalizeEmail(body.email ?? "");
    if (email.error) {
      throw validationError(email.error, { fieldErrors: { email: [email.error] } });
    }
    update.email = email.value;
  }
  const hasCategoryName =
    body.category !== undefined && body.category !== null && body.category.trim() !== "";
  if (body.categoryId !== undefined || hasCategoryName) {
    const resolved = await resolveCategoryInput(ctx, eventId, body, auth.user.id);
    update.categoryId = resolved.category.id;
    createdCategoryStatement = resolved.createdStatement;
    createdCategoryAudit = resolved.createdAudit;
  }
  if (body.attributes !== undefined) {
    const fields = await participantFields(ctx, eventId);
    const merged = mergeParticipantAttributes(
      parseAttributes(existing.attributes_json),
      body.attributes,
      fields,
    );
    if (!merged.ok) {
      throw businessRule("Atribut peserta tidak valid", {
        fieldErrors: Object.fromEntries(
          merged.errors.map((error) => [error.key || "attributes", [error.message]]),
        ),
      });
    }
    update.attributesJson = JSON.stringify(merged.value);
  }
  if (body.note !== undefined) update.note = optionalText(body.note);
  if (body.status !== undefined) update.status = body.status;

  if (update.externalRef !== undefined && update.externalRef !== existing.external_ref) {
    if (update.externalRef) {
      const duplicate = await findParticipantByRef(
        ctx.env.DB,
        eventId,
        update.externalRef,
        participantId,
      );
      if (duplicate) throw conflict("external_ref sudah dipakai peserta lain di acara ini");
    }
  }

  const nextAttributes =
    update.attributesJson === undefined
      ? parseAttributes(existing.attributes_json)
      : parseAttributes(update.attributesJson);
  const attributesChanged = attributeKeysChanged(
    parseAttributes(existing.attributes_json),
    nextAttributes,
  );

  try {
    const prefixStatements: D1PreparedStatement[] = [];
    if (createdCategoryStatement) prefixStatements.push(createdCategoryStatement);
    if (createdCategoryAudit) {
      prefixStatements.push(insertAuditStatement(ctx.env.DB, createdCategoryAudit));
    }

    const results = await ctx.env.DB.batch([
      ...prefixStatements,
      updateParticipantStatement(ctx.env.DB, {
        eventId,
        participantId,
        update,
        now: ctx.now,
        expectedUpdatedAt: existing.updated_at,
      }),
      insertAuditAfterParticipantUpdateStatement(
        ctx.env.DB,
        participantAudit(ctx, auth.user.id, eventId, "participant.updated", participantId, {
          before: participantSnapshot({
            categoryId: existing.category_id,
            status: existing.status,
          }),
          after: participantSnapshot({
            categoryId: update.categoryId ?? existing.category_id,
            status: update.status ?? existing.status,
            attributesChanged,
          }),
        }),
        participantId,
        ctx.now,
      ),
    ]);

    if ((results[prefixStatements.length]?.meta.changes ?? 0) === 0) {
      throw conflict("Peserta berubah di perangkat lain. Muat ulang lalu coba lagi.");
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict("external_ref sudah dipakai peserta lain di acara ini");
    }
    throw error;
  }

  const row = await findParticipant(ctx.env.DB, eventId, participantId);
  if (!row) throw notFound("Peserta tidak ditemukan pada acara ini");

  const payload: ParticipantDetailPayload = { participant: toSummary(row) };
  return { data: payload };
}

async function deactivateEventParticipant(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId, participantId } = parsePathParams(ctx.params, ParticipantParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "participant:write");
  await requireWritableEvent(ctx, eventId);

  // Deliberate confirmation: deletion is a data-affecting action, so the body
  // must say so explicitly. A stray DELETE from a client cannot deactivate.
  await parseJsonBody(ctx.request, ParticipantDeleteRequestSchema);

  const existing = await findParticipant(ctx.env.DB, eventId, participantId);
  if (!existing) throw notFound("Peserta tidak ditemukan pada acara ini");

  const results = await ctx.env.DB.batch([
    deactivateParticipantStatement(ctx.env.DB, {
      eventId,
      participantId,
      now: ctx.now,
      expectedUpdatedAt: existing.updated_at,
    }),
    insertAuditAfterParticipantUpdateStatement(
      ctx.env.DB,
      participantAudit(ctx, auth.user.id, eventId, "participant.deactivated", participantId, {
        before: participantSnapshot({
          categoryId: existing.category_id,
          status: existing.status,
        }),
        after: participantSnapshot({ categoryId: existing.category_id, status: "inactive" }),
      }),
      participantId,
      ctx.now,
    ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    throw notFound("Peserta tidak ditemukan pada acara ini");
  }

  const payload = { deleted: true as const, status: "inactive" as const };
  return { data: payload };
}

function exportCsv(rows: ParticipantRow[]): string {
  const header = ["external_ref", "full_name", "phone", "email", "category", "note"];
  const lines = [header.join(",")];

  for (const row of rows) {
    const cells = [
      escapeCsvCell(row.external_ref),
      escapeCsvCell(row.full_name),
      // Phone legitimately starts with `+`; do not treat it as a formula.
      escapeCsvCell(row.phone, false),
      escapeCsvCell(row.email),
      escapeCsvCell(row.category),
      escapeCsvCell(row.note),
    ];
    lines.push(cells.join(","));
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function exportEventParticipants(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  const access = await requireEventAccess(ctx.env, auth, eventId, "participant:import");
  const query = parseQuery(ctx.request, ParticipantExportQuerySchema);
  const rows = await listParticipantsForExport(ctx.env.DB, eventId, {
    query: query.query,
    status: query.status,
  });

  return {
    raw: csvResponse(exportCsv(rows), `peserta-${slugify(access.eventName)}.csv`),
  };
}

async function participantTemplate(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "participant:import");

  return { raw: csvResponse(participantTemplateCsv(), "template-peserta.csv") };
}

async function readImportCsv(ctx: RouteContext): Promise<string> {
  const contentType = (ctx.request.headers.get("content-type") ?? "").toLowerCase();

  if (contentType.includes("application/json")) {
    const raw = await readTextBody(
      ctx.request,
      IMPORT_MAX_BYTES,
      "File CSV melebihi batas 2 MB",
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw validationError("Body permintaan bukan JSON yang valid");
    }

    const result = ParticipantImportJsonRequestSchema.safeParse(parsed);
    if (!result.success) {
      throw validationError("Body import tidak valid", {
        fieldErrors: { csv: ["Field csv wajib berisi teks CSV"] },
      });
    }

    return result.data.csv;
  }

  return readTextBody(ctx.request, IMPORT_MAX_BYTES, "File CSV melebihi batas 2 MB");
}

async function importEventParticipants(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "participant:import");
  await requireWritableEvent(ctx, eventId);

  const query = parseQuery(ctx.request, ParticipantImportQuerySchema);
  const dryRun = query.dry_run === "true" || query.dry_run === "1";

  if (!dryRun) {
    const limit = await consumeRateLimit(ctx.env.DB, {
      bucket: `import:${eventId}`,
      now: ctx.now,
      ...IMPORT_RATE_LIMIT,
    });
    if (!limit.allowed) throw rateLimited(limit.retryAfterSeconds);
  }

  const csv = await readImportCsv(ctx);
  if (csv.trim() === "") throw validationError("File CSV kosong");

  let parsed: ReturnType<typeof parseParticipantCsv>;

  try {
    parsed = parseParticipantCsv(csv);
  } catch (error) {
    if (error instanceof CsvFormatError) {
      if (/batas per import/i.test(error.message)) throw payloadTooLarge(error.message);
      throw validationError(error.message, { line: error.line });
    }
    throw error;
  }

  const categories = await listCategories(ctx.env.DB, eventId, "active");
  const byName = new Map(categories.map((category) => [category.name.toLowerCase(), category]));

  const invalid = [...parsed.invalid];
  const resolved = parsed.rows.flatMap((row) => {
    const category = byName.get(row.category.toLowerCase());
    if (!category) {
      invalid.push({
        line: row.line,
        reason: `kategori "${row.category}" tidak ditemukan`,
      });
      return [];
    }
    return [{ ...row, categoryId: category.id, categoryName: category.name }];
  });

  const refs = resolved
    .map((row) => row.externalRef)
    .filter((ref): ref is string => ref !== null);
  const existing = await findExistingRefs(ctx.env.DB, eventId, refs);

  const previewRows: ImportPreviewRow[] = resolved.map((row) => ({
    line: row.line,
    externalRef: row.externalRef,
    fullName: row.fullName,
    phone: row.phone,
    category: row.categoryName,
    categoryId: row.categoryId,
    action: row.externalRef && existing.has(row.externalRef) ? "update" : "create",
  }));

  const created = previewRows.filter((row) => row.action === "create").length;
  const updated = previewRows.length - created;

  if (dryRun) {
    const payload: ParticipantImportPayload = {
      dryRun: true,
      total: parsed.total,
      valid: resolved.length,
      created,
      updated,
      invalid,
      sample: previewRows.slice(0, 10),
    };
    return { data: payload };
  }

  if (resolved.length > 0) {
    const statements = resolved.map((row) => {
      const input: ParticipantInput = {
        externalRef: row.externalRef,
        fullName: row.fullName,
        phone: row.phone,
        email: row.email,
        categoryId: row.categoryId,
        note: row.note,
      };
      const id = newId(ctx.now);

      // Rows with a ref always use the upsert path so a concurrent import with
      // the same file cannot turn an idempotent retry into a 409.
      return row.externalRef !== null
        ? upsertParticipantStatement(ctx.env.DB, {
            ...input,
            id,
            eventId,
            now: ctx.now,
          })
        : insertParticipantStatement(ctx.env.DB, {
            ...input,
            id,
            eventId,
            createdAt: ctx.now,
          });
    });

    // One summary audit row per request instead of one per participant: import
    // writes thousands of rows and the write budget is real.
    const audit = participantAudit(
      ctx,
      auth.user.id,
      eventId,
      "participant.imported",
      null,
      {
        after: {
          total: parsed.total,
          created,
          updated,
          skipped: invalid.length,
        },
      },
    );

    try {
      await ctx.env.DB.batch([...statements, insertAuditStatement(ctx.env.DB, audit)]);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("Import bentrok dengan perubahan lain. Muat ulang lalu coba lagi.");
      }
      throw error;
    }
  }

  const payload: ParticipantImportPayload = {
    dryRun: false,
    total: parsed.total,
    valid: resolved.length,
    created,
    updated,
    skipped: invalid.length,
    invalid,
  };

  return { data: payload };
}

export const participantRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    pattern: "/api/events/:eventId/participants",
    public: false,
    handler: listEventParticipants,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/participants",
    public: false,
    handler: createEventParticipant,
  },
  {
    method: "GET",
    pattern: "/api/events/:eventId/participants/export",
    public: false,
    handler: exportEventParticipants,
  },
  {
    method: "GET",
    pattern: "/api/events/:eventId/participants/template",
    public: false,
    handler: participantTemplate,
  },
  {
    method: "POST",
    pattern: "/api/events/:eventId/participants/import",
    public: false,
    handler: importEventParticipants,
  },
  {
    method: "GET",
    pattern: "/api/events/:eventId/participants/:participantId",
    public: false,
    handler: getEventParticipant,
  },
  {
    method: "PATCH",
    pattern: "/api/events/:eventId/participants/:participantId",
    public: false,
    handler: patchEventParticipant,
  },
  {
    method: "DELETE",
    pattern: "/api/events/:eventId/participants/:participantId",
    public: false,
    handler: deactivateEventParticipant,
  },
];
