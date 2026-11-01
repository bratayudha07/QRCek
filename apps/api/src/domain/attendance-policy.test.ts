import { describe, expect, it } from "vitest";

import { isEventOpenForAttendance } from "./attendance-policy";

describe("isEventOpenForAttendance", () => {
  it("accepts an active event without a window", () => {
    expect(
      isEventOpenForAttendance({ status: "active", starts_at: null, ends_at: null }, 100),
    ).toBe(true);
  });

  it("accepts an active event inside its window", () => {
    expect(
      isEventOpenForAttendance({ status: "active", starts_at: 50, ends_at: 150 }, 100),
    ).toBe(true);
  });

  it("rejects a closed, draft, or archived event even inside its dates", () => {
    for (const status of ["draft", "closed", "archived"] as const) {
      expect(
        isEventOpenForAttendance({ status, starts_at: null, ends_at: null }, 100),
      ).toBe(false);
    }
  });

  it("rejects before the start and after the end", () => {
    expect(
      isEventOpenForAttendance({ status: "active", starts_at: 101, ends_at: null }, 100),
    ).toBe(false);
    expect(
      isEventOpenForAttendance({ status: "active", starts_at: null, ends_at: 99 }, 100),
    ).toBe(false);
    // Boundaries are inclusive.
    expect(
      isEventOpenForAttendance({ status: "active", starts_at: 100, ends_at: 100 }, 100),
    ).toBe(true);
  });
});
