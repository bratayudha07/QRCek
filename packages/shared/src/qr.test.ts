import { describe, expect, it } from "vitest";

import { decideQrScan } from "./qr";

/**
 * T-Q4: QR scope and participant status (ADR-0017, FR-054–FR-061).
 *
 * The decision is pure so the cross-Tema and inactive rules can be exhausted
 * without D1. The route-level tests prove the same rules are actually wired.
 */

describe("decideQrScan", () => {
  it("accepts an active participant in its own Tema", () => {
    expect(
      decideQrScan({
        contextThemeId: "theme-a",
        identityThemeId: "theme-a",
        participantStatus: "active",
      }),
    ).toEqual({ outcome: "usable" });
  });

  it("rejects a token from another Tema before looking at participant status", () => {
    // Order matters: a cross-Tema token must not reveal whether the other
    // participant is active or inactive.
    for (const participantStatus of ["active", "inactive"] as const) {
      expect(
        decideQrScan({
          contextThemeId: "theme-a",
          identityThemeId: "theme-b",
          participantStatus,
        }),
      ).toEqual({ outcome: "rejected", reason: "wrong_theme" });
    }
  });

  it("rejects an inactive participant in the correct Tema", () => {
    expect(
      decideQrScan({
        contextThemeId: "theme-a",
        identityThemeId: "theme-a",
        participantStatus: "inactive",
      }),
    ).toEqual({ outcome: "rejected", reason: "participant_inactive" });
  });
});
