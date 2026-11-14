import type { StaffContext } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import type { StaffContextSourceRow } from "../db/staff-assignments";
import { expandStaffContexts, staffContextReadiness } from "./staff-context";

/** T-100/T-106 pure half: expansion and precedence rules of Q6 §6.5. */

function row(overrides: Partial<StaffContextSourceRow> = {}): StaffContextSourceRow {
  return {
    assignment_id: "assignment-1",
    can_manual_check_in: 0,
    theme_id: "theme-1",
    theme_name: "Tema Satu",
    activity_id: "activity-1",
    activity_name: "Absensi",
    activity_status: "active",
    activity_archived_at: null,
    session_id: null,
    session_name: null,
    session_status: null,
    session_archived_at: null,
    ...overrides,
  };
}

describe("expandStaffContexts", () => {
  it("yields one context when the Aktivitas has no Sesi", () => {
    expect(expandStaffContexts([row()])).toEqual([
      {
        assignmentId: "assignment-1",
        themeId: "theme-1",
        themeName: "Tema Satu",
        activityId: "activity-1",
        activityName: "Absensi",
        sessionId: null,
        sessionName: null,
        activityStatus: "active",
        sessionStatus: null,
        canManualCheckIn: false,
      },
    ]);
  });

  it("expands an Activity-level assignment across its Sesi", () => {
    const contexts = expandStaffContexts([
      row({ session_id: "session-1", session_name: "Pagi", session_status: "in_progress" }),
      row({ session_id: "session-2", session_name: "Siang", session_status: "scheduled" }),
    ]);

    expect(contexts.map((context) => context.sessionId)).toEqual(["session-1", "session-2"]);
  });

  it("lets a Sesi assignment override the Activity-level one for that Sesi", () => {
    const contexts = expandStaffContexts([
      row({ assignment_id: "activity-level", can_manual_check_in: 0, session_id: "session-1" }),
      row({ assignment_id: "session-level", can_manual_check_in: 1, session_id: "session-1" }),
      row({ assignment_id: "activity-level", session_id: "session-2" }),
    ]);

    const first = contexts.find((context) => context.sessionId === "session-1");
    const second = contexts.find((context) => context.sessionId === "session-2");

    expect(first).toMatchObject({ assignmentId: "session-level", canManualCheckIn: true });
    expect(second).toMatchObject({ assignmentId: "activity-level", canManualCheckIn: false });
    expect(contexts).toHaveLength(2);
  });

  it("drops archived Aktivitas and archived Sesi", () => {
    expect(
      expandStaffContexts([
        row({ activity_archived_at: 1 }),
        row({ session_id: "session-1", session_archived_at: 1 }),
      ]),
    ).toEqual([]);
  });

  it("sends lifecycle status through unchanged", () => {
    const contexts = expandStaffContexts([
      row({
        activity_status: "completed",
        session_id: "session-1",
        session_status: "disabled",
      }),
    ]);

    expect(contexts[0]).toMatchObject({
      activityStatus: "completed",
      sessionStatus: "disabled",
    });
  });
});

describe("staffContextReadiness", () => {
  function context(overrides: Partial<StaffContext> = {}): StaffContext {
    return {
      assignmentId: "assignment-1",
      themeId: "theme-1",
      themeName: "Tema",
      activityId: "activity-1",
      activityName: "Absensi",
      sessionId: null,
      sessionName: null,
      activityStatus: "active",
      sessionStatus: null,
      canManualCheckIn: false,
      ...overrides,
    };
  }

  it("is ready for an active Aktivitas without Sesi", () => {
    expect(staffContextReadiness(context())).toEqual({ ready: true, reason: null });
  });

  it("rejects a draft/completed Aktivitas with a reason", () => {
    expect(staffContextReadiness(context({ activityStatus: "draft" })).ready).toBe(false);
    expect(staffContextReadiness(context({ activityStatus: "completed" })).ready).toBe(false);
    expect(staffContextReadiness(context({ activityStatus: "archived" })).ready).toBe(false);
  });

  it("rejects a Sesi that is not in progress", () => {
    for (const sessionStatus of ["scheduled", "completed", "disabled"] as const) {
      const result = staffContextReadiness(
        context({ sessionId: "session-1", sessionStatus }),
      );
      expect(result.ready).toBe(false);
      expect(result.reason).not.toBeNull();
    }

    expect(
      staffContextReadiness(context({ sessionId: "session-1", sessionStatus: "in_progress" }))
        .ready,
    ).toBe(true);
  });
});
