import { describe, expect, it } from "vitest";

import { allowedTransitions, canTransition } from "../domain/event-status";
import { eventSlug, slugify } from "../domain/slug";

describe("event lifecycle", () => {
  it.each([
    ["draft", "active", true],
    ["draft", "closed", false],
    ["draft", "archived", false],
    ["active", "closed", true],
    ["active", "archived", false],
    ["closed", "active", true],
    ["closed", "archived", true],
    ["archived", "active", false],
    ["archived", "closed", false],
  ] as const)("%s → %s = %s", (from, to, expected) => {
    expect(canTransition(from, to)).toBe(expected);
  });

  it("treats archived as final", () => {
    expect(allowedTransitions("archived")).toEqual([]);
  });
});

describe("event slug", () => {
  it("normalizes accents and punctuation", () => {
    expect(slugify("Wisuda Santri 2026!")).toBe("wisuda-santri-2026");
  });

  it("falls back when the name has no usable characters", () => {
    expect(slugify("!!!")).toBe("acara");
  });

  it("appends an id suffix so uniqueness does not need a retry loop", () => {
    const slug = eventSlug("Wisuda", "01JABCDEFGHJKMNPQRSTVWXYZ");
    expect(slug).toBe("wisuda-tvwxyz");
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  it("keeps long names under the column limit", () => {
    const slug = eventSlug("A".repeat(200), "01JABCDEFGHJKMNPQRSTVWXYZ");
    expect(slug.length).toBeLessThanOrEqual(60);
  });
});
