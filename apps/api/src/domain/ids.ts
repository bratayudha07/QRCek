import { BASE32_ALPHABET, base32Encode, randomBytes } from "./token";

/**
 * ULID-shaped identifier: 48-bit timestamp + 80 bits of randomness, Crockford
 * base32, 26 characters, lexicographically sortable by creation time.
 *
 * Implemented by hand instead of adding a dependency: it is ~15 lines and the
 * only property the system relies on is "opaque, unique, time-sortable".
 */
export function newId(now: number): string {
  let time = "";
  let remaining = Math.max(0, Math.floor(now));

  // One character per base-32 digit, most significant first. `% 32` and
  // `Math.floor(/ 32)` are exact for integers below 2^48, which covers every
  // timestamp in practical use.
  for (let i = 0; i < 10; i += 1) {
    time = BASE32_ALPHABET[remaining % 32] + time;
    remaining = Math.floor(remaining / 32);
  }

  // 10 random bytes = 80 bits = exactly 16 base32 characters.
  return time + base32Encode(randomBytes(10));
}
