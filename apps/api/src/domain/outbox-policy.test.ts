import { describe, expect, it } from "vitest";

import {
  OUTBOX_BASE_DELAY_MS,
  OUTBOX_JITTER_MS,
  OUTBOX_MAX_DELAY_MS,
  describeSyncFailure,
  isPermanentSyncFailure,
  retryDelayMs,
} from "./outbox-policy";

describe("retryDelayMs", () => {
  it("doubles per attempt and caps at 30 minutes", () => {
    expect(retryDelayMs(1, () => 0)).toBe(2 * OUTBOX_BASE_DELAY_MS);
    expect(retryDelayMs(2, () => 0)).toBe(4 * OUTBOX_BASE_DELAY_MS);
    expect(retryDelayMs(3, () => 0)).toBe(8 * OUTBOX_BASE_DELAY_MS);
    expect(retryDelayMs(20, () => 0)).toBe(OUTBOX_MAX_DELAY_MS);
  });

  it("adds bounded jitter", () => {
    expect(retryDelayMs(1, () => 0.999)).toBeLessThanOrEqual(
      2 * OUTBOX_BASE_DELAY_MS + OUTBOX_JITTER_MS,
    );
    expect(retryDelayMs(1, () => 1)).toBe(2 * OUTBOX_BASE_DELAY_MS + OUTBOX_JITTER_MS);
  });
});

describe("isPermanentSyncFailure", () => {
  it("retries network failures, 429, and rate-limit 403", () => {
    expect(isPermanentSyncFailure(new Error("network"))).toBe(false);
    expect(isPermanentSyncFailure({ status: 429 })).toBe(false);
    expect(isPermanentSyncFailure({ status: 403, reason: "rateLimitExceeded" })).toBe(false);
    expect(isPermanentSyncFailure({ status: 500 })).toBe(false);
  });

  it("treats other 4xx responses as permanent", () => {
    expect(isPermanentSyncFailure({ status: 400 })).toBe(true);
    expect(isPermanentSyncFailure({ status: 401 })).toBe(true);
    expect(isPermanentSyncFailure({ status: 403, reason: "forbidden" })).toBe(true);
    expect(isPermanentSyncFailure({ status: 404 })).toBe(true);
  });
});

describe("describeSyncFailure", () => {
  it("returns operator-facing text without request details", () => {
    expect(describeSyncFailure({ status: 401 })).toContain("Kredensial");
    expect(describeSyncFailure({ status: 403 })).toContain("akses tulis");
    expect(describeSyncFailure({ status: 404 })).toContain("tidak ditemukan");
    expect(describeSyncFailure(new Error("boom"))).toBe(
      "Tidak dapat menghubungi Google Sheets",
    );
  });
});
