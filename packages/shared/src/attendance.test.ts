import { describe, expect, it } from "vitest";

import { attendancePercentage } from "./attendance";

describe("attendancePercentage", () => {
  it("returns 0 for an empty event", () => {
    expect(attendancePercentage(0, 0)).toBe(0);
    expect(attendancePercentage(5, 0)).toBe(0);
  });

  it("rounds to one decimal", () => {
    expect(attendancePercentage(1, 3)).toBe(33.3);
    expect(attendancePercentage(2, 3)).toBe(66.7);
    expect(attendancePercentage(3, 3)).toBe(100);
    expect(attendancePercentage(1, 2)).toBe(50);
  });
});
