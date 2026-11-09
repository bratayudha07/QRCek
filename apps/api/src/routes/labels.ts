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
  listParticipantsByIdsForLabels,
  listParticipantsForLabels,
} from "../db/participants";
import type { ParticipantRow } from "../db/participants";
import {
  insertQrIdentityStatement,
  legacyQrCredential,
  listIdentitiesForParticipants,
} from "../db/qr-identities";
import type { QrIdentityRow } from "../db/qr-identities";
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
 * Participant QR labels (DESAIN_API.md §5, Tahap 4 + Q4).
 *
 * `POST /participants/qr-labels` is the only place a QR credential is created
 * or read in bulk. It is a POST even though it mostly reads, because the first
 * call issues credentials — a GET must never have that side effect.
 *
 * Since `0010_qr_identities.sql` the source of truth is `qr_identities`. Rows
 * written by an older deployment are promoted on first contact without changing
 * their token, so already-printed cards keep working during the deploy window.
 *
 * The response contains the scan payload (`absensi:v1:<token>`), never the raw
 * token, the hash, the ciphertext, or a key. Logs and audit metadata likewise
 * record counts only.
 */

const EventParamsSchema = z.object({ eventId: EventIdSchema });

/**
 * D1 accepts at most 100 SQL statements per `batch` call. The page itself is
 * capped at `QR_LABEL_BATCH_MAX` (40) so the whole invocation stays under the
 * free-tier 50-statement limit after auth and audit queries.
 */
const CLAIM_BATCH_SIZE = 40;

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

interface LabelPlan {
  row: ParticipantRow;
  /** Token already in memory (fresh issue or promoted legacy credential). */
  token: string | null;
  /** Insert to run before reading labels; null when the identity exists. */
  statement: D1PreparedStatement | null;
  /** True only when this invocation generated a brand-new token. */
  newIssue: boolean;
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

  const identityRows = await listIdentitiesForParticipants(
    ctx.env.DB,
    eventId,
    page.map((row) => row.id),
  );
  const identities = new Map<string, QrIdentityRow>(
    identityRows.map((identity) => [identity.participant_id, identity]),
  );

  const plans: LabelPlan[] = [];

  for (const row of page) {
    if (identities.has(row.id)) {
      plans.push({ row, token: null, statement: null, newIssue: false });
      continue;
    }

    // A credential written by an older deployment is copied as-is: the printed
    // card must keep working, so promotion never generates a new token.
    const legacy = legacyQrCredential(row);
    if (legacy) {
      const token = await readQrCredentialToken(config, legacy.credential).catch(
        (error: unknown) => qrFailure(error),
      );

      plans.push({
        row,
        token,
        newIssue: false,
        statement: insertQrIdentityStatement(ctx.env.DB, {
          id: newId(ctx.now),
          themeId: eventId,
          participantId: row.id,
          credential: legacy.credential,
          issuedAt: legacy.issuedAt,
        }),
      });
      continue;
    }

    const { token, credential } = await issueQrCredential(config).catch((error: unknown) =>
      qrFailure(error),
    );

    plans.push({
      row,
      token,
      newIssue: true,
      statement: insertQrIdentityStatement(ctx.env.DB, {
        id: newId(ctx.now),
        themeId: eventId,
        participantId: row.id,
        credential,
        issuedAt: ctx.now,
      }),
    });
  }

  const owners = plans.filter((plan) => plan.statement !== null);
  const statements = owners.map((plan) => plan.statement as D1PreparedStatement);

  let issuedCount = 0;
  let promotedCount = 0;
  const lostIds: string[] = [];

  for (let offset = 0; offset < statements.length; offset += CLAIM_BATCH_SIZE) {
    const chunk = statements.slice(offset, offset + CLAIM_BATCH_SIZE);
    const results = await ctx.env.DB.batch(chunk);

    results.forEach((result, index) => {
      const plan = owners[offset + index];
      if (!plan) return;

      if ((result.meta.changes ?? 0) > 0) {
        if (plan.newIssue) issuedCount += 1;
        else promotedCount += 1;
        return;
      }

      // Another printer wrote the identity between our SELECT and INSERT.
      // Drop our token and adopt theirs below; never rotate.
      plan.token = null;
      plan.statement = null;
      lostIds.push(plan.row.id);
    });
  }

  if (lostIds.length > 0) {
    const winners = await listIdentitiesForParticipants(ctx.env.DB, eventId, lostIds);
    for (const winner of winners) identities.set(winner.participant_id, winner);
  }

  const labels: QrLabelItem[] = [];

  for (const plan of plans) {
    let token = plan.token;

    if (token === null) {
      const identity = identities.get(plan.row.id);
      if (!identity) {
        throw new ApiError(500, "INTERNAL", "Identitas QR peserta hilang saat membaca label");
      }

      try {
        token = await readQrCredentialToken(config, {
          ciphertext: identity.ciphertext,
          nonce: identity.nonce,
          keyVersion: identity.key_version,
        });
      } catch (error) {
        qrFailure(error);
      }    }

    labels.push({
      participantId: plan.row.id,
      qr: encodeQrPayload(token),
      values: labelValues(plan.row, fields),
    });
  }

  const ipHash = await clientIpHash(ctx.request, ctx.env.SESSION_PEPPER);

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
      reused: labels.length - issuedCount - promotedCount,
      promoted: promotedCount,
      format: body.format,
      fields,
      showEventName,
      selection: body.participantIds ? "explicit" : "all",
    },
    ipHash,
    createdAt: ctx.now,
  });

  // Lazy issuance is audited once per request, not once per participant: a
  // per-participant audit row would double the statement count and break the
  // free-tier limit. The count is enough to prove that credentials were created.
  if (issuedCount > 0) {
    await recordAudit(ctx.env.DB, {
      id: newId(ctx.now),
      eventId,
      actorUserId: auth.user.id,
      action: "qr.identity_issued",
      entityType: "event",
      entityId: eventId,
      after: { count: issuedCount },
      ipHash,
      createdAt: ctx.now,
    });
  }

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
