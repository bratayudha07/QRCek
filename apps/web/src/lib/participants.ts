import type {
  ParticipantCreateRequest,
  ParticipantDeletePayload,
  ParticipantDetailPayload,
  ParticipantImportPayload,
  ParticipantListPayload,
  ParticipantStatus,
  ParticipantUpdateRequest,
} from "@absensi/shared";

import { apiUrl } from "./api";
import { apiRequest } from "./http";

/** Typed bindings for `/api/events/:eventId/participants`. */

export interface ParticipantListParams {
  query?: string;
  status?: ParticipantStatus | "all";
  limit?: number;
  cursor?: string;
}

/**
 * Builds the list query string. Pure so it can be unit tested: pagination bugs
 * (dropping the cursor, sending an empty `query=`) are easy to introduce.
 */
export function participantListPath(eventId: string, params: ParticipantListParams = {}): string {
  const search = new URLSearchParams();

  const query = params.query?.trim();
  if (query) search.set("query", query);
  if (params.status) search.set("status", params.status);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);

  const suffix = search.toString();

  return `/api/events/${encodeURIComponent(eventId)}/participants${suffix ? `?${suffix}` : ""}`;
}

export function participantExportUrl(eventId: string, params: { query?: string; status?: string } = {}) {
  const search = new URLSearchParams();

  const query = params.query?.trim();
  if (query) search.set("query", query);
  if (params.status) search.set("status", params.status);

  const suffix = search.toString();

  return apiUrl(
    `/api/events/${encodeURIComponent(eventId)}/participants/export${suffix ? `?${suffix}` : ""}`,
  );
}

export function participantTemplateUrl(eventId: string): string {
  return apiUrl(`/api/events/${encodeURIComponent(eventId)}/participants/template`);
}

export function listParticipants(eventId: string, params: ParticipantListParams = {}) {
  return apiRequest<ParticipantListPayload>(participantListPath(eventId, params));
}

export function getParticipant(eventId: string, participantId: string) {
  return apiRequest<ParticipantDetailPayload>(
    `/api/events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(participantId)}`,
  );
}

export function createParticipant(eventId: string, input: ParticipantCreateRequest) {
  return apiRequest<ParticipantDetailPayload>(
    `/api/events/${encodeURIComponent(eventId)}/participants`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function updateParticipant(
  eventId: string,
  participantId: string,
  input: ParticipantUpdateRequest,
) {
  return apiRequest<ParticipantDetailPayload>(
    `/api/events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(participantId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function deactivateParticipant(eventId: string, participantId: string) {
  return apiRequest<ParticipantDeletePayload>(
    `/api/events/${encodeURIComponent(eventId)}/participants/${encodeURIComponent(participantId)}`,
    { method: "DELETE", body: JSON.stringify({ confirm: true }) },
  );
}

/**
 * CSV import. Defaults to preview (`dry_run=true`); `confirm` must be passed
 * explicitly, so a stray call can never write rows (DESAIN_API.md §5).
 */
export function importParticipants(
  eventId: string,
  csv: string,
  options: { confirm?: boolean } = {},
) {
  const query = options.confirm ? "?dry_run=false" : "?dry_run=true";

  return apiRequest<ParticipantImportPayload>(
    `/api/events/${encodeURIComponent(eventId)}/participants/import${query}`,
    {
      method: "POST",
      body: csv,
      headers: { "content-type": "text/csv; charset=utf-8" },
    },
  );
}
