import { afterEach, describe, expect, it, vi } from "vitest";

import { apiBaseUrl, apiUrl } from "./api";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("apiBaseUrl", () => {
  it("defaults to a same-origin (empty) base URL", () => {
    // No VITE_API_BASE_URL set -> relative requests, ADR-001.
    expect(apiBaseUrl()).toBe("");
  });

  it("strips trailing slashes from a configured base URL", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://staging.example.com/");

    expect(apiBaseUrl()).toBe("https://staging.example.com");
  });

  it("treats a blank value as same-origin", () => {
    vi.stubEnv("VITE_API_BASE_URL", "   ");

    expect(apiBaseUrl()).toBe("");
  });
});

describe("apiUrl", () => {
  it("returns a relative path when nothing is configured", () => {
    expect(apiUrl("/api/health")).toBe("/api/health");
  });

  it("prefixes the configured origin", () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://staging.example.com/");

    expect(apiUrl("/api/health")).toBe("https://staging.example.com/api/health");
  });

  it("tolerates a path without a leading slash", () => {
    expect(apiUrl("api/health")).toBe("/api/health");
  });
});
