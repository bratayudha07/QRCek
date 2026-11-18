import type {
  CategorySummary,
  ConsumptionQuotaPayload,
  StaffContext,
} from "@absensi/shared";
import { describe, expect, it } from "vitest";

import {
  canReverseConsumption,
  categoryQuotaRows,
  consumptionManualRequest,
  consumptionManualSuccessMessage,
  consumptionReversalNotice,
  consumptionSourceLabel,
  parseQuotaInput,
  participantQuotaRows,
  quotaUsageLabel,
  resolveEffectiveQuota,
} from "./consumption";

/** Q7 consumption UI helpers: pure, no DOM and no I/O. */

function category(overrides: Partial<CategorySummary> = {}): CategorySummary {
  return {
    id: "cat-1",
    themeId: "theme-1",
    name: "Dewasa",
    description: null,
    sortOrder: 1,
    status: "active",
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    ...overrides,
  };
}

function context(overrides: Partial<StaffContext> = {}): StaffContext {
  return {
    assignmentId: "asg-1",
    themeId: "theme-1",
    themeName: "Tema",
    activityId: "act-1",
    activityName: "Makan Siang",
    transactionType: "consumption",
    sessionId: null,
    sessionName: null,
    activityStatus: "active",
    sessionStatus: null,
    canManualCheckIn: true,
    timezone: "Asia/Jakarta",
    ...overrides,
  };
}

function quota(overrides: Partial<ConsumptionQuotaPayload> = {}): ConsumptionQuotaPayload {
  return {
    activityId: "act-1",
    defaultQuota: 1,
    categoryOverrides: [],
    participantOverrides: [],
    usage: [],
    ...overrides,
  };
}

describe("resolveEffectiveQuota", () => {
  it("prefers the participant override, then the category, then the default", () => {
    expect(
      resolveEffectiveQuota({ activityQuota: 1, categoryOverride: 2, participantOverride: 3 }),
    ).toBe(3);
    expect(
      resolveEffectiveQuota({ activityQuota: 1, categoryOverride: 2, participantOverride: null }),
    ).toBe(2);
    expect(
      resolveEffectiveQuota({ activityQuota: 1, categoryOverride: null, participantOverride: null }),
    ).toBe(1);
  });

  it("keeps 0 as a configured value instead of treating it as inherit", () => {
    expect(
      resolveEffectiveQuota({ activityQuota: 1, categoryOverride: 0, participantOverride: null }),
    ).toBe(0);
  });
});

describe("parseQuotaInput", () => {
  it("accepts a non-negative integer, including 0", () => {
    expect(parseQuotaInput("0")).toEqual({ ok: true, quota: 0 });
    expect(parseQuotaInput(" 12 ")).toEqual({ ok: true, quota: 12 });
  });

  it("rejects an empty field instead of silently reading it as 0", () => {
    expect(parseQuotaInput("")).toEqual({ ok: false, message: "Kuota wajib diisi" });
    expect(parseQuotaInput("   ")).toEqual({ ok: false, message: "Kuota wajib diisi" });
  });

  it("rejects negatives, decimals, and text", () => {
    for (const raw of ["-1", "1.5", "dua", "1e3", "+2"]) {
      expect(parseQuotaInput(raw).ok).toBe(false);
    }
  });

  it("rejects a value above the API ceiling", () => {
    expect(parseQuotaInput("100001").ok).toBe(false);
    expect(parseQuotaInput("100000")).toEqual({ ok: true, quota: 100_000 });
  });
});

describe("quotaUsageLabel", () => {
  it("always shows usage against the effective quota", () => {
    expect(quotaUsageLabel(0, 3)).toBe("0 dari 3");
    expect(quotaUsageLabel(3, 3)).toBe("3 dari 3");
  });
});

describe("categoryQuotaRows", () => {
  it("resolves names, sorts them, and keeps an archived override visible", () => {
    const rows = categoryQuotaRows(
      quota({
        categoryOverrides: [
          { categoryId: "cat-2", quota: 2 },
          { categoryId: "cat-1", quota: 0 },
          { categoryId: "cat-gone", quota: 4 },
        ],
      }),
      [
        category({ id: "cat-1", name: "Anak" }),
        category({ id: "cat-2", name: "Dewasa", status: "archived", archivedAt: 5 }),
      ],
    );

    expect(rows).toEqual([
      { categoryId: "cat-1", name: "Anak", quota: 0 },
      { categoryId: "cat-2", name: "Dewasa", quota: 2 },
      { categoryId: "cat-gone", name: "Kategori tidak dikenal", quota: 4 },
    ]);
  });
});

describe("participantQuotaRows", () => {
  it("joins the bounded usage slice and never reports a missing row as 0", () => {
    const names = new Map([
      ["p-1", "Budi"],
      ["p-2", "Sari"],
    ]);

    const rows = participantQuotaRows(
      quota({
        participantOverrides: [
          { participantId: "p-2", quota: 3 },
          { participantId: "p-1", quota: 2 },
          { participantId: "p-9", quota: 5 },
        ],
        usage: [{ participantId: "p-1", used: 2 }],
      }),
      names,
    );

    expect(rows).toEqual([
      { participantId: "p-1", name: "Budi", quota: 2, used: 2 },
      { participantId: "p-9", name: "Peserta di luar daftar", quota: 5, used: null },
      { participantId: "p-2", name: "Sari", quota: 3, used: null },
    ]);
  });
});

describe("consumptionManualRequest", () => {
  it("sends the context scope without an attendance status", () => {
    const request = consumptionManualRequest(context({ sessionId: "ses-1" }), "p-1", "Tanpa QR");

    expect(request).toEqual({
      participantId: "p-1",
      activityId: "act-1",
      sessionId: "ses-1",
      note: "Tanpa QR",
    });
    expect("status" in request).toBe(false);
  });

  it("omits an empty note and a null Sesi", () => {
    expect(consumptionManualRequest(context(), "p-1", "   ")).toEqual({
      participantId: "p-1",
      activityId: "act-1",
    });
  });
});

describe("consumptionManualSuccessMessage", () => {
  it("mentions the serving number when the Worker returned one", () => {
    expect(consumptionManualSuccessMessage("Budi", 2)).toBe(
      "Konsumsi tercatat untuk Budi (porsi 2).",
    );
  });

  it("stays readable without a slot", () => {
    expect(consumptionManualSuccessMessage("Budi", null)).toBe("Konsumsi tercatat untuk Budi.");
  });
});

describe("canReverseConsumption", () => {
  it("allows only the Tema's Admin Acara", () => {
    expect(canReverseConsumption("event_admin")).toBe(true);
    expect(canReverseConsumption("superadmin")).toBe(false);
    expect(canReverseConsumption("officer")).toBe(false);
  });
});

describe("consumptionReversalNotice", () => {
  it("explains the missing action to a Super Admin", () => {
    expect(consumptionReversalNotice("superadmin")).toContain("Admin Acara");
  });

  it("stays silent for the role that can actually reverse", () => {
    expect(consumptionReversalNotice("event_admin")).toBeNull();
  });
});

describe("consumptionSourceLabel", () => {
  it("maps both transaction sources to user-facing copy", () => {
    expect(consumptionSourceLabel("qr_scan")).toBe("Scan QR");
    expect(consumptionSourceLabel("manual")).toBe("Input manual");
  });
});
