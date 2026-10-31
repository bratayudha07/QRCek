import { describe, expect, it } from "vitest";

import { newId } from "../domain/ids";

const ULID = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

describe("newId", () => {
  it("is 26 Crockford base32 characters", () => {
    expect(newId(1_760_000_000_000)).toMatch(ULID);
  });

  it("sorts lexicographically by creation time", () => {
    const earlier = newId(1_760_000_000_000);
    const later = newId(1_760_000_000_001);

    expect(earlier < later).toBe(true);
  });

  it("does not repeat within the same millisecond", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId(1_760_000_000_000)));

    expect(ids.size).toBe(500);
  });
});
