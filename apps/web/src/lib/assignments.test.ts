import { describe, expect, it } from "vitest";

import {
  assignmentPath,
  assignmentRevokePath,
  assignmentsPath,
  staffAssignmentsPath,
} from "./assignments";
import { activitiesPath, activitySessionsPath } from "./activities";

/** Path builders stay pure so the UI cannot drift from the Worker routes. */

describe("assignment paths", () => {
  it("omits the default status and encodes ids", () => {
    expect(assignmentsPath("evt 1")).toBe("/api/events/evt%201/assignments");
    expect(assignmentsPath("evt", "active")).toBe("/api/events/evt/assignments");
    expect(assignmentsPath("evt", "revoked")).toBe(
      "/api/events/evt/assignments?status=revoked",
    );
    expect(assignmentsPath("evt", "all")).toBe("/api/events/evt/assignments?status=all");
  });

  it("builds detail and revoke paths under the Tema", () => {
    expect(assignmentPath("evt", "as/1")).toBe("/api/events/evt/assignments/as%2F1");
    expect(assignmentRevokePath("evt", "as1")).toBe(
      "/api/events/evt/assignments/as1/revoke",
    );
    expect(staffAssignmentsPath).toBe("/api/staff/assignments");
  });
});

describe("activity paths", () => {
  it("scopes Sesi under its Aktivitas", () => {
    expect(activitiesPath("evt")).toBe("/api/events/evt/activities");
    expect(activitySessionsPath("evt", "act 1")).toBe(
      "/api/events/evt/activities/act%201/sessions",
    );
  });
});
