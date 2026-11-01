import { afterEach, describe, expect, it, vi } from "vitest";

import { participantExportUrl, participantListPath } from "./participants";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("participantListPath", () => {
  it("returns the bare endpoint with no filters", () => {
    expect(participantListPath("EVT")).toBe("/api/events/EVT/participants");
  });

  it("adds query, status, limit, and cursor", () => {
    const path = participantListPath("EVT", {
      query: "  budi  ",
      status: "inactive",
      limit: 25,
      cursor: "abc",
    });

    expect(path).toBe(
      "/api/events/EVT/participants?query=budi&status=inactive&limit=25&cursor=abc",
    );
  });

  it("omits an empty query instead of sending query=", () => {
    expect(participantListPath("EVT", { query: "   ", status: "active" })).toBe(
      "/api/events/EVT/participants?status=active",
    );
  });

  it("encodes the event id and the cursor", () => {
    const path = participantListPath("a/b", { cursor: "x+y/z=" });
    expect(path).toContain("/api/events/a%2Fb/participants?");
    expect(path).toContain("cursor=x%2By%2Fz%3D");
  });
});

describe("participantExportUrl", () => {
  it("uses the same-origin base by default", () => {
    expect(participantExportUrl("EVT", { status: "active" })).toBe(
      "/api/calendar/EVT/participants/export?status=active",
    );
  });

  it("honours VITE_API_BASE_URL", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://staging.example.com");

    expect(participantExportUrl("EVT")).toBe(
      "https://staging.example.com/api/calendar/EVT/participants/export",
    );
  });
});
