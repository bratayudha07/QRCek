import { describe, expect, it } from "vitest";

import {
  errorFor,
  mergeFieldErrors,
  readFieldErrors,
  summarizeFieldErrors,
} from "./form-errors";

describe("readFieldErrors", () => {
  it("reads the Worker's fieldErrors shape", () => {
    expect(
      readFieldErrors({
        fieldErrors: {
          fullName: ["Nama peserta wajib diisi"],
          endsAt: ["Waktu selesai tidak boleh sebelum waktu mulai"],
        },
      }),
    ).toEqual({
      fullName: "Nama peserta wajib diisi",
      endsAt: "Waktu selesai tidak boleh sebelum waktu mulai",
    });
  });

  it("takes the first message when a field has several", () => {
    expect(
      readFieldErrors({ fieldErrors: { email: ["Wajib diisi", "Format tidak valid"] } }),
    ).toEqual({ email: "Wajib diisi" });
  });

  it("accepts a plain string message", () => {
    expect(readFieldErrors({ fieldErrors: { phone: "Format nomor tidak valid" } })).toEqual({
      phone: "Format nomor tidak valid",
    });
  });

  it("ignores empty values and non-string entries", () => {
    expect(
      readFieldErrors({
        fieldErrors: { a: [], b: ["   "], c: [42], d: null, e: "ok" },
      }),
    ).toEqual({ e: "ok" });
  });

  it("returns an empty map for missing or malformed details", () => {
    expect(readFieldErrors(undefined)).toEqual({});
    expect(readFieldErrors(null)).toEqual({});
    expect(readFieldErrors("boom")).toEqual({});
    expect(readFieldErrors({})).toEqual({});
    expect(readFieldErrors({ fieldErrors: [] })).toEqual({});
  });
});

describe("errorFor", () => {
  it("returns the first matching field message", () => {
    expect(errorFor({ name: "Wajib diisi" }, "title", "name")).toBe("Wajib diisi");
  });

  it("returns undefined when nothing matches", () => {
    expect(errorFor({ name: "Wajib diisi" }, "title")).toBeUndefined();
    expect(errorFor(null, "name")).toBeUndefined();
  });
});

describe("summarizeFieldErrors", () => {
  it("de-duplicates identical messages and keeps field order", () => {
    expect(
      summarizeFieldErrors({ a: "Wajib diisi", b: "Wajib diisi", c: "Format salah" }),
    ).toEqual(["Wajib diisi", "Format salah"]);
  });

  it("returns an empty list for no errors", () => {
    expect(summarizeFieldErrors({})).toEqual([]);
    expect(summarizeFieldErrors(undefined)).toEqual([]);
  });
});

describe("mergeFieldErrors", () => {
  it("lets later maps override earlier ones", () => {
    expect(mergeFieldErrors({ a: "server" }, { a: "local", b: "baru" })).toEqual({
      a: "local",
      b: "baru",
    });
  });

  it("skips null and undefined maps", () => {
    expect(mergeFieldErrors(null, { a: "satu" }, undefined)).toEqual({ a: "satu" });
  });
});
