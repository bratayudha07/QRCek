import { describe, expect, it } from "vitest";

import {
  base32Encode,
  hmacSha256,
  normalizeRecoveryCode,
  randomRecoveryCode,
  randomToken,
  safeEqual,
  toBase64Url,
} from "../domain/token";

/**
 * Pure unit tests: no D1, no clock, no network. These primitives are the whole
 * security model (ADR-002), so they get tested in isolation as well as through
 * the routes.
 */

const CROCKFORD = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}(-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}){4}$/;

describe("base32Encode", () => {
  it("encodes an empty buffer as an empty string", () => {
    expect(base32Encode(new Uint8Array([]))).toBe("");
  });

  it("encodes known byte patterns without ambiguity", () => {
    expect(base32Encode(new Uint8Array([0]))).toBe("00");
    expect(base32Encode(new Uint8Array([255]))).toBe("ZW");
  });

  it("never emits the excluded letters I, L, O, U", () => {
    for (let i = 0; i < 64; i += 1) {
      const encoded = base32Encode(new Uint8Array([i, i * 3, 255 - i]));
      expect(encoded).not.toMatch(/[ILOU]/);
    }
  });
});

describe("toBase64Url", () => {
  it("produces URL-safe output without padding", () => {
    const encoded = toBase64Url(new Uint8Array([251, 255, 190]));

    expect(encoded).not.toMatch(/[+/=]/);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("randomToken", () => {
  it("defaults to 256 bits of entropy (43 base64url chars)", () => {
    expect(randomToken()).toHaveLength(43);
  });

  it("honours the requested byte length", () => {
    // 16 bytes = 128 bits = 22 base64url chars (ADR-002 invite tokens).
    expect(randomToken(16)).toHaveLength(22);
  });

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken(16)));
    expect(tokens.size).toBe(200);
  });
});

describe("randomRecoveryCode", () => {
  it("is 5 groups of 4 Crockford symbols (100 bits)", () => {
    const code = randomRecoveryCode();

    expect(code).toMatch(CROCKFORD);
    expect(code.replace(/-/g, "")).toHaveLength(20);
  });

  it("does not repeat", () => {
    const codes = new Set(Array.from({ length: 200 }, () => randomRecoveryCode()));
    expect(codes.size).toBe(200);
  });
});

describe("normalizeRecoveryCode", () => {
  it("accepts lowercase, spaces, and the wrong separators", () => {
    expect(normalizeRecoveryCode(" abcd efgh ijkl mnop qrst ")).toBe("ABCDEFGH1JK1MN0PQRST");
  });

  it("maps the classic confusions O→0 and I/L→1", () => {
    expect(normalizeRecoveryCode("OOOO")).toBe("0000");
    expect(normalizeRecoveryCode("IL1l")).toBe("1111");
  });

  it("is idempotent", () => {
    const once = normalizeRecoveryCode(randomRecoveryCode());
    expect(normalizeRecoveryCode(once)).toBe(once);
  });
});

describe("hmacSha256", () => {
  it("is deterministic for the same pepper and value", async () => {
    const a = await hmacSha256("pepper", "token");
    const b = await hmacSha256("pepper", "token");

    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("changes when the pepper changes, so a stolen hash is not transferable", async () => {
    const a = await hmacSha256("pepper-one", "token");
    const b = await hmacSha256("pepper-two", "token");

    expect(a).not.toBe(b);
  });

  it("never returns the input", async () => {
    const value = "t0ken-value";
    expect(await hmacSha256("pepper", value)).not.toContain(value);
  });
});

describe("safeEqual", () => {
  it("returns true only for identical strings", () => {
    expect(safeEqual("abcdef", "abcdef")).toBe(true);
    expect(safeEqual("abcdef", "abcdeg")).toBe(false);
    expect(safeEqual("abcdef", "abcde")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
