import { describe, expect, it } from "vitest";

import { epochToLocalInput, localInputToEpoch } from "./activity-time";

const JAKARTA = "Asia/Jakarta"; // UTC+7, no DST.
const NEW_YORK = "America/New_York"; // EST/EDT, DST.

describe("localInputToEpoch", () => {
  it("interprets the wall clock in the Tema timezone", () => {
    expect(localInputToEpoch("2026-10-31T09:00", JAKARTA)).toBe(
      Date.UTC(2026, 9, 31, 2, 0),
    );
  });

  it("handles both New York offsets around DST", () => {
    // January: EST, UTC-5. July: EDT, UTC-4.
    expect(localInputToEpoch("2026-01-15T09:00", NEW_YORK)).toBe(
      Date.UTC(2026, 0, 15, 14, 0),
    );
    expect(localInputToEpoch("2026-07-15T09:00", NEW_YORK)).toBe(
      Date.UTC(2026, 6, 15, 13, 0),
    );
  });

  it("accepts optional seconds", () => {
    expect(localInputToEpoch("2026-10-31T09:00:30", JAKARTA)).toBe(
      Date.UTC(2026, 9, 31, 2, 0, 30),
    );
  });

  it("returns null for blank, malformed, or impossible values", () => {
    expect(localInputToEpoch("", JAKARTA)).toBeNull();
    expect(localInputToEpoch("   ", JAKARTA)).toBeNull();
    expect(localInputToEpoch("31/10/2026 09:00", JAKARTA)).toBeNull();
    expect(localInputToEpoch("2026-13-01T09:00", JAKARTA)).toBeNull();
    expect(localInputToEpoch("2026-02-31T09:00", JAKARTA)).toBeNull();
    expect(localInputToEpoch("2026-10-31T24:00", JAKARTA)).toBeNull();
    expect(localInputToEpoch("2026-10-31T09:60", JAKARTA)).toBeNull();
  });

  it("returns null for an unknown timezone instead of throwing", () => {
    expect(localInputToEpoch("2026-10-31T09:00", "Not/AZone")).toBeNull();
  });

  it("rejects a wall-clock time that does not exist inside a DST gap", () => {
    // New York springs forward at 02:00 on 8 March 2026; 02:30 never happens.
    expect(localInputToEpoch("2026-03-08T02:30", NEW_YORK)).toBeNull();
  });
});

describe("epochToLocalInput", () => {
  it("renders the epoch in the Tema timezone", () => {
    expect(epochToLocalInput(Date.UTC(2026, 9, 31, 2, 0), JAKARTA)).toBe(
      "2026-10-31T09:00",
    );
    expect(epochToLocalInput(Date.UTC(2026, 0, 15, 14, 0), NEW_YORK)).toBe(
      "2026-01-15T09:00",
    );
    expect(epochToLocalInput(Date.UTC(2026, 6, 15, 13, 0), NEW_YORK)).toBe(
      "2026-07-15T09:00",
    );
  });

  it("returns an empty value for invalid input", () => {
    expect(epochToLocalInput(Number.NaN, JAKARTA)).toBe("");
    expect(epochToLocalInput(Number.POSITIVE_INFINITY, JAKARTA)).toBe("");
    expect(epochToLocalInput(Date.UTC(2026, 9, 31, 2, 0), "Not/AZone")).toBe("");
  });
});

describe("round trip", () => {
  it.each([
    [JAKARTA, "2026-10-31T09:30"],
    [NEW_YORK, "2026-01-15T09:30"],
    [NEW_YORK, "2026-07-15T09:30"],
  ])("round-trips %s at %s", (timeZone, value) => {
    const epoch = localInputToEpoch(value, timeZone);

    expect(epoch).not.toBeNull();
    expect(epochToLocalInput(epoch as number, timeZone)).toBe(value);
  });
});
