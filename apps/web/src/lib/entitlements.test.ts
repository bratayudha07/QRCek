import type {
  Activity,
  ActivitySession,
  EntitlementMatrixPayload,
} from "@absensi/shared";
import { describe, expect, it } from "vitest";

import {
  ACTIVITY_SCOPE_KEY,
  activityCategoryRulesPath,
  activityEntitlementsPath,
  activityParticipantOverridePath,
  canEditEntitlements,
  categoryRows,
  defaultActivityId,
  entitlementStatusLabel,
  missingCategoryNames,
  overrideRows,
  scopeOptions,
  sessionCategoryRulesPath,
  sessionParticipantOverridePath,
  shortParticipantId,
  themeDefaultPath,
} from "./entitlements";

/** Pure helpers stay unit-tested so the page cannot drift from the Worker routes. */

function matrix(overrides: Partial<EntitlementMatrixPayload> = {}): EntitlementMatrixPayload {
  return {
    activityId: "act-1",
    entitlementComplete: true,
    missingCategoryIds: [],
    themeDefault: null,
    categories: [
      { categoryId: "cat-a", name: "Kelas 5A", status: "allowed" },
      { categoryId: "cat-b", name: "Kelas 5B", status: null },
    ],
    sessions: [
      {
        sessionId: "ses-1",
        categories: [
          { categoryId: "cat-a", name: "Kelas 5A", status: "denied" },
          { categoryId: "cat-b", name: "Kelas 5B", status: null },
        ],
        participants: [{ participantId: "part-2", status: "allowed" }],
      },
    ],
    participants: [
      { participantId: "part-1", status: "allowed" },
      { participantId: "part-2", status: "denied" },
    ],
    ...overrides,
  };
}

function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "act-1",
    themeId: "evt-1",
    name: "Registrasi",
    description: null,
    transactionType: "attendance",
    status: "active",
    location: null,
    sortOrder: 0,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    archivedAt: null,
    ...overrides,
  };
}

function session(overrides: Partial<ActivitySession> = {}): ActivitySession {
  return {
    id: "ses-1",
    activityId: "act-1",
    name: "Gelombang 1",
    location: null,
    startsAt: null,
    endsAt: null,
    status: "scheduled",
    archivedAt: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("entitlement paths", () => {
  it("builds activity and theme-default paths with encoded ids", () => {
    expect(activityEntitlementsPath("evt 1", "act/1")).toBe(
      "/api/events/evt%201/activities/act%2F1/entitlements",
    );
    expect(themeDefaultPath("evt 1")).toBe("/api/events/evt%201/entitlements/default");
    expect(activityCategoryRulesPath("evt", "act")).toBe(
      "/api/events/evt/activities/act/entitlements/categories",
    );
  });

  it("puts session rules under the Sesi, not under the activity entitlements", () => {
    expect(sessionCategoryRulesPath("evt", "act", "ses 1")).toBe(
      "/api/events/evt/activities/act/sessions/ses%201/entitlements/categories",
    );
  });

  it("builds participant override paths for both scopes", () => {
    expect(activityParticipantOverridePath("evt", "act", "p/1")).toBe(
      "/api/events/evt/activities/act/entitlements/participants/p%2F1",
    );
    expect(sessionParticipantOverridePath("evt", "act", "ses", "p 1")).toBe(
      "/api/events/evt/activities/act/sessions/ses/entitlements/participants/p%201",
    );
  });
});

describe("entitlementStatusLabel", () => {
  it("maps every status and the unset cell to Indonesian", () => {
    expect(entitlementStatusLabel("allowed")).toBe("Diizinkan");
    expect(entitlementStatusLabel("denied")).toBe("Ditolak");
    expect(entitlementStatusLabel("inherit")).toBe("Ikut bawaan");
    expect(entitlementStatusLabel(null)).toBe("Belum diatur");
  });
});

describe("scopeOptions", () => {
  it("lists the activity scope first and then each Sesi", () => {
    const options = scopeOptions(activity(), [
      session(),
      session({ id: "ses-2", name: "Gelombang 2" }),
    ]);

    expect(options).toEqual([
      { key: ACTIVITY_SCOPE_KEY, label: "Aktivitas (semua Sesi)", sessionId: null },
      { key: "ses-1", label: "Gelombang 1", sessionId: "ses-1" },
      { key: "ses-2", label: "Gelombang 2", sessionId: "ses-2" },
    ]);
  });

  it("ignores a Sesi that belongs to another Aktivitas", () => {
    const options = scopeOptions(activity(), [
      session(),
      session({ id: "ses-9", name: "Aktivitas lain", activityId: "act-2" }),
    ]);

    expect(options.map((option) => option.key)).toEqual([ACTIVITY_SCOPE_KEY, "ses-1"]);
  });

  it("still offers the activity scope when the Aktivitas has no Sesi", () => {
    expect(scopeOptions(activity(), [])).toHaveLength(1);
  });
});

describe("categoryRows", () => {
  it("returns the activity cells for the activity scope", () => {
    expect(categoryRows(matrix(), null).map((cell) => cell.categoryId)).toEqual([
      "cat-a",
      "cat-b",
    ]);
  });

  it("returns the Sesi cells for a selected Sesi", () => {
    expect(categoryRows(matrix(), "ses-1").map((cell) => cell.status)).toEqual([
      "denied",
      null,
    ]);
  });

  it("returns nothing for a Sesi that is not in the matrix", () => {
    expect(categoryRows(matrix(), "ses-missing")).toEqual([]);
  });
});

describe("overrideRows", () => {
  it("uses cached names and falls back to the short id", () => {
    const rows = overrideRows(matrix(), null, { "part-1": "Siti Aminah" });

    expect(rows).toEqual([
      { participantId: "part-2", status: "denied", name: "part-2", nameFromId: true },
      { participantId: "part-1", status: "allowed", name: "Siti Aminah", nameFromId: false },
    ]);
  });

  it("sorts rows by name and reads the Sesi bucket when one is selected", () => {
    const rows = overrideRows(matrix(), "ses-1", { "part-2": "Budi" });

    expect(rows).toEqual([
      { participantId: "part-2", status: "allowed", name: "Budi", nameFromId: false },
    ]);
  });

  it("returns nothing when the scope has no overrides", () => {
    expect(overrideRows(matrix(), "ses-missing")).toEqual([]);
  });

  it("keeps short ids readable", () => {
    expect(shortParticipantId("01JPARTICIPANT")).toBe("CIPANT");
    expect(shortParticipantId("short")).toBe("short");
  });
});

describe("missingCategoryNames", () => {
  it("maps missing ids to category names and falls back to the id", () => {
    expect(
      missingCategoryNames(matrix({ missingCategoryIds: ["cat-b", "cat-unknown"] })),
    ).toEqual(["Kelas 5B", "cat-unknown"]);
  });

  it("returns nothing when the Aktivitas is complete", () => {
    expect(missingCategoryNames(matrix())).toEqual([]);
  });
});

describe("canEditEntitlements", () => {
  it("allows Admin Acara and Super Admin on a non-archived Tema", () => {
    expect(canEditEntitlements("event_admin", "active")).toBe(true);
    expect(canEditEntitlements("superadmin", "draft")).toBe(true);
  });

  it("rejects Petugas and every role on an archived Tema", () => {
    expect(canEditEntitlements("officer", "active")).toBe(false);
    expect(canEditEntitlements("event_admin", "archived")).toBe(false);
    expect(canEditEntitlements("superadmin", "archived")).toBe(false);
  });
});

describe("defaultActivityId", () => {
  it("prefers the first active attendance Aktivitas", () => {
    expect(
      defaultActivityId([
        activity({ id: "cons", transactionType: "consumption" }),
        activity({ id: "att", transactionType: "attendance" }),
      ]),
    ).toBe("att");
  });

  it("falls back to the first active Aktivitas, then to the first non-archived one", () => {
    expect(
      defaultActivityId([
        activity({ id: "cons", transactionType: "consumption" }),
        activity({ id: "draft", status: "draft" }),
      ]),
    ).toBe("cons");

    expect(
      defaultActivityId([
        activity({ id: "old", status: "archived", archivedAt: 1 }),
        activity({ id: "draft", status: "draft" }),
      ]),
    ).toBe("draft");
  });

  it("returns null when there is no Aktivitas", () => {
    expect(defaultActivityId([])).toBeNull();
  });
});
