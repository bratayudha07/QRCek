import { describe, expect, it } from "vitest";

import type { ParticipantSummary } from "@absensi/shared";

import { mergeSelectedResult, participantOptionHint } from "./participant-picker";

function participant(id: string, overrides: Partial<ParticipantSummary> = {}): ParticipantSummary {
  return {
    id,
    externalRef: null,
    fullName: `Peserta ${id}`,
    phone: null,
    email: null,
    category: null,
    categoryId: "cat-1",
    attributes: {},
    note: null,
    status: "active",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("mergeSelectedResult", () => {
  it("returns the results unchanged when nothing is selected", () => {
    const results = [participant("a"), participant("b")];
    expect(mergeSelectedResult(results, null)).toEqual(results);
  });

  it("does not duplicate a selected participant already in the results", () => {
    const results = [participant("a"), participant("b")];
    expect(mergeSelectedResult(results, participant("b"))).toEqual(results);
  });

  it("prepends a selected participant that the new search no longer returns", () => {
    const selected = participant("old");
    expect(mergeSelectedResult([participant("a")], selected).map((item) => item.id)).toEqual([
      "old",
      "a",
    ]);
  });

  it("does not mutate the input array", () => {
    const results = [participant("a")];
    mergeSelectedResult(results, participant("old"));
    expect(results.map((item) => item.id)).toEqual(["a"]);
  });
});

describe("participantOptionHint", () => {
  it("prefers the external reference", () => {
    expect(participantOptionHint({ externalRef: "NIS-001", category: "Santri" })).toBe("NIS-001");
  });

  it("falls back to the category", () => {
    expect(participantOptionHint({ externalRef: null, category: "Santri" })).toBe("Santri");
  });

  it("falls back to a neutral label", () => {
    expect(participantOptionHint({ externalRef: null, category: null })).toBe("Tanpa kategori");
  });
});
