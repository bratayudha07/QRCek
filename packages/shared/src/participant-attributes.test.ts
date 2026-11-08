import { describe, expect, it } from "vitest";

import type { AttributeField } from "./participant-attributes";
import {
  coerceAttributeValue,
  isTypeChangeAllowed,
  mergeParticipantAttributes,
  validateParticipantAttributes,
  validateTypeChange,
} from "./participant-attributes";

/**
 * Pure attribute rules (ADR-0014). No D1 here: these functions are the single
 * source of truth used by the API boundary and CSV import.
 */

function field(overrides: Partial<AttributeField> & Pick<AttributeField, "key" | "type">): AttributeField {
  return {
    required: false,
    options: [],
    scope: "participant",
    status: "active",
    ...overrides,
  };
}

describe("validateParticipantAttributes", () => {
  it("accepts one valid value per supported type", () => {
    const fields: AttributeField[] = [
      field({ key: "nama_ayah", type: "text" }),
      field({ key: "catatan", type: "textarea" }),
      field({ key: "email_wali", type: "email" }),
      field({ key: "telepon_wali", type: "phone" }),
      field({ key: "tinggi", type: "number" }),
      field({ key: "aktif", type: "checkbox" }),
      field({ key: "tanggal_lahir", type: "date" }),
      field({ key: "golongan", type: "select", options: ["A", "B"] }),
      field({ key: "minat", type: "multi_select", options: ["musik", "olahraga"] }),
    ];

    const result = validateParticipantAttributes(fields, {
      nama_ayah: "Budi",
      catatan: "catatan",
      email_wali: "wali@example.com",
      telepon_wali: "+6281234567890",
      tinggi: 170,
      aktif: true,
      tanggal_lahir: 1_700_000_000_000,
      golongan: "B",
      minat: ["musik", "olahraga"],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        nama_ayah: "Budi",
        catatan: "catatan",
        email_wali: "wali@example.com",
        telepon_wali: "+6281234567890",
        tinggi: 170,
        aktif: true,
        tanggal_lahir: 1_700_000_000_000,
        golongan: "B",
        minat: ["musik", "olahraga"],
      },
    });
  });

  it("rejects a missing required field", () => {
    const result = validateParticipantAttributes(
      [field({ key: "nisn", type: "text", required: true })],
      {},
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors).toEqual([{ key: "nisn", message: "wajib diisi" }]);
  });

  it("drops unknown keys instead of storing them", () => {
    const result = validateParticipantAttributes(
      [field({ key: "nisn", type: "text" })],
      { nisn: "123", rahasia: "jangan disimpan" },
    );

    expect(result).toEqual({ ok: true, value: { nisn: "123" } });
  });

  it("drops activity-scoped definitions entirely", () => {
    const fields: AttributeField[] = [field({ key: "kursi", type: "text", scope: "activity" })];

    expect(validateParticipantAttributes(fields, { kursi: "A1" })).toEqual({
      ok: true,
      value: {},
    });
  });

  it("rejects a value for an archived definition", () => {
    const fields: AttributeField[] = [field({ key: "lama", type: "text", status: "archived" })];

    expect(validateParticipantAttributes(fields, { lama: "x" })).toEqual({
      ok: false,
      errors: [{ key: "lama", message: "field sudah diarsipkan/nonaktif" }],
    });
  });

  it("validates values against their type", () => {
    const fields: AttributeField[] = [
      field({ key: "tinggi", type: "number" }),
      field({ key: "aktif", type: "checkbox" }),
      field({ key: "golongan", type: "select", options: ["A"] }),
      field({ key: "minat", type: "multi_select", options: ["musik"] }),
      field({ key: "email_wali", type: "email" }),
      field({ key: "telepon_wali", type: "phone" }),
      field({ key: "tanggal_lahir", type: "date" }),
    ];

    const result = validateParticipantAttributes(fields, {
      tinggi: "170",
      aktif: "true",
      golongan: "B",
      minat: ["musik", "musik"],
      email_wali: "bukan-email",
      telepon_wali: "abc",
      tanggal_lahir: -1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors.map((error) => error.key).sort()).toEqual([
      "aktif",
      "email_wali",
      "golongan",
      "minat",
      "tanggal_lahir",
      "telepon_wali",
      "tinggi",
    ]);
  });
});

describe("mergeParticipantAttributes", () => {
  it("keeps absent keys and removes an optional value with null", () => {
    const fields = [field({ key: "nisn", type: "text" }), field({ key: "wali", type: "text" })];

    const result = mergeParticipantAttributes(
      { nisn: "123", wali: "Budi" },
      { wali: null },
      fields,
    );

    expect(result).toEqual({ ok: true, value: { nisn: "123" } });
  });

  it("does not remove a required value", () => {
    const result = mergeParticipantAttributes(
      { nisn: "123" },
      { nisn: null },
      [field({ key: "nisn", type: "text", required: true })],
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors[0]?.key).toBe("nisn");
  });

  it("does not require existing participants to backfill a newly required field", () => {
    const result = mergeParticipantAttributes(
      {},
      { wali: "Budi" },
      [
        field({ key: "nisn", type: "text", required: true }),
        field({ key: "wali", type: "text" }),
      ],
    );

    expect(result).toEqual({ ok: true, value: { wali: "Budi" } });
  });

  it("rejects a new value for an archived field but preserves the old one", () => {
    const fields = [field({ key: "lama", type: "text", status: "archived" })];

    expect(mergeParticipantAttributes({ lama: "x" }, { lama: "y" }, fields).ok).toBe(false);
    expect(mergeParticipantAttributes({ lama: "x" }, { lain: "y" }, fields)).toEqual({
      ok: true,
      value: { lama: "x" },
    });
  });

  it("ignores undefined values", () => {
    expect(
      mergeParticipantAttributes({ nisn: "123" }, { nisn: undefined }, [
        field({ key: "nisn", type: "text" }),
      ]),
    ).toEqual({ ok: true, value: { nisn: "123" } });
  });
});

describe("coerceAttributeValue", () => {
  it("converts CSV strings to stored representations", () => {
    expect(coerceAttributeValue("number", "12.5")).toEqual({ ok: true, value: 12.5 });
    expect(coerceAttributeValue("checkbox", "ya")).toEqual({ ok: true, value: true });
    expect(coerceAttributeValue("checkbox", "tidak")).toEqual({ ok: true, value: false });
    expect(coerceAttributeValue("multi_select", "musik, olahraga")).toEqual({
      ok: true,
      value: ["musik", "olahraga"],
    });
    expect(coerceAttributeValue("date", "2026-11-06")).toEqual({
      ok: true,
      value: Date.parse("2026-11-06"),
    });
  });

  it("reports invalid input instead of guessing", () => {
    expect(coerceAttributeValue("number", "abc").ok).toBe(false);
    expect(coerceAttributeValue("checkbox", "mungkin").ok).toBe(false);
    expect(coerceAttributeValue("date", "06/11/2026").ok).toBe(false);
  });
});

describe("type changes", () => {
  it("allows only the documented transitions", () => {
    expect(isTypeChangeAllowed("text", "select")).toBe(true);
    expect(isTypeChangeAllowed("number", "text")).toBe(true);
    expect(isTypeChangeAllowed("select", "text")).toBe(true);
    expect(isTypeChangeAllowed("select", "number")).toBe(false);
    expect(isTypeChangeAllowed("multi_select", "text")).toBe(false);
  });

  it("checks stored values against the target type", () => {
    expect(validateTypeChange("text", "select", ["A", "B"], ["A", "C"])).toEqual({
      ok: false,
      invalidValues: ["C"],
    });
    expect(validateTypeChange("text", "multi_select", ["A", "B"], ["A", "B"])).toEqual({
      ok: true,
      invalidValues: [],
    });
  });
});
