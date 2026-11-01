import { z } from "zod";

import type { LabelConfigPayload, LabelFieldKey, QrLabelItem, QrLabelPayload } from "@absensi/shared";
import {
  EventIdSchema,
  LabelConfigRequestSchema,
  QrLabelRequestSchema,
  formatLabelValue,
  labelFieldMeta,
} from "@absensi/shared";

import { recordAudit } from "../db/audit";
import { findEventById } from "../db/events";
import { findLabelConfig, saveLabelConfig } from "../db/label-config";
import {
  claimQrCredentialStatement,
  findParticipant,
  listParticipantsByIdsForLabels,
  listParticipantsForLabels,
} from "../db/participants";
import type { ParticipantRow } from "../db/participants";
import { decodeCursor, encodeCursor } from "../domain/cursor";
import { newId } from "../domain/ids";
import {
  QrConfigError,
  encodeQrPayload,
  issueQrCredential,
  qrKeyConfig,
  readQrCredentialToken,
} from "../domain/qr-token";
import type { QrKeyConfig } from "../domain/qr-token";
import { authOf, requireEventAccess } from "../http/auth";
import { ApiError, businessRule, notFound, validationError } from "../http/errors";
import type { RouteContext, RouteDefinition, RouteResult } from "../http/router";
import { clientIpHash } from "../http/security";
import { parseJsonBody, parsePathParams } from "../http/validate";

/**
 * Participant QR labels (DESAIN_API.md §5, Tahap 4).
 *
 * `POST /participants/qr-labels` is the only place a QR credential is created
 * or read. It is a POST even though it mostly reads, because the first call
 * issues credentials — a GET must never have that side effect.
 *
 * The response contains the scan payload (`absensi:v1:<token>`), never the raw
 * token, the hash, the ciphertext, or a key. Logs and audit metadata likewise
 * record counts only.
 */

const EventParamsSchema = z.object({ eventId: EventIdSchema });

/**
 * D1 accepts at most 100 SQL statements per `batch` call. Credential claims are
 * chunked below that so a full 50-label page keeps a wide margin (and older
 * deployments that still allowed 100 would not break at the D1 limit).
 */
const CLAIM_BATCH_SIZE = 50;

/**
 * Configuration failures are 500s on purpose: they mean the Worker is missing a
 * secret or is pointed at the wrong key generation, not that the request was
 * bad. The message tells the operator what to check without echoing a secret.
 */
function qrFailure(error: unknown): never {
  if (error instanceof QrConfigError) {
    console.error("qr_credential_error", { reason: error.message });
    throw new ApiError(
      500,
      "INTERNAL",
      "Kredensial QR tidak dapat diproses. Periksa konfigurasi server lalu coba lagi.",
    );
  }

  throw error;
}

function rawFieldValue(row: ParticipantRow, key: LabelFieldKey): string | null {
  switch (key) {
    case "fullName":
      return row.full_name;
    case "externalRef":
      return row.external_ref;
    case "category":
      return row.category;
    case "phone":
      return row.phone;
    case "email":
      return row.email;
    case "note":
      return row.note;
  }
}

/** Only non-empty values are returned, so the UI never prints a blank line. */
function labelValues(
  row: ParticipantRow,
  fields: readonly LabelFieldKey[],
): Partial<Record<LabelFieldKey, string>> {
  const values: Partial<Record<LabelFieldKey, string>> = {};

  for (const key of fields) {
    const value = formatLabelValue(rawFieldValue(row, key), labelFieldMeta(key).maxLength);
    if (value !== "") values[key] = value;
  }

  return values;
}

async function issueEventParticipantLabels(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  // Event-scoped authorization: non-members get 404, low roles get 403, and a
  // participant id from another event is never even queried.
  const access = await requireEventAccess(ctx.env, auth, eventId, "qr:print");

  const body = await parseJsonBody(ctx.request, QrLabelRequestSchema);

  const stored = await findLabelConfig(ctx.env.DB, eventId);
  const fields = body.fields ?? stored.fields;
  const showEventName = body.showEventName ?? stored.showEventName;

  const cursor = body.cursor ? decodeCursor(body.cursor) : null;
  if (body.cursor && !cursor) throw validationError("Cursor tidak valid");

  const rows = body.participantIds
    ? await listParticipantsByIdsForLabels(ctx.env.DB, eventId, body.participantIds)
    : await listParticipantsForLabels(ctx.env.DB, eventId, cursor, body.limit);

  const hasMore = body.participantIds ? false : rows.length > body.limit;
  const page = hasMore ? rows.slice(0, body.limit) : rows;

  const last = page.at(-1);
  const nextCursor =
    hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;

  if (page.length === 0) {
    const empty: QrLabelPayload = {
      event: { id: eventId, name: access.eventName },
      format: body.format,
      fields,
      showEventName,
      labels: [],
      nextCursor: null,
    };
    return { data: empty };
  }

  let config: QrKeyConfig;
  try {
    config = await qrKeyConfig(ctx.env);
  } catch (error) {
    qrFailure(error);
  }

  const claims: D1PreparedStatement[] = [];
  const claimedIds: string[] = [];
  const issuedTokens = new Map<string, string>();
  let issuedCount = 0;

  for (const row of page) {
    if (row.qr_token_hash !== null) continue;

    try {
      const { token, credential } = await issueQrCredential(config);
      issuedTokens.set(row.id, token);
      claims.push(
        claimQrCredentialStatement(ctx.env.DB, eventId, row.id, credential, ctx.now),
      );
      claimedIds.push(row.id);
    } catch (error) {
      qrFailure(error);
    }
  }

  const lostIds: string[] = [];

  for (let offset = 0; offset < claims.length; offset += CLAIM_BATCH_SIZE) {
    const chunk = claims.slice(offset, offset + CLAIM_BATCH_SIZE);
    const results = await ctx.env.DB.batch(chunk);

    results.forEach((result, index) => {
      const id = claimedIds[offset + index];
      if (!id) return;

      if ((result.meta.changes ?? 0) > 0) {
        issuedCount += 1;
        return;
      }

      // Another printer wrote the credential between our SELECT and UPDATE.
      // Drop our token and adopt theirs below; never rotate.
      issuedTokens.delete(id);
      lostIds.push(id);
    });
  }

  if (lostIds.length > 0) {
    for (const id of lostIds) {
      const winner = await findParticipant(ctx.env.DB, eventId, id);
      if (!winner) throw new ApiError(500, "INTERNAL", "Peserta hilang saat menerbitkan QR");

      const index = page.findIndex((row) => row.id === id);
      if (index >= 0) page[index] = winner;
    }
  }

  const labels: QrLabelItem[] = [];

  for (const row of page) {
    let token = issuedTokens.get(row.id);

    if (token === undefined) {
      try {
        token = await readQrCredentialToken(config, {
          ciphertext: row.qr_token_ciphertext,
          nonce: row.qr_token_nonce,
          keyVersion: row.qr_key_version,
        });
      } catch (error) {
        qrFailure(error);
      }
    }

    labels.push({
      participantId: row.id,
      qr: encodeQrPayload(token),
      values: labelValues(row, fields),
    });
  }

  await recordAudit(ctx.env.DB, {
    id: newId(ctx.now),
    eventId,
    actorUserId: auth.user.id,
    action: "qr.labels_exported",
    entityType: "event",
    entityId: eventId,
    after: {
      count: labels.length,
      issued: issuedCount,
      reused: labels.length - issuedCount,
      format: body.format,
      fields,
      showEventName,
      selection: body.participantIds ? "explicit" : "all",
    },
    ipHash: await clientIpHash(ctx.request, ctx.env.SESSION_PEPPER),
    createdAt: ctx.now,
  });

  const payload: QrLabelPayload = {
    event: { id: eventId, name: access.eventName },
    format: body.format,
    fields,
    showEventName,
    labels,
    nextCursor,
  };

  return { data: payload };
}

async function getEventLabelConfig(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "event:read");

  const payload: LabelConfigPayload = await findLabelConfig(ctx.env.DB, eventId);
  return { data: payload };
}

async function putEventLabelConfig(ctx: RouteContext): Promise<RouteResult> {
  const auth = authOf(ctx);
  const { eventId } = parsePathParams(ctx.params, EventParamsSchema);

  await requireEventAccess(ctx.env, auth, eventId, "qr:print");

  const event = await findEventById(ctx.env.DB, eventId);
  if (!event) throw notFound("Acara tidak ditemukan");
  if (event.status === "archived") {
    throw businessRule("Acara yang sudah diarsipkan tidak dapat diubah");
  }

  const body = await parseJsonBody(ctx.request, LabelConfigRequestSchema);

  const payload = await saveLabelConfig(
    ctx.env.DB,
    eventId,
    { fields: body.fields, showEventName: body.showEventName },
    auth.user.id,
    ctx.now,
  );

  return { data: payload };
}

export const labelRoutes: readonly RouteDefinition[] = [
  {
    method: "POST",
    pattern: "/api/events/:eventId/participants/qr-labels",
    public: false,
    handler: issueEventParticipantLabels,
  },
  {
    method: "GET",
    pattern: "/api/events/:eventId/label-config",
    public: false,
    handler: getEventLabelConfig,
  },
  {
    method: "PUT",
    pattern: "/api/events/:eventId/label-config",
    public: false,
    handler: putEventLabelConfig,
  },
];
