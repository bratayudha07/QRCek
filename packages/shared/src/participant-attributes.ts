import type { CustomFieldType } from "./schemas/custom-fields";

/**
 * Pure participant attribute rules (ADR-0014, FR-026–FR-033).
 *
 * Definitions live in `custom_fields`; values live in one JSON object per
 * participant. This module never touches D1, so the same rules run at the API
 * boundary and in CSV/import validation.
 */

export interface AttributeField {
  key: string;
  type: CustomFieldType;
  required: boolean;
  options: readonly string[];
  scope: "participant" | "activity";
  status: "active" | "archived";
}

export type AttributeValues = Record<string, unknown>;

export interface AttributeError {
  key: string;
  message: string;
}

export type AttributeValidation =
  | { ok: true; value: AttributeValues }
  | { ok: false; errors: AttributeError[] };

const TEXT_MAX = 500;
const TEXTAREA_MAX = 5_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?\d{8,15}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateValue(field: AttributeField, value: unknown): string | null {
  switch (field.type) {
    case "text":
    case "textarea": {
      const max = field.type === "textarea" ? TEXTAREA_MAX : TEXT_MAX;
      if (typeof value !== "string") return "harus berupa teks";
      if (value.length > max) return `maksimal ${max} karakter`;
      return null;
    }
    case "email":
      if (typeof value !== "string") return "harus berupa teks";
      if (value.length > 254 || !EMAIL_PATTERN.test(value)) return "format email tidak valid";
      return null;
    case "phone": {
      if (typeof value !== "string") return "harus berupa teks";
      const compact = value.replace(/[\s().-]/g, "");
      if (!PHONE_PATTERN.test(compact)) return "format nomor telepon tidak valid";
      return null;
    }
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e15) {
        return "harus berupa angka yang valid";
      }
      return null;
    case "checkbox":
      if (typeof value !== "boolean") return "harus berupa boolean";
      return null;
    case "date":
      if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
        return "harus berupa tanggal (ms epoch UTC)";
      }
      return null;
    case "select":
      if (typeof value !== "string") return "harus berupa teks";
      if (!field.options.includes(value)) return "nilai tidak ada di daftar opsi";
      return null;
    case "multi_select":
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        return "harus berupa daftar teks";
      }
      if (new Set(value).size !== value.length) return "opsi tidak boleh duplikat";
      if (value.some((item) => !field.options.includes(item))) {
        return "ada nilai yang tidak ada di daftar opsi";
      }
      return null;
  }
}

/**
 * Validates a complete value set for create/import. Unknown keys are dropped
 * instead of being stored silently; active participant-scoped fields are the
 * only ones accepted.
 */
export function validateParticipantAttributes(
  fields: readonly AttributeField[],
  values: unknown,
): AttributeValidation {
  if (values === undefined || values === null) values = {};
  if (!isPlainObject(values)) {
    return { ok: false, errors: [{ key: "", message: "atribut harus berupa objek" }] };
  }

  const byKey = new Map(
    fields
      .filter((field) => field.scope === "participant")
      .map((field) => [field.key, field]),
  );
  const errors: AttributeError[] = [];
  const stored: AttributeValues = {};

  for (const [key, value] of Object.entries(values)) {
    const field = byKey.get(key);
    if (!field) continue;
    if (field.status !== "active") {
      errors.push({ key, message: "field sudah diarsipkan/nonaktif" });
      continue;
    }
    const error = validateValue(field, value);
    if (error) {
      errors.push({ key, message: error });
      continue;
    }
    stored[key] = value;
  }

  for (const field of byKey.values()) {
    if (field.status === "active" && field.required && !(field.key in stored)) {
      errors.push({ key: field.key, message: "wajib diisi" });
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: stored };
}

/**
 * Merges a partial patch into existing values.
 *
 * - `undefined` / missing key: unchanged (`BR-077` for imports).
 * - `null`: remove the value; a required field cannot be removed.
 * - any other value: validated against the active field definition.
 *
 * Unknown keys are ignored, and archived/inactive fields cannot receive a new
 * value, but their old values are preserved because they are not in `patch`.
 */
export function mergeParticipantAttributes(
  existing: AttributeValues,
  patch: Record<string, unknown>,
  fields: readonly AttributeField[],
): AttributeValidation {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const merged: AttributeValues = { ...existing };
  const errors: AttributeError[] = [];

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;

    const field = byKey.get(key);
    if (!field || field.scope !== "participant") continue;

    if (value === null) {
      if (field.required) {
        errors.push({ key, message: "field wajib tidak boleh dikosongkan" });
        continue;
      }
      delete merged[key];
      continue;
    }

    if (field.status !== "active") {
      errors.push({ key, message: "field sudah diarsipkan/nonaktif" });
      continue;
    }

    const error = validateValue(field, value);
    if (error) {
      errors.push({ key, message: error });
      continue;
    }
    merged[key] = value;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: merged };
}

/** Converts a CSV cell to the JSON representation expected by a field type. */
export function coerceAttributeValue(
  type: CustomFieldType,
  raw: string,
): { ok: true; value: unknown } | { ok: false; message: string } {
  const input = raw.trim();

  switch (type) {
    case "text":
    case "textarea":
    case "email":
    case "phone":
    case "select":
      return { ok: true, value: input };
    case "multi_select":
      return {
        ok: true,
        value: input === "" ? [] : input.split(",").map((item) => item.trim()).filter(Boolean),
      };
    case "number": {
      const value = Number(input);
      if (input === "" || !Number.isFinite(value)) {
        return { ok: false, message: "harus berupa angka yang valid" };
      }
      return { ok: true, value };
    }
    case "checkbox":
      if (["true", "1", "ya", "yes"].includes(input.toLowerCase())) return { ok: true, value: true };
      if (["false", "0", "tidak", "no", ""].includes(input.toLowerCase())) {
        return { ok: true, value: false };
      }
      return { ok: false, message: "harus berupa boolean" };
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
        return { ok: false, message: "format tanggal tidak valid (YYYY-MM-DD)" };
      }
      const ms = Date.parse(`${input}T00:00:00Z`);
      if (Number.isNaN(ms) || ms <= 0) {
        return { ok: false, message: "format tanggal tidak valid (YYYY-MM-DD)" };
      }
      return { ok: true, value: ms };
    }
  }
}

/**
 * Type changes allowed by ADR-0014. Everything else is rejected rather than
 * silently dropping values.
 */
const TYPE_CHANGES: Readonly<Record<CustomFieldType, readonly CustomFieldType[]>> = {
  text: ["textarea", "select", "multi_select", "email", "phone"],
  number: ["text"],
  date: ["text"],
  select: ["text"],
  checkbox: ["text"],
  textarea: [],
  email: [],
  phone: [],
  multi_select: [],
};

export function isTypeChangeAllowed(from: CustomFieldType, to: CustomFieldType): boolean {
  return TYPE_CHANGES[from].includes(to);
}

export interface TypeChangeResult {
  ok: boolean;
  invalidValues: unknown[];
}

/**
 * Checks every stored value against the target type. `select`/`multi_select`
 * targets additionally need options; a text value is converted to a one-item
 * array for `multi_select` as ADR-0014 allows.
 */
export function validateTypeChange(
  from: CustomFieldType,
  to: CustomFieldType,
  options: readonly string[],
  values: readonly unknown[],
): TypeChangeResult {
  if (!isTypeChangeAllowed(from, to)) {
    return { ok: false, invalidValues: [...values] };
  }

  const target: AttributeField = {
    key: "value",
    type: to,
    required: false,
    options,
    scope: "participant",
    status: "active",
  };
  const invalidValues: unknown[] = [];

  for (const value of values) {
    let candidate = value;
    if (to === "multi_select" && typeof value === "string") candidate = [value];
    if (to === "text" && typeof value !== "string") candidate = String(value);
    if (validateValue(target, candidate) !== null) invalidValues.push(value);
  }

  return { ok: invalidValues.length === 0, invalidValues };
}
