import { describe, expect, it } from "vitest";

import { QR_ROTATION_REASON_MAX, QR_ROTATION_REASON_MIN } from "../qr";
import { QrIdentityParamsSchema, RotateQrRequestSchema } from "./qr";

describe("RotateQrRequestSchema", () => {
  it("requires a trimmed reason of at least three characters", () => {
    expect(RotateQrRequestSchema.parse({ reason: "  kartu hilang  " })).toEqual({
      reason: "kartu hilang",
    });

    for (const reason of ["", "   ", "ab"]) {
      expect(RotateQrRequestSchema.safeParse({ reason }).success).toBe(false);
    }
  });

  it("rejects a reason longer than the audit column allows", () => {
    const reason = "x".repeat(QR_ROTATION_REASON_MAX);
    expect(RotateQrRequestSchema.safeParse({ reason }).success).toBe(true);
    expect(RotateQrRequestSchema.safeParse({ reason: `${reason}x` }).success).toBe(false);
  });

  it("rejects unknown fields and a missing reason", () => {
    expect(RotateQrRequestSchema.safeParse({}).success).toBe(false);
    expect(RotateQrRequestSchema.safeParse({ reason: "kartu hilang", token: "x" }).success).toBe(
      false,
    );
  });

  it("keeps the minimum below the maximum", () => {
    expect(QR_ROTATION_REASON_MIN).toBeLessThan(QR_ROTATION_REASON_MAX);
  });
});

describe("QrIdentityParamsSchema", () => {
  it("accepts bounded event and participant ids and rejects oversized ones", () => {
    expect(
      QrIdentityParamsSchema.safeParse({ eventId: "evt-1", participantId: "p-1" }).success,
    ).toBe(true);
    expect(
      QrIdentityParamsSchema.safeParse({ eventId: "e".repeat(65), participantId: "p-1" }).success,
    ).toBe(false);
  });
});
