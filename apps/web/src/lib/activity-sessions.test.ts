import type { ActivitySession } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import {
  activitySessionArchivePath,
  activitySessionDuplicatePath,
  activitySessionPath,
  activitySessionStatusPath,
  canArchiveActivitySession,
  sessionStatusLabel,
  sessionTimeRangeError,
  sessionTransitionActions,
} from "./activity-sessions";

/** Pure helpers stay unit-tested so the UI cannot drift from the Worker routes. */

function session(overrides: Partial<ActivitySession> = {}): ActivitySession {
  return {
    id: "ses-1",
    activityId: "act-1",
    name: "Sesi 1",
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

describe("session paths", () => {
  it("scopes Sesi under its Aktivitas and encodes ids", () => {
    expect(activitySessionPath("evt", "act 1", "ses/1")).toBe(
      "/api/events/evt/activities/act%201/sessions/ses%2F1",
    );
    expect(activitySessionStatusPath("evt", "act", "ses")).toBe(
      "/api/events/evt/activities/act/sessions/ses/status",
    );
    expect(activitySessionArchivePath("evt", "act", "ses")).toBe(
      "/api/events/evt/activities/act/sessions/ses/archive",
    );
    expect(activitySessionDuplicatePath("evt", "act", "ses")).toBe(
      "/api/events/evt/activities/act/sessions/ses/duplicate",
    );
  });
});

describe("sessionStatusLabel", () => {
  it("maps every status to an Indonesian label", () => {
    expect(sessionStatusLabel("scheduled")).toBe("Terjadwal");
    expect(sessionStatusLabel("in_progress")).toBe("Berlangsung");
    expect(sessionStatusLabel("completed")).toBe("Selesai");
    expect(sessionStatusLabel("disabled")).toBe("Dinonaktifkan");
  });
});

describe("sessionTransitionActions", () => {
  it("offers only the allowed transitions", () => {
    expect(sessionTransitionActions("scheduled")).toEqual([
      { status: "in_progress", label: "Mulai" },
      { status: "disabled", label: "Nonaktifkan" },
    ]);
    expect(sessionTransitionActions("in_progress")).toEqual([
      { status: "completed", label: "Selesaikan" },
      { status: "disabled", label: "Nonaktifkan" },
    ]);
  });

  it("offers nothing once the Sesi is final", () => {
    expect(sessionTransitionActions("completed")).toEqual([]);
    expect(sessionTransitionActions("disabled")).toEqual([]);
  });
});

describe("canArchiveActivitySession", () => {
  it("allows archive only after completed or disabled, and only once", () => {
    expect(canArchiveActivitySession(session({ status: "completed" }))).toBe(true);
    expect(canArchiveActivitySession(session({ status: "disabled" }))).toBe(true);
    expect(canArchiveActivitySession(session({ status: "scheduled" }))).toBe(false);
    expect(canArchiveActivitySession(session({ status: "in_progress" }))).toBe(false);
    expect(
      canArchiveActivitySession(session({ status: "completed", archivedAt: 1_700_000_000_000 })),
    ).toBe(false);
  });
});

describe("sessionTimeRangeError", () => {
  it("accepts missing and ordered bounds", () => {
    expect(sessionTimeRangeError(null, null)).toBeNull();
    expect(sessionTimeRangeError(1_000, null)).toBeNull();
    expect(sessionTimeRangeError(null, 1_000)).toBeNull();
    expect(sessionTimeRangeError(1_000, 1_000)).toBeNull();
    expect(sessionTimeRangeError(1_000, 2_000)).toBeNull();
  });

  it("rejects an end before the start", () => {
    expect(sessionTimeRangeError(2_000, 1_000)).toBe(
      "Waktu selesai tidak boleh sebelum waktu mulai",
    );
  });
});
