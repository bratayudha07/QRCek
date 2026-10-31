/**
 * Token primitives (ADR-002: passwordless, HMAC-hashed tokens).
 *
 * Everything here is pure or uses Web Crypto only — no I/O, so it is cheap to
 * unit test and safe to call inside a 10 ms CPU budget.
 *
 * Entropy sources are 128–256 bit, so a fast keyed hash (HMAC-SHA256) is the
 * right primitive. A slow KDF would be wrong for two reasons: it adds nothing
 * against brute force on a 2^128 space, and it does not fit the free tier CPU
 * budget that made PBKDF2 unusable in the first place.
 */

/** Crockford base32: no I/L/O/U, so codes survive being read aloud or typed. */
export const BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BASE32 = BASE32_ALPHABET;

/** Recovery codes: 5 groups of 4 characters = 20 symbols = 100 bits. */
const RECOVERY_GROUPS = 5;
const RECOVERY_GROUP_SIZE = 4;

export function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;

  for (const byte of bytes) {
    buffer = ((buffer << 8) | byte) & 0xfffff;
    bits += 8;

    while (bits >= 5) {
      out += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    out += BASE32[(buffer << (5 - bits)) & 31];
  }

  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** Opaque token. Default 32 bytes = 256 bits, used for sessions. */
export function randomToken(byteLength = 32): string {
  return toBase64Url(randomBytes(byteLength));
}

/**
 * Human-typeable recovery code, e.g. `ABCD-EFGH-IJKL-MNOP-QRST`.
 *
 * `byte % 32` has no modulo bias because 256 is a multiple of 32.
 */
export function randomRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_GROUPS * RECOVERY_GROUP_SIZE);
  const chars = Array.from(bytes, (byte) => BASE32[byte % 32] ?? "0");
  const groups: string[] = [];

  for (let i = 0; i < RECOVERY_GROUPS; i += 1) {
    groups.push(chars.slice(i * RECOVERY_GROUP_SIZE, (i + 1) * RECOVERY_GROUP_SIZE).join(""));
  }

  return groups.join("-");
}

/**
 * Accepts what a human actually types: lowercase, spaces, wrong separators,
 * and the classic confusions (`O`/`0`, `I`/`L`/`1`).
 */
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

let cachedKey: { pepper: string; key: Promise<CryptoKey> } | null = null;

function hmacKey(pepper: string): Promise<CryptoKey> {
  if (cachedKey?.pepper === pepper) return cachedKey.key;

  const key = crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  cachedKey = { pepper, key };
  return key;
}

/**
 * `HMAC-SHA256(pepper, value)`, base64url.
 *
 * Keyed hashing means a leaked database does not let an attacker precompute
 * token hashes without also stealing the pepper (which lives in `wrangler
 * secret`, never in D1 or the frontend bundle).
 */
export async function hmacSha256(pepper: string, value: string): Promise<string> {
  const key = await hmacKey(pepper);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(signature));
}

/** Constant-time comparison, for cases where a DB lookup is not enough. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}
