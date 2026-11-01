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
} from "@absensi/shared";

import { findEventById } from "../db/events";
import {
  deactivateParticipant,
  findExistingRefs,
  findParticipant,
  findParticipantByRef,
  insertParticipantStatement,
  listParticipants,
  listParticipantsForExport,
  updateParticipant,
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

function toSummary(row: ParticipantRow): ParticipantSummary {
  return {
    id: row.id,
    externalRef: row.external_ref,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    category: row.category,
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

function buildParticipantInput(body: {
  externalRef?: string | null;
  fullName?: string;
  phone?: string | null;
  email?: string | null;
  category?: string | null;
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
    category: optionalText(body.category),
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
  const input = buildParticipantInput(body);

  if (input.externalRef) {
    const duplicate = await findParticipantByRef(ctx.env.DB, eventId, input.externalRef);
    if (duplicate) throw conflict("external_ref sudah dipakai peserta lain di acara ini");
  }

  const id = newId(ctx.now);

  try {
    await insertParticipantStatement(ctx.env.DB, {
      ...input,
      id,
      eventId,
      createdAt: ctx.now,
    }).run();
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

  const update: Parameters<typeof updateParticipant>[3] = {};

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
  if (body.category !== undefined) update.category = optionalText(body.category);
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

  try {
    await updateParticipant(ctx.env.DB, eventId, participantId, update, ctx.now);
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

  const changes = await deactivateParticipant(ctx.env.DB, eventId, participantId, ctx.now);
  if (changes === 0) throw notFound("Peserta tidak ditemukan pada acara ini");

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

  const refs = parsed.rows
    .map((row) => row.externalRef)
    .filter((ref): ref is string => ref !== null);
  const existing = await findExistingRefs(ctx.env.DB, eventId, refs);

  const previewRows: ImportPreviewRow[] = parsed.rows.map((row) => ({
    line: row.line,
    externalRef: row.externalRef,
    fullName: row.fullName,
    phone: row.phone,
    category: row.category,
    action: row.externalRef && existing.has(row.externalRef) ? "update" : "create",
  }));

  const created = previewRows.filter((row) => row.action === "create").length;
  const updated = previewRows.length - created;

  if (dryRun) {
    const payload: ParticipantImportPayload = {
      dryRun: true,
      total: parsed.total,
      valid: parsed.rows.length,
      created,
      updated,
      invalid: parsed.invalid,
      sample: previewRows.slice(0, 10),
    };
    return { data: payload };
  }

  if (parsed.rows.length > 0) {
    const statements = parsed.rows.map((row) => {
      const input: ParticipantInput = {
        externalRef: row.externalRef,
        fullName: row.fullName,
        phone: row.phone,
        email: row.email,
        category: row.category,
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

    try {
      await ctx.env.DB.batch(statements);
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
    valid: parsed.rows.length,
    created,
    updated,
    skipped: parsed.invalid.length,
    invalid: parsed.invalid,
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
