import { describe, expect, it } from "vitest";

import type {
  EntitlementContext,
  EntitlementLevel,
  EntitlementRule,
  EntitlementStatus,
} from "./entitlements";
import {
  ENTITLEMENT_PRIORITY,
  isEntitlementComplete,
  missingEntitlementCategories,
  resolveEntitlement,
} from "./entitlements";

/**
 * T-040/T-041/T-042 (RENCANA_PENGUJIAN.md §9.3).
 *
 * The expected table is written by hand so removing one priority step, changing
 * the default, or dropping the session filter makes a test fail.
 */

const CONTEXT: EntitlementContext = {
  participantId: "p1",
  categoryId: "c1",
  activityId: "a1",
  sessionId: "s1",
};

const LEVELS: readonly EntitlementLevel[] = [
  "individual_session",
  "category_session",
  "individual_activity",
  "category_activity",
  "theme_default",
];

const STATUSES: readonly EntitlementStatus[] = ["inherit", "allowed", "denied"];

function rule(level: EntitlementLevel, status: EntitlementStatus): EntitlementRule {
  return { level, status };
}

describe("resolveEntitlement — five levels × three statuses", () => {
  it.each(LEVELS)("resolves a single %s rule by its status", (level) => {
    expect(resolveEntitlement(CONTEXT, [rule(level, "allowed")])).toEqual({
      allowed: true,
      status: "allowed",
      decidedBy: level,
    });
    expect(resolveEntitlement(CONTEXT, [rule(level, "denied")])).toEqual({
      allowed: false,
      status: "denied",
      decidedBy: level,
    });
    expect(resolveEntitlement(CONTEXT, [rule(level, "inherit")])).toEqual({
      allowed: false,
      status: "denied",
      decidedBy: null,
    });
  });

  it("covers every level and status combination without an accidental default", () => {
    for (const level of LEVELS) {
      for (const status of STATUSES) {
        const result = resolveEntitlement(CONTEXT, [rule(level, status)]);
        if (status === "inherit") {
          expect(result.decidedBy).toBeNull();
          expect(result.allowed).toBe(false);
        } else {
          expect(result.decidedBy).toBe(level);
          expect(result.allowed).toBe(status === "allowed");
        }
      }
    }
  });
});

describe("resolveEntitlement — priority", () => {
  it("uses the documented priority order", () => {
    expect(ENTITLEMENT_PRIORITY).toEqual([
      "individual_session",
      "category_session",
      "individual_activity",
      "category_activity",
      "theme_default",
    ]);
  });

  it("lets a higher level decide even when a lower level disagrees", () => {
    // Going from highest to lowest: a denied higher level is not overridden by
    // an allowed lower level (BR-020). Removing a priority step changes the
    // decidedBy and/or the decision.
    for (let index = 0; index < LEVELS.length; index += 1) {
      const higher = LEVELS[index] as EntitlementLevel;
      const lowerLevels = LEVELS.slice(index + 1);
      if (lowerLevels.length === 0) continue;

      const rules = [
        rule(higher, "denied"),
        ...lowerLevels.map((level) => rule(level, "allowed")),
      ];

      expect(resolveEntitlement(CONTEXT, rules)).toEqual({
        allowed: false,
        status: "denied",
        decidedBy: higher,
      });
    }
  });

  it("continues past inherit to the next deciding level", () => {
    const rules = [
      rule("individual_session", "inherit"),
      rule("category_session", "inherit"),
      rule("individual_activity", "allowed"),
      rule("category_activity", "denied"),
    ];

    expect(resolveEntitlement(CONTEXT, rules)).toEqual({
      allowed: true,
      status: "allowed",
      decidedBy: "individual_activity",
    });
  });

  it("stops at the first allowed rule instead of reading a lower denied rule", () => {
    const rules = [
      rule("category_session", "allowed"),
      rule("category_activity", "denied"),
    ];

    expect(resolveEntitlement(CONTEXT, rules)).toEqual({
      allowed: true,
      status: "allowed",
      decidedBy: "category_session",
    });
  });
});

describe("resolveEntitlement — session relevance and default deny", () => {
  it("denies with decidedBy=null when no rule exists", () => {
    expect(resolveEntitlement(CONTEXT, [])).toEqual({
      allowed: false,
      status: "denied",
      decidedBy: null,
    });
  });

  it("ignores session-level rules when the context has no session", () => {
    const activityOnly: EntitlementContext = { ...CONTEXT, sessionId: null };

    expect(
      resolveEntitlement(activityOnly, [
        rule("individual_session", "allowed"),
        rule("category_session", "allowed"),
        rule("category_activity", "denied"),
      ]),
    ).toEqual({
      allowed: false,
      status: "denied",
      decidedBy: "category_activity",
    });
  });

  it("keeps an individual override when a category rule changes", () => {
    // AC-014: changing the category rule must not remove the individual rule.
    expect(
      resolveEntitlement(CONTEXT, [
        rule("individual_activity", "allowed"),
        rule("category_activity", "denied"),
      ]),
    ).toEqual({
      allowed: true,
      status: "allowed",
      decidedBy: "individual_activity",
    });
  });

  it("lets a session-level rule shadow the activity rule only for that context", () => {
    expect(
      resolveEntitlement(CONTEXT, [
        rule("individual_session", "denied"),
        rule("individual_activity", "allowed"),
      ]),
    ).toEqual({
      allowed: false,
      status: "denied",
      decidedBy: "individual_session",
    });

    // A different session has no session rule at all; it inherits Aktivitas.
    expect(
      resolveEntitlement(
        { ...CONTEXT, sessionId: "s2" },
        [rule("individual_activity", "allowed")],
      ),
    ).toEqual({
      allowed: true,
      status: "allowed",
      decidedBy: "individual_activity",
    });
  });
});

describe("entitlement completeness helpers", () => {
  it("reports active categories without a rule in deterministic input order", () => {
    expect(
      missingEntitlementCategories(["c1", "c2", "c3"], ["c2", "c4"]),
    ).toEqual(["c1", "c3"]);
  });

  it("is complete only when every active category is configured", () => {
    expect(isEntitlementComplete(["c1", "c2"], ["c1", "c2"])).toBe(true);
    expect(isEntitlementComplete(["c1", "c2"], ["c1"])).toBe(false);
    expect(isEntitlementComplete([], [])).toBe(true);
  });
});
