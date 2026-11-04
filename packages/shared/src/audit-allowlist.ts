/**
 * Audit field allowlist (ADR-0011, FR-207).
 *
 * Audit rows store before/after snapshots, but only fields listed here. Any
 * other field is dropped; a sensitive field that is present is recorded as
 * `[REDACTED]` so the fact that it changed is still auditable without storing
 * the value.
 *
 * Adding a mutation in Q2+ requires updating this table and reviewing it before
 * deploy. Tokens, hashes, ciphertext, peppers, and PII must never be added.
 */

export type AuditEntityType = "theme" | "activity" | "session";

export const REDACTED = "[REDACTED]" as const;

export const AUDIT_FIELDS: Readonly<Record<AuditEntityType, readonly string[]>> = {
  theme: ["name", "description", "timezone", "startsAt", "endsAt", "status", "allowManual"],
  activity: [
    "name",
    "description",
    "transactionType",
    "status",
    "location",
    "sortOrder",
    "archivedAt",
  ],
  session: ["name", "location", "startsAt", "endsAt", "status", "archivedAt"],
};

const SENSITIVE_FIELD_PATTERN =
  /(token|secret|pepper|password|hash|ciphertext|nonce|recovery|phone|email|nik|encrypt|key)/i;

export function isSensitiveAuditField(field: string): boolean {
  return SENSITIVE_FIELD_PATTERN.test(field);
}

/**
 * Returns a snapshot that is safe to persist, or `null` when there is nothing
 * allowlisted to record.
 */
export function filterAuditFields(
  entityType: AuditEntityType,
  source: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (source === null) return null;

  const allowed = new Set(AUDIT_FIELDS[entityType]);
  const snapshot: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(source)) {
    if (allowed.has(field)) {
      snapshot[field] = value;
    } else if (isSensitiveAuditField(field)) {
      snapshot[field] = REDACTED;
    }
  }

  return Object.keys(snapshot).length === 0 ? null : snapshot;
}
