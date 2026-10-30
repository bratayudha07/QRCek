import { describe, expect, it } from "vitest";

import { isApiSuccess, type ApiResponse } from "./types";

describe("API envelope", () => {
  it("narrows success responses", () => {
    const body: ApiResponse<{ id: string }> = { ok: true, data: { id: "01J" } };

    expect(isApiSuccess(body)).toBe(true);
    if (isApiSuccess(body)) {
      expect(body.data.id).toBe("01J");
    }
  });

  it("keeps failures discriminated by `ok: false`", () => {
    const body: ApiResponse<never> = {
      ok: false,
      error: { code: "NOT_FOUND", message: "Tidak ditemukan" },
    };

    expect(isApiSuccess(body)).toBe(false);
  });
});
