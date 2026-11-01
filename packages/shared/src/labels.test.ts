import { describe, expect, it } from "vitest";

import {
  LabelConfigRequestSchema,
  MAX_LABEL_FIELDS,
  QR_LABEL_BATCH_MAX,
  QrLabelRequestSchema,
  formatLabelValue,
} from "./labels";

/**
 * Shared contract tests: these schemas are the only runtime validation between
 * the SPA and the Worker, so the limits must be tested here rather than only in
 * the route handler.
 */

describe("QrLabelRequestSchema", () => {
  it("applies the format and batch defaults", () => {
    const parsed = QrLabelRequestSchema.parse({});

    expect(parsed.format).toBe("a4");
    expect(parsed.limit).toBe(QR_LABEL_BATCH_MAX);
    expect(parsed.fields).toBeUndefined();
    expect(parsed.participantIds).toBeUndefined();
  });

  it("accepts an explicit selection without a cursor", () => {
    const parsed = QrLabelRequestSchema.parse({
      participantIds: ["01J1", "01J2"],
      format: "sticker",
    });

    expect(parsed.participantIds).toEqual(["01J1", "01J2"]);
  });

  it("rejects unknown fields, duplicate fields, and more than four fields", () => {
    for (const fields of [
      ["password"],
      ["fullName", "fullName"],
      ["fullName", "externalRef", "category", "phone", "email"],
      [],
    ]) {
      expect(QrLabelRequestSchema.safeParse({ fields }).success).toBe(false);
    }

    expect(MAX_LABEL_FIELDS).toBe(4);
  });

  it("rejects duplicate participants and more than one batch", () => {
    expect(QrLabelRequestSchema.safeParse({ participantIds: ["01J1", "01J1"] }).success).toBe(
      false,
    );

    const tooMany = Array.from({ length: QR_LABEL_BATCH_MAX + 1 }, (_, i) => `p-${i}`);
    expect(QrLabelRequestSchema.safeParse({ participantIds: tooMany }).success).toBe(false);
  });

  it("rejects a cursor together with an explicit selection", () => {
    expect(
      QrLabelRequestSchema.safeParse({ participantIds: ["01J1"], cursor: "abc" }).success,
    ).toBe(false);
  });

  it("rejects a page larger than the batch limit and unknown keys", () => {
    expect(QrLabelRequestSchema.safeParse({ limit: QR_LABEL_BATCH_MAX + 1 }).success).toBe(false);
    expect(QrLabelRequestSchema.safeParse({ extra: true }).success).toBe(false);
  });
});

describe("LabelConfigRequestSchema", () => {
  it("requires at least one field and defaults the event name to shown", () => {
    const parsed = LabelConfigRequestSchema.parse({ fields: ["fullName"] });

    expect(parsed).toEqual({ fields: ["fullName"], showEventName: true });
    expect(LabelConfigRequestSchema.safeParse({ fields: [] }).success).toBe(false);
  });

  it("rejects a field outside the participant catalog", () => {
    expect(LabelConfigRequestSchema.safeParse({ fields: ["qrToken"] }).success).toBe(false);
  });
});

describe("formatLabelValue", () => {
  it("collapses whitespace and treats nullish values as empty", () => {
    expect(formatLabelValue("  Siti\nAminah  ", 120)).toBe("Siti Aminah");
    expect(formatLabelValue(null, 120)).toBe("");
    expect(formatLabelValue(undefined, 120)).toBe("");
  });

  it("truncates with an ellipsis instead of silently clipping", () => {
    expect(formatLabelValue("abcdef", 4)).toBe("abc…");
    expect(formatLabelValue("abc", 4)).toBe("abc");
  });
});
