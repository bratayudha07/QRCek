import { describe, expect, it } from "vitest";

import {
  consumptionMessage,
  isQuotaExhaustedError,
  nextSlotNo,
  quotaRejection,
  resolveQuota,
} from "./consumption";

/**
 * Pure quota rules (Q7, D-014, BR-041–BR-044, BR-073).
 *
 * No D1 and no clock: each assertion is a row of the decision table the routes
 * rely on. The database trigger is tested separately in
 * `apps/api/src/test/consumption.db.test.ts`.
 */

describe("resolveQuota", () => {
  it("prefers the participant override over every other level", () => {
    expect(
      resolveQuota({
        activityQuota: 1,
        categoryOverride: 2,
        participantOverride: 3,
      }),
    ).toBe(3);
  });

  it("falls back to the category override, then the Aktivitas default", () => {
    expect(
      resolveQuota({
        activityQuota: 1,
        categoryOverride: 2,
        participantOverride: null,
      }),
    ).toBe(2);

    expect(
      resolveQuota({
        activityQuota: 1,
        categoryOverride: null,
        participantOverride: null,
      }),
    ).toBe(1);
  });

  it("treats 0 as a configured value, not as 'inherit'", () => {
    expect(
      resolveQuota({
        activityQuota: 1,
        categoryOverride: 5,
        participantOverride: 0,
      }),
    ).toBe(0);

    expect(
      resolveQuota({
        activityQuota: 1,
        categoryOverride: 0,
        participantOverride: null,
      }),
    ).toBe(0);
  });

  it("returns null when no level is configured", () => {
    expect(
      resolveQuota({
        activityQuota: null,
        categoryOverride: null,
        participantOverride: null,
      }),
    ).toBeNull();
  });
});

describe("quotaRejection", () => {
  it("rejects the first transaction when the quota is 0", () => {
    expect(quotaRejection({ used: 0, quota: 0 })).toBe("quota_exhausted");
  });

  it("rejects once effective usage reaches the quota", () => {
    expect(quotaRejection({ used: 1, quota: 1 })).toBe("quota_exhausted");
    expect(quotaRejection({ used: 3, quota: 2 })).toBe("quota_exhausted");
  });

  it("allows the next transaction while usage is below the quota", () => {
    expect(quotaRejection({ used: 0, quota: 1 })).toBeNull();
    expect(quotaRejection({ used: 2, quota: 3 })).toBeNull();
  });

  it("never rejects when the Aktivitas has no quota", () => {
    expect(quotaRejection({ used: 100, quota: null })).toBeNull();
  });
});

describe("nextSlotNo", () => {
  it("takes the lowest number that is not in the effective set", () => {
    expect(nextSlotNo({ usedSlots: [] })).toBe(1);
    expect(nextSlotNo({ usedSlots: [1, 2] })).toBe(3);
    expect(nextSlotNo({ usedSlots: [1, 3] })).toBe(2);
  });

  it("reuses a number freed by a Reversal", () => {
    // Reversal removes the row from the effective set, so slot 1 is free again
    // while slot 2 stays taken (BR-073).
    expect(nextSlotNo({ usedSlots: [2] })).toBe(1);
  });
});

describe("isQuotaExhaustedError", () => {
  it("matches the trigger message only", () => {
    expect(
      isQuotaExhaustedError(new Error("consumption quota exhausted")),
    ).toBe(true);
    expect(
      isQuotaExhaustedError(
        new Error("D1_ERROR: consumption quota exhausted: SQLITE_CONSTRAINT"),
      ),
    ).toBe(true);
  });

  it("does not swallow other constraint failures", () => {
    expect(
      isQuotaExhaustedError(new Error("UNIQUE constraint failed: transactions.id")),
    ).toBe(false);
    expect(isQuotaExhaustedError(new Error("CHECK constraint failed"))).toBe(false);
    expect(isQuotaExhaustedError("consumption quota exhausted")).toBe(false);
  });
});

describe("consumptionMessage", () => {
  it("uses Consumption copy for success and duplication", () => {
    expect(consumptionMessage(null)).toBe("Konsumsi tercatat");
    expect(consumptionMessage("duplicate")).toBe("Sudah diambil");
    expect(consumptionMessage("quota_exhausted")).toBe("Sudah diambil");
  });

  it("keeps the shared wording for lifecycle and entitlement rejections", () => {
    expect(consumptionMessage("participant_inactive")).toBe("Peserta tidak aktif");
    expect(consumptionMessage("entitlement_denied")).toBe(
      "Peserta tidak berhak mengikuti aktivitas ini",
    );
  });
});
