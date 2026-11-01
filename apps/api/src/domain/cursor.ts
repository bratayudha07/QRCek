/**
 * Opaque keyset cursor: `base64url(created_at + ":" + id)`.
 *
 * Clients only round-trip the string; changing the shape later is safe as long
 * as old cursors are allowed to fail with `400`. The id tie-breaker matters
 * because imports can write many rows in the same millisecond.
 */

const PATTERN = /^(\d{1,16}):([0-9A-Z]{26})$/;

export interface CursorValue {
  createdAt: number;
  id: string;
}

export function encodeCursor(value: CursorValue): string {
  const raw = `${value.createdAt}:${value.id}`;
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(value: string): CursorValue | null {
  let raw: string;

  try {
    raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }

  const match = PATTERN.exec(raw);
  if (!match) return null;

  const createdAt = Number(match[1]);
  if (!Number.isSafeInteger(createdAt)) return null;

  return { createdAt, id: match[2] as string };
}
