import { describe, expect, it } from "vitest";

import type { ActivityStatus } from "./schemas/activities";
import type { SessionStatus } from "./schemas/activity-sessions";
import {
  ACTIVITY_TRANSITIONS,
  SESSION_ARCHIVABLE_FROM,
  SESSION_TRANSITIONS,
  canArchiveSession,
  canTransitionActivity,
  canTransitionSession,
} from "./lifecycle";

/** T-005: the full transition table, not a sample. */

const ACTIVITY_STATUSES: readonly ActivityStatus[] = [
  "draft",
  "active",
  "completed",
  "archived",
];

const SESSION_STATUSES: readonly SessionStatus[] = [
  "scheduled",
  "in_progress",
  "completed",
  "disabled",
];

function everyPair<T extends string>(values: readonly T[]): Array<[T, T]> {
  return values.flatMap((from) => values.map((to) => [from, to] as [T, T]));
}

describe("ACTIVITY_TRANSITIONS", () => {
  it.each(everyPair(ACTIVITY_STATUSES))("%s → %s follows the table", (from, to) => {
    expect(canTransitionActivity(from, to)).toBe(
      ACTIVITY_TRANSITIONS[from].includes(to),
    );
  });

  it("allows draft to be archived directly", () => {
    expect(canTransitionActivity("draft", "archived")).toBe(true);
  });

  it("rejects active → archived (must complete first)", () => {
    expect(canTransitionActivity("active", "archived")).toBe(false);
  });

  it("rejects every reopen from a final status", () => {
    expect(canTransitionActivity("completed", "active")).toBe(false);
    expect(canTransitionActivity("archived", "draft")).toBe(false);
    expect(ACTIVITY_TRANSITIONS.archived).toEqual([]);
  });
});

describe("SESSION_TRANSITIONS", () => {
  it.each(everyPair(SESSION_STATUSES))("%s → %s follows the table", (from, to) => {
    expect(canTransitionSession(from, to)).toBe(SESSION_TRANSITIONS[from].includes(to));
  });

  it("rejects scheduled → completed and in_progress → scheduled", () => {
    expect(canTransitionSession("scheduled", "completed")).toBe(false);
    expect(canTransitionSession("in_progress", "scheduled")).toBe(false);
  });

  it("rejects reopen from completed/disabled", () => {
    expect(canTransitionSession("completed", "in_progress")).toBe(false);
    expect(canTransitionSession("disabled", "scheduled")).toBe(false);
  });
});

describe("session archive", () => {
  it("is allowed only from completed or disabled (OQ-033)", () => {
    for (const status of SESSION_STATUSES) {
      expect(canArchiveSession(status)).toBe(
        (SESSION_ARCHIVABLE_FROM as readonly string[]).includes(status),
      );
    }
    expect(canArchiveSession("scheduled")).toBe(false);
    expect(canArchiveSession("in_progress")).toBe(false);
    expect(canArchiveSession("completed")).toBe(true);
    expect(canArchiveSession("disabled")).toBe(true);
  });

  it("never treats archived as an operational session status", () => {
    expect(SESSION_STATUSES).not.toContain("archived");
  });
});
