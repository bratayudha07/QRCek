/**
 * Consumption quota contracts (Q7, D-014, BR-041–BR-044).
 *
 * Quota is per Aktivitas per peserta and counts every effective Consumption
 * transaction of that Aktivitas across its Sesi (A1). The effective value is
 * resolved individual → category → Aktivitas; `activities.quota` is the default
 * and is `null` for an `attendance` Aktivitas.
 *
 * Response shapes live here so the web client and the Worker cannot drift; the
 * resolver itself is pure and lives in `apps/api/src/domain/consumption.ts`.
 */

export interface ConsumptionQuotaCategoryOverride {
  categoryId: string;
  quota: number;
}

export interface ConsumptionQuotaParticipantOverride {
  participantId: string;
  quota: number;
}

/** Effective usage of one participant, for the admin quota screen. */
export interface ConsumptionQuotaUsage {
  participantId: string;
  used: number;
}

export interface ConsumptionQuotaPayload {
  activityId: string;
  /** `activities.quota`; always a number for a `consumption` Aktivitas. */
  defaultQuota: number;
  categoryOverrides: ConsumptionQuotaCategoryOverride[];
  participantOverrides: ConsumptionQuotaParticipantOverride[];
  /** Bounded by the route's usage limit; never the whole participant table. */
  usage: ConsumptionQuotaUsage[];
}

export interface ConsumptionQuotaDefaultPayload {
  activityId: string;
  quota: number;
}

/**
 * Bulk results echo the requested cells. `quota: null` means "remove the
 * override", so the effective value falls back to the next level.
 */
export interface ConsumptionCategoryQuotaRulesPayload {
  activityId: string;
  rules: Array<{ categoryId: string; quota: number | null }>;
}

export interface ConsumptionParticipantQuotaRulesPayload {
  activityId: string;
  rules: Array<{ participantId: string; quota: number | null }>;
}

/** Scanner/Manual Entry copy for Consumption (A4, D-011, D-013). */
export const CONSUMPTION_MESSAGES = {
  success: "Konsumsi tercatat",
  duplicate: "Sudah diambil",
  quotaExhausted: "Sudah diambil",
} as const;
