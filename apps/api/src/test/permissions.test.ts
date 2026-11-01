import { describe, expect, it } from "vitest";

import { ACTIONS, isAllowed, minMembershipFor } from "../domain/permissions";
import type { Action } from "../domain/permissions";

/**
 * Executable copy of `docs/RENCANA_PENGUJIAN.md` §5.1.
 *
 * The expected table is written out by hand on purpose: reading it from the
 * implementation would make the test tautological. A new action without an
 * entry here fails, which is the point.
 */
const EXPECTED: Record<Action, { superadmin: boolean; eventAdmin: boolean; officer: boolean }> = {
  "event:create": { superadmin: true, eventAdmin: true, officer: false },
  "event:read": { superadmin: true, eventAdmin: true, officer: true },
  "event:update": { superadmin: true, eventAdmin: true, officer: false },
  "event:delete": { superadmin: true, eventAdmin: false, officer: false },
  "invite:manage": { superadmin: true, eventAdmin: true, officer: false },
  "participant:read": { superadmin: true, eventAdmin: true, officer: true },
  "participant:write": { superadmin: true, eventAdmin: true, officer: false },
  "participant:import": { superadmin: true, eventAdmin: true, officer: false },
  "qr:print": { superadmin: true, eventAdmin: true, officer: false },
  scan: { superadmin: true, eventAdmin: true, officer: true },
  "recap:read": { superadmin: true, eventAdmin: true, officer: true },
  "attendance:correct": { superadmin: true, eventAdmin: true, officer: false },
  "audit:read": { superadmin: true, eventAdmin: true, officer: false },
  "sync:configure": { superadmin: true, eventAdmin: true, officer: false },
};

describe("authorization matrix", () => {
  it("covers every action defined in the domain", () => {
    expect([...ACTIONS].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("lets superadmin do everything, with or without a membership", () => {
    for (const action of ACTIONS) {
      expect(isAllowed({ role: "superadmin", action, membershipRole: null })).toBe(EXPECTED[action].superadmin);
      expect(isAllowed({ role: "superadmin", action, membershipRole: "officer" })).toBe(true);
    }
  });

  it("matches the documented matrix for event_admin and officer", () => {
    for (const action of ACTIONS) {
      expect(isAllowed({ role: "event_admin", action, membershipRole: "event_admin" })).toBe(
        EXPECTED[action].eventAdmin,
      );
      expect(isAllowed({ role: "officer", action, membershipRole: "officer" })).toBe(
        EXPECTED[action].officer,
      );
    }
  });

  it("denies every event action without an active membership, except creating a new event", () => {
    for (const action of ACTIONS) {
      if (action === "event:create") continue;

      expect(isAllowed({ role: "event_admin", action, membershipRole: null })).toBe(false);
      expect(isAllowed({ role: "officer", action, membershipRole: null })).toBe(false);
    }
  });

  /** ADR-007: self-registered admins must be able to start their own event. */
  it("lets a global event_admin create an event without any membership", () => {
    expect(isAllowed({ role: "event_admin", action: "event:create", membershipRole: null })).toBe(
      true,
    );
    expect(isAllowed({ role: "officer", action: "event:create", membershipRole: null })).toBe(false);
  });

  /** The membership role wins over the global role for a specific event. */
  it("does not let a global admin act as admin in an event they joined as officer", () => {
    expect(
      isAllowed({ role: "event_admin", action: "invite:manage", membershipRole: "officer" }),
    ).toBe(false);

    expect(isAllowed({ role: "event_admin", action: "scan", membershipRole: "officer" })).toBe(true);
  });

  it("keeps event deletion superadmin-only and event creation globally grantable", () => {
    for (const action of ACTIONS) {
      const minimum = minMembershipFor(action);

      if (action === "event:delete") {
        expect(minimum).toBeNull();
      } else if (action === "event:create") {
        // No membership can grant it; the global role does (MIN_GLOBAL_ROLE).
        expect(minimum).toBeNull();
      } else {
        expect(minimum).not.toBeNull();
      }
    }
  });
});
