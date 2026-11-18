import type {
  CategorySummary,
  ConsumptionCategoryQuotaRulesPayload,
  ConsumptionCategoryQuotaRulesRequest,
  ConsumptionManualRequest,
  ConsumptionParticipantQuotaRulesPayload,
  ConsumptionParticipantQuotaRulesRequest,
  ConsumptionQuotaDefaultPayload,
  ConsumptionQuotaPayload,
  EventAccessRole,
  StaffContext,
  TransactionDetailPayload,
  TransactionSource,
} from "@absensi/shared";

import { apiRequest } from "./http";

/**
 * Typed bindings and pure helpers for the Q7 consumption UI
 * (DESAIN_API.md §6–§7, D-014, BR-041–BR-044).
 *
 * The Worker owns every rule: the ceiling, the resolver, and whether a scope is
 * writable. This module only builds paths, mirrors the resolver for display, and
 * validates what the admin typed before sending it.
 */

function activityBasePath(eventId: string, activityId: string): string {
  return `/api/events/${encodeURIComponent(eventId)}/activities/${encodeURIComponent(activityId)}`;
}

export function activityQuotaPath(eventId: string, activityId: string): string {
  return `${activityBasePath(eventId, activityId)}/quota`;
}

export function categoryQuotaPath(eventId: string, activityId: string): string {
  return `${activityQuotaPath(eventId, activityId)}/categories`;
}

export function participantQuotaPath(eventId: string, activityId: string): string {
  return `${activityQuotaPath(eventId, activityId)}/participants`;
}

export function consumptionManualPath(eventId: string): string {
  return `/api/events/${encodeURIComponent(eventId)}/consumption/manual`;
}

export function getActivityQuota(eventId: string, activityId: string) {
  return apiRequest<ConsumptionQuotaPayload>(activityQuotaPath(eventId, activityId));
}

export function saveDefaultQuota(eventId: string, activityId: string, quota: number) {
  return apiRequest<ConsumptionQuotaDefaultPayload>(activityQuotaPath(eventId, activityId), {
    method: "PUT",
    body: JSON.stringify({ quota }),
  });
}

export function saveCategoryQuotas(
  eventId: string,
  activityId: string,
  input: ConsumptionCategoryQuotaRulesRequest,
) {
  return apiRequest<ConsumptionCategoryQuotaRulesPayload>(
    categoryQuotaPath(eventId, activityId),
    { method: "PUT", body: JSON.stringify(input) },
  );
}

export function saveParticipantQuotas(
  eventId: string,
  activityId: string,
  input: ConsumptionParticipantQuotaRulesRequest,
) {
  return apiRequest<ConsumptionParticipantQuotaRulesPayload>(
    participantQuotaPath(eventId, activityId),
    { method: "PUT", body: JSON.stringify(input) },
  );
}

export function createManualConsumption(
  eventId: string,
  input: ConsumptionManualRequest,
) {
  return apiRequest<TransactionDetailPayload>(consumptionManualPath(eventId), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/* ───────────────────────────────── quota display helpers ─────────────────── */

export const QUOTA_MAX = 100_000;

export interface QuotaLevels {
  activityQuota: number;
  categoryOverride: number | null;
  participantOverride: number | null;
}

/**
 * Mirror of `resolveQuota` in `apps/api/src/domain/consumption.ts`, used only to
 * preview the effective value. Individual beats category beats the Aktivitas
 * default, and `0` is a real value, not "inherit".
 */
export function resolveEffectiveQuota(levels: QuotaLevels): number {
  if (levels.participantOverride !== null) return levels.participantOverride;
  if (levels.categoryOverride !== null) return levels.categoryOverride;
  return levels.activityQuota;
}

export type QuotaInputResult =
  | { ok: true; quota: number }
  | { ok: false; message: string };

/**
 * Parses the quota field. `Number("")` is `0`, so an empty field must be
 * rejected explicitly instead of silently disabling distribution.
 */
export function parseQuotaInput(raw: string): QuotaInputResult {
  const value = raw.trim();
  if (value === "") return { ok: false, message: "Kuota wajib diisi" };
  if (!/^\d+$/.test(value)) return { ok: false, message: "Kuota harus bilangan bulat 0 atau lebih" };

  const quota = Number(value);
  if (!Number.isSafeInteger(quota) || quota > QUOTA_MAX) {
    return { ok: false, message: `Kuota maksimal ${QUOTA_MAX}` };
  }

  return { ok: true, quota };
}

/** "3 dari 5" — usage is always shown against the effective quota. */
export function quotaUsageLabel(used: number, quota: number): string {
  return `${used} dari ${quota}`;
}

export interface CategoryQuotaRow {
  categoryId: string;
  name: string;
  quota: number;
}

/**
 * Only categories that actually carry an override are listed; the rest inherit
 * the Aktivitas default. A category archived after the override was written is
 * still shown, otherwise the admin could not remove it.
 */
export function categoryQuotaRows(
  payload: Pick<ConsumptionQuotaPayload, "categoryOverrides">,
  categories: readonly CategorySummary[],
): CategoryQuotaRow[] {
  const names = new Map(categories.map((category) => [category.id, category.name]));

  return payload.categoryOverrides
    .map((override) => ({
      categoryId: override.categoryId,
      name: names.get(override.categoryId) ?? "Kategori tidak dikenal",
      quota: override.quota,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "id"));
}

export interface ParticipantQuotaRow {
  participantId: string;
  name: string;
  quota: number;
  used: number | null;
}

/**
 * Participant overrides with their usage when the payload's bounded usage slice
 * covers them. A participant outside that slice shows `null` instead of a
 * misleading `0`.
 */
export function participantQuotaRows(
  payload: Pick<ConsumptionQuotaPayload, "participantOverrides" | "usage">,
  names: ReadonlyMap<string, string>,
): ParticipantQuotaRow[] {
  const usage = new Map(payload.usage.map((row) => [row.participantId, row.used]));

  return payload.participantOverrides
    .map((override) => ({
      participantId: override.participantId,
      name: names.get(override.participantId) ?? "Peserta di luar daftar",
      quota: override.quota,
      used: usage.get(override.participantId) ?? null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "id"));
}

/* ─────────────────────────────── manual consumption ──────────────────────── */

/**
 * Manual Entry for Consumption: no `status`, and the Aktivitas/Sesi come from the
 * active scanner context. The Worker still validates the context and the quota.
 */
export function consumptionManualRequest(
  context: StaffContext,
  participantId: string,
  note: string | null | undefined,
): ConsumptionManualRequest {
  const trimmedNote = note?.trim() ?? "";

  return {
    participantId,
    activityId: context.activityId,
    ...(context.sessionId !== null ? { sessionId: context.sessionId } : {}),
    ...(trimmedNote ? { note: trimmedNote } : {}),
  };
}

export function consumptionManualSuccessMessage(
  participantName: string,
  slotNo: number | null,
): string {
  return slotNo === null
    ? `Konsumsi tercatat untuk ${participantName}.`
    : `Konsumsi tercatat untuk ${participantName} (porsi ${slotNo}).`;
}

/**
 * Reversal is an Admin Acara action. Super Admin is read-only across Temas and
 * Petugas never corrects, so neither may see the action (D-006, D-024).
 */
export function canReverseConsumption(accessRole: EventAccessRole): boolean {
  return accessRole === "event_admin";
}

export function consumptionSourceLabel(source: TransactionSource): string {
  return source === "qr_scan" ? "Scan QR" : "Input manual";
}
