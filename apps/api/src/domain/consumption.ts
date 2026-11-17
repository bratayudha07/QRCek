import type { ScanReason } from "@absensi/shared";
import { CONSUMPTION_MESSAGES } from "@absensi/shared";

import { scanMessage } from "./transactions";

/**
 * Pure consumption quota rules (Q7, D-014, BR-041–BR-044, BR-073).
 *
 * The route performs the lookups; every decision here is a table so it can be
 * tested without D1, a clock, or a Worker. The database still owns the ceiling
 * (`trg_transaction_consumption_quota`); these helpers only decide the slot and
 * the result code so two parallel requests get a business answer instead of a
 * driver error.
 */

/** Only one rejection exists for quota; duplication keeps its own reason. */
export type QuotaRejection = "quota_exhausted";

export interface QuotaLevels {
  /** `activities.quota`; `null` only for an `attendance` Aktivitas. */
  activityQuota: number | null;
  categoryOverride: number | null;
  participantOverride: number | null;
}

/**
 * Effective quota: individual override wins over the category override, which
 * wins over the Aktivitas default (FR-084). `0` is a real value, not "inherit";
 * `null` means the level is absent.
 */
export function resolveQuota(input: QuotaLevels): number | null {
  if (input.participantOverride !== null) return input.participantOverride;
  if (input.categoryOverride !== null) return input.categoryOverride;
  return input.activityQuota;
}

/**
 * `null` when the next transaction still fits, `"quota_exhausted"` when the
 * effective set already reached the quota. A quota of `0` therefore rejects the
 * first transaction; an absent quota never rejects.
 */
export function quotaRejection(input: {
  used: number;
  quota: number | null;
}): QuotaRejection | null {
  if (input.quota === null) return null;
  return input.used >= input.quota ? "quota_exhausted" : null;
}

/**
 * Lowest free slot number for one participant in one Aktivitas. Reversal removes
 * the row from the effective set, so the freed number is reused rather than
 * skipped (BR-073); counting `used + 1` would collide with a later slot when a
 * middle slot was reversed. The partial unique index still rejects a duplicate
 * slot from a parallel request.
 */
export function nextSlotNo(input: { usedSlots: readonly number[] }): number {
  const taken = new Set(input.usedSlots);
  let slot = 1;
  while (taken.has(slot)) slot += 1;
  return slot;
}

/**
 * The quota trigger raises `RAISE(ABORT, 'consumption quota exhausted')`, which
 * D1 surfaces as a driver error. Matching the message is the only way to tell it
 * apart from a CHECK/FK failure, which must stay a 500 (ADR-0019).
 */
export function isQuotaExhaustedError(error: unknown): boolean {
  return (
    error instanceof Error && /consumption quota exhausted/i.test(error.message)
  );
}

/**
 * Scanner copy for a Consumption context (A4, D-011, D-013). Lifecycle and
 * entitlement rejections keep the Attendance wording because the cause is the
 * same; only the "already taken" case has consumption-specific copy.
 */
export function consumptionMessage(reason: ScanReason | null): string {
  if (reason === null) return CONSUMPTION_MESSAGES.success;
  if (reason === "duplicate") return CONSUMPTION_MESSAGES.duplicate;
  if (reason === "quota_exhausted") return CONSUMPTION_MESSAGES.quotaExhausted;
  return scanMessage(reason);
}
