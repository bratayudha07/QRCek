import { describe, expect, it } from "vitest";

import {
  formatDateTime,
  formatSchedule,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
} from "./format";

const JAKARTA = "Asia/Jakarta"; // UTC+7, no DST.

describe("formatSchedule", () => {
  it("marks a missing schedule instead of rendering an invalid date", () => {
    expect(formatSchedule(null, null, JAKARTA)).toBe("Belum dijadwalkan");
  });

  it("renders a start-only schedule with time", () => {
    const value = Date.UTC(2026, 9, 31, 2, 0);

    expect(formatSchedule(value, null, JAKARTA)).toContain("2026");
    expect(formatDateTime(value, JAKARTA)).toContain("09.00");
  });

  it("renders both bounds as a range", () => {
    const start = Date.UTC(2026, 9, 31, 2, 0);
    const end = Date.UTC(2026, 9, 31, 5, 0);

    expect(formatSchedule(start, end, JAKARTA)).toContain("–");
  });
});

describe("datetime-local conversion", () => {
  it("interprets the input in the event timezone", () => {
    expect(fromDateTimeLocalValue("2026-10-31T09:00", JAKARTA)).toBe(
      Date.UTC(2026, 9, 31, 2, 0),
    );
  });

  it("treats UTC as UTC", () => {
    expect(fromDateTimeLocalValue("2026-10-31T09:00", "UTC")).toBe(Date.UTC(2026, 9, 31, 9, 0));
  });

  it("round-trips through the input value", () => {
    const start = Date.UTC(2026, 9, 31, 2, 30);

    expect(toDateTimeLocalValue(start, JAKARTA)).toBe("2026-10-31T09:30");
    expect(fromDateTimeLocalValue("2026-10-31T09:30", JAKARTA)).toBe(start);
  });

  it("returns null for blank or malformed values", () => {
    expect(fromDateTimeLocalValue("", JAKARTA)).toBeNull();
    expect(fromDateTimeLocalValue("31/10/2026 09:00", JAKARTA)).toBeNull();
    expect(toDateTimeLocalValue(null, JAKARTA)).toBe("");
  });

  it("handles a DST boundary without returning NaN", () => {
    // 2026-03-29 02:30 does not exist in Europe/Berlin (spring forward).
    const value = fromDateTimeLocalValue("2026-03-29T02:30", "Europe/Berlin");
    expect(value).not.toBeNull();
    expect(Number.isFinite(value)).toBe(true);
  });
});
