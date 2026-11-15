import type { EventAccessRole, EventStatus, QrIdentityMetadata } from "@absensi/shared";
import { describe, expect, it } from "vitest";

import { formatDateTime } from "./format";
import {
  canRotateQr,
  nextRotationRequest,
  qrIdentityPath,
  qrRotatePath,
  rotationReasonError,
  rotationSummary,
} from "./qr-identities";

/**
 * Pure helpers behind the QR identity card. Node-only, no DOM: the card itself
 * is verified manually (docs/RENCANA_PENGUJIAN.md), while the gating, the reason
 * bounds, and the request shape are covered here.
 */

const ROLES: EventAccessRole[] = ["superadmin", "event_admin", "officer"];
const STATUSES: EventStatus[] = ["draft", "active", "closed", "archived"];

function identity(overrides: Partial<QrIdentityMetadata> = {}): QrIdentityMetadata {
  return {
    participantId: "p-1",
    issuedAt: Date.UTC(2026, 10, 14, 2, 0),
    rotatedAt: null,
    rotationCount: 0,
    keyVersion: 1,
    ...overrides,
  };
}

describe("qr paths", () => {
  it("builds the metadata and rotation paths", () => {
    expect(qrIdentityPath("ev-1", "p-1")).toBe("/api/events/ev-1/participants/p-1/qr");
    expect(qrRotatePath("ev-1", "p-1")).toBe("/api/events/ev-1/participants/p-1/qr/rotate");
  });

  it("encodes ids that contain reserved characters", () => {
    expect(qrIdentityPath("ev 1/x", "p?1#2")).toBe(
      "/api/events/ev%201%2Fx/participants/p%3F1%232/qr",
    );
    expect(qrRotatePath("ev 1/x", "p?1#2")).toBe(
      "/api/events/ev%201%2Fx/participants/p%3F1%232/qr/rotate",
    );
  });
});

describe("canRotateQr", () => {
  it("allows Admin Acara and Super Admin on a non-archived Tema", () => {
    for (const status of STATUSES) {
      expect(canRotateQr("event_admin", status)).toBe(status !== "archived");
      expect(canRotateQr("superadmin", status)).toBe(status !== "archived");
    }
  });

  it("never allows a Petugas", () => {
    for (const status of STATUSES) {
      expect(canRotateQr("officer", status)).toBe(false);
    }
  });

  it("covers every role and status pair", () => {
    const allowed = ROLES.flatMap((role) =>
      STATUSES.filter((status) => canRotateQr(role, status)).map((status) => `${role}:${status}`),
    );

    expect(allowed).toEqual([
      "superadmin:draft",
      "superadmin:active",
      "superadmin:closed",
      "event_admin:draft",
      "event_admin:active",
      "event_admin:closed",
    ]);
  });
});

describe("rotationReasonError", () => {
  it("rejects fewer than 3 trimmed characters", () => {
    expect(rotationReasonError("")).toBe("Alasan rotasi minimal 3 karakter");
    expect(rotationReasonError("ab")).toBe("Alasan rotasi minimal 3 karakter");
    expect(rotationReasonError("  ab  ")).toBe("Alasan rotasi minimal 3 karakter");
  });

  it("accepts the 3 and 500 character bounds", () => {
    expect(rotationReasonError("abc")).toBeNull();
    expect(rotationReasonError("  abc  ")).toBeNull();
    expect(rotationReasonError("a".repeat(500))).toBeNull();
  });

  it("rejects more than 500 trimmed characters", () => {
    expect(rotationReasonError("a".repeat(501))).toBe("Alasan rotasi maksimal 500 karakter");
  });

  it("measures the trimmed value, not the padded one", () => {
    expect(rotationReasonError(`  ${"a".repeat(500)}  `)).toBeNull();
    expect(rotationReasonError(`  ${"a".repeat(501)}  `)).toBe(
      "Alasan rotasi maksimal 500 karakter",
    );
  });
});

describe("rotationSummary", () => {
  it("reports a participant without a credential", () => {
    expect(rotationSummary(null, "UTC")).toBe("Belum pernah diterbitkan");
  });

  it("reports a credential that has never been rotated", () => {
    const summary = rotationSummary(identity(), "UTC");

    expect(summary).toContain("Diterbitkan");
    expect(summary).toContain(formatDateTime(Date.UTC(2026, 10, 14, 2, 0), "UTC"));
    expect(summary).toContain("belum pernah dirotasi");
    expect(summary).not.toContain("kali dirotasi");
  });

  it("reports the count and the last rotation time", () => {
    const summary = rotationSummary(
      identity({ rotationCount: 2, rotatedAt: Date.UTC(2026, 10, 15, 3, 30) }),
      "UTC",
    );

    expect(summary).toContain("2 kali dirotasi");
    expect(summary).toContain(`terakhir ${formatDateTime(Date.UTC(2026, 10, 15, 3, 30), "UTC")}`);
  });

  it("omits the last rotation time when the timestamp is missing", () => {
    const summary = rotationSummary(identity({ rotationCount: 1, rotatedAt: null }), "UTC");

    expect(summary).toContain("1 kali dirotasi");
    expect(summary).not.toContain("terakhir");
  });

  it("never leaks a token, hash, or key version", () => {
    const summary = rotationSummary(identity({ rotationCount: 3, rotatedAt: 0 }), "UTC");

    expect(summary).not.toContain("absensi:v1:");
    expect(summary).not.toContain("keyVersion");
    expect(summary).not.toContain("Versi kunci");
  });
});

describe("nextRotationRequest", () => {
  it("trims the reason and echoes the visible rotation count", () => {
    expect(nextRotationRequest(identity({ rotationCount: 4 }), "  kartu hilang  ")).toEqual({
      reason: "kartu hilang",
      expectedRotationCount: 4,
    });
  });

  it("keeps a zero count, so a never-rotated credential still guards the write", () => {
    expect(nextRotationRequest(identity(), "kartu rusak")).toEqual({
      reason: "kartu rusak",
      expectedRotationCount: 0,
    });
  });
});
