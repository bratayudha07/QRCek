import type { ZodType } from "zod";

import { payloadTooLarge, validationError } from "./errors";

/**
 * Input validation at the Worker boundary (AGENTS.md: "Jangan percaya tipe
 * TypeScript sebagai validasi runtime"). Nothing in `routes/` may read
 * `request.json()` directly.
 */

const MAX_JSON_BYTES = 64 * 1024;

/** Flattens zod issues into `{ field: [message] }` for `details.fieldErrors`. */
export function toFieldErrors(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_";
    (fieldErrors[key] ??= []).push(issue.message);
  }

  return fieldErrors;
}

export async function parseJsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    throw payloadTooLarge();
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    throw validationError("Body permintaan tidak bisa dibaca");
  }

  if (new TextEncoder().encode(raw).byteLength > MAX_JSON_BYTES) {
    throw payloadTooLarge();
  }

  let parsed: unknown;
  try {
    parsed = raw.trim() === "" ? {} : JSON.parse(raw);
  } catch {
    throw validationError("Body permintaan bukan JSON yang valid");
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw validationError("Data yang dikirim tidak valid", {
      fieldErrors: toFieldErrors(result.error),
    });
  }

  return result.data;
}

/**
 * Path parameters come from the router, never from the body, so they cannot be
 * type-confused. They still get length/bounds checks before touching SQL.
 */
export function parsePathParams<T>(params: Record<string, string>, schema: ZodType<T>): T {
  const result = schema.safeParse(params);
  if (!result.success) {
    throw validationError("Parameter URL tidak valid", {
      fieldErrors: toFieldErrors(result.error),
    });
  }

  return result.data;
}

/**
 * Query strings are attacker-controlled too. Unknown keys are stripped by the
 * schema, and coercion (limit/cursor) happens here, never in the handler.
 */
export function parseQuery<T>(request: Request, schema: ZodType<T>): T {
  const entries = Object.fromEntries(new URL(request.url).searchParams.entries());
  const result = schema.safeParse(entries);

  if (!result.success) {
    throw validationError("Parameter pencarian tidak valid", {
      fieldErrors: toFieldErrors(result.error),
    });
  }

  return result.data;
}

/** Reads a bounded text body (CSV upload). Enforces the limit in bytes. */
export async function readTextBody(
  request: Request,
  maxBytes: number,
  tooLargeMessage: string,
): Promise<string> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw payloadTooLarge(tooLargeMessage);
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    throw validationError("Body permintaan tidak bisa dibaca");
  }

  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw payloadTooLarge(tooLargeMessage);
  }

  return raw;
}
