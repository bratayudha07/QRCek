import { describe, expect, it } from "vitest";

import {
  activitiesPath,
  activityPath,
  activitySessionsPath,
  activityStatusLabel,
  activityStatusPath,
  activityTransitionActions,
  canManageActivities,
  transactionTypeLabel,
} from "./activities";

/** Pure helpers stay unit-tested so the UI cannot drift from the Worker routes. */

describe("activity paths", () => {
  it("scopes every path under the Tema and encodes ids", () => {
    expect(activitiesPath("evt 1")).toBe("/api/events/evt%201/activities");
    expect(activityPath("evt", "act/1")).toBe("/api/events/evt/activities/act%2F1");
    expect(activityStatusPath("evt", "act 1")).toBe(
      "/api/events/evt/activities/act%201/status",
    );
    expect(activitySessionsPath("evt", "act 1")).toBe(
      "/api/events/evt/activities/act%201/sessions",
    );
  });
});

describe("activityStatusLabel", () => {
  it("maps every status to an Indonesian label", () => {
    expect(activityStatusLabel("draft")).toBe("Draf");
    expect(activityStatusLabel("active")).toBe("Aktif");
    expect(activityStatusLabel("completed")).toBe("Selesai");
    expect(activityStatusLabel("archived")).toBe("Diarsipkan");
  });
});

describe("transactionTypeLabel", () => {
  it("maps both transaction types", () => {
    expect(transactionTypeLabel("attendance")).toBe("Absensi");
    expect(transactionTypeLabel("consumption")).toBe("Konsumsi");
  });
});

describe("activityTransitionActions", () => {
  it("offers only the allowed transitions", () => {
    expect(activityTransitionActions("draft")).toEqual([
      { status: "active", label: "Aktifkan" },
      { status: "archived", label: "Arsipkan" },
    ]);
    expect(activityTransitionActions("active")).toEqual([
      { status: "completed", label: "Selesaikan" },
    ]);
    expect(activityTransitionActions("completed")).toEqual([
      { status: "archived", label: "Arsipkan" },
    ]);
  });

  it("offers nothing for an archived Aktivitas", () => {
    expect(activityTransitionActions("archived")).toEqual([]);
  });
});

describe("canManageActivities", () => {
  it("allows admins on a mutable Tema", () => {
    expect(canManageActivities("event_admin", "active")).toBe(true);
    expect(canManageActivities("superadmin", "draft")).toBe(true);
  });

  it("never allows an officer or an archived Tema", () => {
    expect(canManageActivities("officer", "active")).toBe(false);
    expect(canManageActivities("event_admin", "archived")).toBe(false);
    expect(canManageActivities("superadmin", "archived")).toBe(false);
  });
});
