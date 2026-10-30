import { describe, expect, it } from "vitest";

import { parseHealthResponse } from "./health";

describe("parseHealthResponse", () => {
  it("accepts a success envelope", () => {
    const state = parseHealthResponse({
      ok: true,
      data: { service: "absensi-api", version: "v1", status: "ok", now: 1 },
    });

    expect(state).toEqual({ status: "ok", version: "v1" });
  });

  it("surfaces the server error message", () => {
    const state = parseHealthResponse({
      ok: false,
      error: { code: "DB_UNAVAILABLE", message: "Database sedang tidak tersedia" },
    });

    expect(state).toEqual({ status: "error", message: "Database sedang tidak tersedia" });
  });

  it("rejects shapes it does not recognise", () => {
    expect(parseHealthResponse(null).status).toBe("error");
    expect(parseHealthResponse("html").status).toBe("error");
    expect(parseHealthResponse({ unexpected: true }).status).toBe("error");
  });
});
