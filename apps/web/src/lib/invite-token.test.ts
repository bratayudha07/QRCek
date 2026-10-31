import { describe, expect, it } from "vitest";

import { readInviteToken } from "./invite-token";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUv"; // 22 chars = 128 bits base64url

describe("readInviteToken", () => {
  it("reads the token from #t=", () => {
    expect(readInviteToken(`#t=${TOKEN}`)).toBe(TOKEN);
  });

  it("accepts a fragment without the leading #", () => {
    expect(readInviteToken(`t=${TOKEN}`)).toBe(TOKEN);
  });

  it("ignores extra fragment parameters", () => {
    expect(readInviteToken(`#utm=x&t=${TOKEN}&z=1`)).toBe(TOKEN);
  });

  it("returns null for an empty or unrelated fragment", () => {
    expect(readInviteToken("")).toBeNull();
    expect(readInviteToken("#")).toBeNull();
    expect(readInviteToken("#utm=x")).toBeNull();
    expect(readInviteToken("#t=")).toBeNull();
  });

  it("rejects tokens outside the documented length bounds", () => {
    expect(readInviteToken("#t=short")).toBeNull();
    expect(readInviteToken(`#t=${"a".repeat(513)}`)).toBeNull();
  });
});
