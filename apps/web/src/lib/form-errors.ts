/**
 * Field-level error helpers.
 *
 * The Worker returns validation problems as `error.details.fieldErrors`, a map
 * of field path to messages (see `apps/api/src/http/validate.ts`). These pure
 * helpers turn that loose JSON into the shape the forms render: one message per
 * field plus a de-duplicated summary. Kept DOM-free so it is unit testable.
 */

export type FieldErrorMap = Record<string, string>;

function firstMessage(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== "string") continue;
      const trimmed = item.trim();
      if (trimmed !== "") return trimmed;
    }
  }

  return undefined;
}

/** Reads `details.fieldErrors` from an unknown API `details` value. */
export function readFieldErrors(details: unknown): FieldErrorMap {
  if (typeof details !== "object" || details === null) return {};

  const raw = (details as { fieldErrors?: unknown }).fieldErrors;
  if (typeof raw !== "object" || raw === null) return {};

  const errors: FieldErrorMap = {};
  for (const [field, value] of Object.entries(raw as Record<string, unknown>)) {
    const message = firstMessage(value);
    if (message) errors[field] = message;
  }

  return errors;
}

/** Returns the first message for any of the given field keys. */
export function errorFor(
  fieldErrors: FieldErrorMap | null | undefined,
  ...keys: string[]
): string | undefined {
  if (!fieldErrors) return undefined;

  for (const key of keys) {
    const message = fieldErrors[key];
    if (message) return message;
  }

  return undefined;
}

/** One entry per distinct message, in field order. */
export function summarizeFieldErrors(fieldErrors: FieldErrorMap | null | undefined): string[] {
  if (!fieldErrors) return [];
  return [...new Set(Object.values(fieldErrors))];
}

/** Later maps win, so a local check can override a stale server message. */
export function mergeFieldErrors(
  ...maps: Array<FieldErrorMap | null | undefined>
): FieldErrorMap {
  return Object.assign({}, ...maps.filter((map): map is FieldErrorMap => Boolean(map)));
}
