/**
 * Entitlement model and pure resolver (ADR-0016, D-005).
 *
 * The resolver has no I/O. The caller fetches at most one rule per level with
 * `listRulesForContext` and passes the rows here. This keeps the priority table
 * in one testable place and lets Q5 reuse the exact same function on the scan
 * hot path.
 */

export type EntitlementStatus = "inherit" | "allowed" | "denied";

export type EntitlementLevel =
  | "individual_session"
  | "category_session"
  | "individual_activity"
  | "category_activity"
  | "theme_default";

/** Priority order is fixed (FR-038) and must not be inferred from row order. */
export const ENTITLEMENT_PRIORITY: readonly EntitlementLevel[] = [
  "individual_session",
  "category_session",
  "individual_activity",
  "category_activity",
  "theme_default",
];

export interface EntitlementRule {
  level: EntitlementLevel;
  status: EntitlementStatus;
}

export interface EntitlementContext {
  participantId: string;
  categoryId: string;
  activityId: string;
  sessionId: string | null;
}

export interface EntitlementResult {
  allowed: boolean;
  status: EntitlementStatus;
  decidedBy: EntitlementLevel | null;
}

const SESSION_LEVELS = new Set<EntitlementLevel>([
  "individual_session",
  "category_session",
]);

/**
 * Resolves one participant × category × activity × optional session.
 *
 * - Session levels are skipped when the context has no session: a rule that
 *   belongs to a session never applies to an activity-only transaction.
 * - `inherit` continues to the next level; it never means "allowed".
 * - The first `allowed`/`denied` decides. A higher-level `denied` therefore
 *   cannot be overridden by a lower-level `allowed` (BR-020).
 * - No deciding rule means deny with `decidedBy = null` (fail-closed).
 */
export function resolveEntitlement(
  context: EntitlementContext,
  rules: readonly EntitlementRule[],
): EntitlementResult {
  const byLevel = new Map<EntitlementLevel, EntitlementStatus>();
  for (const rule of rules) {
    byLevel.set(rule.level, rule.status);
  }

  for (const level of ENTITLEMENT_PRIORITY) {
    if (SESSION_LEVELS.has(level) && context.sessionId === null) continue;

    const status = byLevel.get(level);
    if (status === undefined || status === "inherit") continue;

    return {
      allowed: status === "allowed",
      status,
      decidedBy: level,
    };
  }

  return { allowed: false, status: "denied", decidedBy: null };
}

/**
 * Active categories that do not have a `category_activity` row yet.
 *
 * Completeness is computed, never stored (ADR-0016): adding a category makes an
 * active activity visibly incomplete without a maintenance job.
 */
export function missingEntitlementCategories(
  activeCategoryIds: readonly string[],
  configuredCategoryIds: readonly string[],
): string[] {
  const configured = new Set(configuredCategoryIds);
  return activeCategoryIds.filter((categoryId) => !configured.has(categoryId));
}

export function isEntitlementComplete(
  activeCategoryIds: readonly string[],
  configuredCategoryIds: readonly string[],
): boolean {
  return missingEntitlementCategories(activeCategoryIds, configuredCategoryIds).length === 0;
}

/** Response contracts for the Q3 entitlement API (DESAIN_API.md §6). */

export interface EntitlementDefaultPayload {
  themeDefault: { status: EntitlementStatus } | null;
}

export interface EntitlementCategoryCell {
  categoryId: string;
  name: string;
  status: EntitlementStatus | null;
}

export interface EntitlementParticipantCell {
  participantId: string;
  status: EntitlementStatus;
}

export interface EntitlementSessionMatrix {
  sessionId: string;
  categories: EntitlementCategoryCell[];
  participants: EntitlementParticipantCell[];
}

export interface EntitlementMatrixPayload {
  activityId: string;
  entitlementComplete: boolean;
  missingCategoryIds: string[];
  themeDefault: { status: EntitlementStatus } | null;
  categories: EntitlementCategoryCell[];
  sessions: EntitlementSessionMatrix[];
  participants: EntitlementParticipantCell[];
}

export interface EntitlementCategoryRulesPayload {
  activityId: string;
  sessionId: string | null;
  rules: Array<{ categoryId: string; status: EntitlementStatus }>;
  entitlementComplete: boolean;
  missingCategoryIds: string[];
}

export interface EntitlementParticipantRulePayload {
  participantOverride: {
    participantId: string;
    sessionId: string | null;
    status: EntitlementStatus;
  } | null;
}

export interface EntitlementResolvePayload {
  allowed: boolean;
  status: EntitlementStatus;
  decidedBy: EntitlementLevel | null;
}
