import { describe, expect, it } from "vitest";

import { AUDIT_FIELDS, REDACTED, filterAuditFields, isSensitiveAuditField } from "./audit-allowlist";

/** T-141: audit never stores tokens, secrets, hashes, or PII. */

describe("filterAuditFields", () => {
  it("keeps only allowlisted theme fields", () => {
    expect(
      filterAuditFields("theme", {
        name: "Seminar",
        status: "draft",
        slug: "seminar-abc123",
        createdBy: "user-1",
      }),
    ).toEqual({ name: "Seminar", status: "draft" });
  });

  it("keeps only allowlisted activity and session fields", () => {
    expect(
      filterAuditFields("activity", {
        name: "Kehadiran",
        transactionType: "attendance",
        themeId: "theme-1",
        createdBy: "user-1",
      }),
    ).toEqual({ name: "Kehadiran", transactionType: "attendance" });

    expect(
      filterAuditFields("session", {
        name: "Pagi",
        startsAt: 1,
        activityId: "activity-1",
      }),
    ).toEqual({ name: "Pagi", startsAt: 1 });
  });

  it("redacts a sensitive field instead of storing its value", () => {
    const snapshot = filterAuditFields("theme", {
      name: "Seminar",
      phone: "08123456789",
      email: "admin@example.com",
      tokenHash: "hash",
      qrCiphertext: "ciphertext",
      qrEncryptionKey: "secret",
    });

    expect(snapshot).toMatchObject({
      name: "Seminar",
      phone: REDACTED,
      email: REDACTED,
      tokenHash: REDACTED,
      qrCiphertext: REDACTED,
      qrEncryptionKey: REDACTED,
    });
    expect(JSON.stringify(snapshot)).not.toContain("08123456789");
    expect(JSON.stringify(snapshot)).not.toContain("admin@example.com");
  });

  it("returns null when there is nothing allowlisted to record", () => {
    expect(filterAuditFields("theme", null)).toBeNull();
    expect(filterAuditFields("theme", { slug: "x", createdBy: "u" })).toBeNull();
  });

  it("does not include a sensitive field that was not present", () => {
    expect(filterAuditFields("theme", { name: "Seminar" })).toEqual({ name: "Seminar" });
  });
});

describe("allowlist table", () => {
  it("never allowlists an obviously sensitive field", () => {
    for (const fields of Object.values(AUDIT_FIELDS)) {
      for (const field of fields) {
        expect(isSensitiveAuditField(field)).toBe(false);
      }
    }
  });

  it("covers the three Q1 entity types", () => {
    expect(Object.keys(AUDIT_FIELDS).sort()).toEqual(["activity", "session", "theme"]);
  });
});
