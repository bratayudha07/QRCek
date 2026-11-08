import type { EntitlementLevel, EntitlementStatus } from "@absensi/shared";

/**
 * Data access for `entitlement_rules` (DESAIN_DATABASE.md §3, ADR-0016).
 *
 * No business rules here: priority and default-deny live in
 * `packages/shared/src/entitlements.ts`. Every query is scoped by `theme_id`;
 * cross-theme ids are validated by the route and by database triggers.
 */

export interface EntitlementRuleRow {
  id: string;
  theme_id: string;
  activity_id: string | null;
  session_id: string | null;
  participant_id: string | null;
  category_id: string | null;
  status: EntitlementStatus;
  created_at: number;
  created_by: string | null;
  updated_at: number;
  updated_by: string | null;
}

export interface ResolvedEntitlementRuleRow {
  level: EntitlementLevel;
  status: EntitlementStatus;
}

export interface EntitlementCompleteness {
  complete: boolean;
  missingCategoryIds: string[];
  missingCategoryNames: string[];
}

export interface EntitlementContextQuery {
  themeId: string;
  participantId: string;
  categoryId: string;
  activityId: string;
  sessionId: string | null;
}

/**
 * The resolver query. Exported so the EXPLAIN QUERY PLAN test can assert that
 * every UNION ALL branch is an index SEARCH, not a table SCAN (§9.5).
 *
 * The predicates intentionally repeat the partial unique index predicates; that
 * is what lets SQLite pick `uq_ent_*` for each branch.
 */
export function resolverRulesSql(hasSession: boolean): string {
  const branches = [
    `SELECT 'individual_activity' AS level, status FROM entitlement_rules
      WHERE theme_id = ? AND participant_id = ? AND activity_id = ?
        AND session_id IS NULL`,
    `SELECT 'category_activity' AS level, status FROM entitlement_rules
      WHERE theme_id = ? AND category_id = ? AND activity_id = ?
        AND session_id IS NULL`,
    `SELECT 'theme_default' AS level, status FROM entitlement_rules
      WHERE theme_id = ? AND activity_id IS NULL AND session_id IS NULL
        AND participant_id IS NULL AND category_id IS NULL`,
  ];

  if (hasSession) {
    branches.unshift(
      `SELECT 'individual_session' AS level, status FROM entitlement_rules
        WHERE theme_id = ? AND participant_id = ? AND activity_id = ? AND session_id = ?`,
      `SELECT 'category_session' AS level, status FROM entitlement_rules
        WHERE theme_id = ? AND category_id = ? AND activity_id = ? AND session_id = ?`,
    );
  }

  return branches.join("\nUNION ALL\n");
}

function resolverBindings(input: EntitlementContextQuery): Array<string> {
  const bindings: string[] = [];

  if (input.sessionId !== null) {
    bindings.push(
      input.themeId,
      input.participantId,
      input.activityId,
      input.sessionId,
      input.themeId,
      input.categoryId,
      input.activityId,
      input.sessionId,
    );
  }

  bindings.push(
    input.themeId,
    input.participantId,
    input.activityId,
    input.themeId,
    input.categoryId,
    input.activityId,
    input.themeId,
  );

  return bindings;
}

/** At most one row per level, at most five rows in total. */
export async function listRulesForContext(
  db: D1Database,
  input: EntitlementContextQuery,
): Promise<ResolvedEntitlementRuleRow[]> {
  const sql = resolverRulesSql(input.sessionId !== null);
  const { results } = await db
    .prepare(sql)
    .bind(...resolverBindings(input))
    .all<ResolvedEntitlementRuleRow>();

  return results;
}

export async function findThemeDefault(
  db: D1Database,
  themeId: string,
): Promise<EntitlementRuleRow | null> {
  return db
    .prepare(
      `SELECT * FROM entitlement_rules
        WHERE theme_id = ? AND activity_id IS NULL AND session_id IS NULL
          AND participant_id IS NULL AND category_id IS NULL`,
    )
    .bind(themeId)
    .first<EntitlementRuleRow>();
}

export async function findCategoryActivityRule(
  db: D1Database,
  themeId: string,
  activityId: string,
  categoryId: string,
): Promise<EntitlementRuleRow | null> {
  return db
    .prepare(
      `SELECT * FROM entitlement_rules
        WHERE theme_id = ? AND activity_id = ? AND category_id = ?
          AND session_id IS NULL AND participant_id IS NULL`,
    )
    .bind(themeId, activityId, categoryId)
    .first<EntitlementRuleRow>();
}

export async function findCategorySessionRule(
  db: D1Database,
  themeId: string,
  activityId: string,
  sessionId: string,
  categoryId: string,
): Promise<EntitlementRuleRow | null> {
  return db
    .prepare(
      `SELECT * FROM entitlement_rules
        WHERE theme_id = ? AND activity_id = ? AND session_id = ?
          AND category_id = ? AND participant_id IS NULL`,
    )
    .bind(themeId, activityId, sessionId, categoryId)
    .first<EntitlementRuleRow>();
}

export async function findIndividualActivityRule(
  db: D1Database,
  themeId: string,
  activityId: string,
  participantId: string,
): Promise<EntitlementRuleRow | null> {
  return db
    .prepare(
      `SELECT * FROM entitlement_rules
        WHERE theme_id = ? AND activity_id = ? AND participant_id = ?
          AND session_id IS NULL AND category_id IS NULL`,
    )
    .bind(themeId, activityId, participantId)
    .first<EntitlementRuleRow>();
}

export async function findIndividualSessionRule(
  db: D1Database,
  themeId: string,
  activityId: string,
  sessionId: string,
  participantId: string,
): Promise<EntitlementRuleRow | null> {
  return db
    .prepare(
      `SELECT * FROM entitlement_rules
        WHERE theme_id = ? AND activity_id = ? AND session_id = ?
          AND participant_id = ? AND category_id IS NULL`,
    )
    .bind(themeId, activityId, sessionId, participantId)
    .first<EntitlementRuleRow>();
}

/** All non-default rows for one Aktivitas, used by the matrix endpoint. */
export async function listActivityCategoryRules(
  db: D1Database,
  themeId: string,
  activityId: string,
): Promise<EntitlementRuleRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM entitlement_rules
        WHERE theme_id = ? AND activity_id = ? AND category_id IS NOT NULL
          AND session_id IS NULL AND participant_id IS NULL
        ORDER BY category_id`,
    )
    .bind(themeId, activityId)
    .all<EntitlementRuleRow>();

  return results;
}

export async function listSessionCategoryRules(
  db: D1Database,
  themeId: string,
  activityId: string,
  sessionId: string,
): Promise<EntitlementRuleRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM entitlement_rules
        WHERE theme_id = ? AND activity_id = ? AND session_id = ?
          AND category_id IS NOT NULL AND participant_id IS NULL
        ORDER BY category_id`,
    )
    .bind(themeId, activityId, sessionId)
    .all<EntitlementRuleRow>();

  return results;
}

/** All category–session rows for one Aktivitas, bucketed by Sesi in the route. */
export async function listSessionCategoryRulesForActivity(
  db: D1Database,
  themeId: string,
  activityId: string,
): Promise<EntitlementRuleRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM entitlement_rules
        WHERE theme_id = ? AND activity_id = ? AND session_id IS NOT NULL
          AND category_id IS NOT NULL AND participant_id IS NULL
        ORDER BY session_id, category_id`,
    )
    .bind(themeId, activityId)
    .all<EntitlementRuleRow>();

  return results;
}

/** All individual session overrides for one Aktivitas, capped at `limit`. */
export async function listSessionParticipantOverrides(
  db: D1Database,
  themeId: string,
  activityId: string,
  limit = 200,
): Promise<EntitlementRuleRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM entitlement_rules
        WHERE theme_id = ? AND activity_id = ? AND session_id IS NOT NULL
          AND participant_id IS NOT NULL AND category_id IS NULL
        ORDER BY session_id, participant_id
        LIMIT ?`,
    )
    .bind(themeId, activityId, limit)
    .all<EntitlementRuleRow>();

  return results;
}

/**
 * Individual overrides with an explicit cap so the matrix never pulls every
 * participant in a large Tema (§14.5).
 */
export async function listParticipantOverrides(
  db: D1Database,
  themeId: string,
  activityId: string,
  sessionId: string | null,
  limit = 200,
): Promise<EntitlementRuleRow[]> {
  const sessionClause = sessionId === null ? "session_id IS NULL" : "session_id = ?";
  const bindings: Array<string | number> = [themeId, activityId];
  if (sessionId !== null) bindings.push(sessionId);
  bindings.push(limit);

  const { results } = await db
    .prepare(
      `SELECT * FROM entitlement_rules
        WHERE theme_id = ? AND activity_id = ? AND ${sessionClause}
          AND participant_id IS NOT NULL AND category_id IS NULL
        ORDER BY participant_id
        LIMIT ?`,
    )
    .bind(...bindings)
    .all<EntitlementRuleRow>();

  return results;
}

/**
 * Active categories of the Tema without a `category_activity` row for this
 * Aktivitas. One query, computed on demand (ADR-0016). Name is included only so
 * the activation error can list something an admin recognises.
 */
export async function getEntitlementCompleteness(
  db: D1Database,
  themeId: string,
  activityId: string,
): Promise<EntitlementCompleteness> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.name
         FROM categories c
        WHERE c.theme_id = ? AND c.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM entitlement_rules r
             WHERE r.theme_id = c.theme_id
               AND r.activity_id = ?
               AND r.category_id = c.id
               AND r.session_id IS NULL
               AND r.participant_id IS NULL
          )
        ORDER BY c.sort_order, c.name, c.id`,
    )
    .bind(themeId, activityId)
    .all<{ id: string; name: string }>();

  return {
    complete: results.length === 0,
    missingCategoryIds: results.map((row) => row.id),
    missingCategoryNames: results.map((row) => row.name),
  };
}

export interface EntitlementRuleInsert {
  id: string;
  themeId: string;
  activityId: string | null;
  sessionId: string | null;
  participantId: string | null;
  categoryId: string | null;
  status: EntitlementStatus;
  createdAt: number;
  createdBy: string;
}

export function insertEntitlementRuleStatement(
  db: D1Database,
  input: EntitlementRuleInsert,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO entitlement_rules
         (id, theme_id, activity_id, session_id, participant_id, category_id,
          status, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.themeId,
      input.activityId,
      input.sessionId,
      input.participantId,
      input.categoryId,
      input.status,
      input.createdAt,
      input.createdBy,
      input.createdAt,
      input.createdBy,
    );
}

/**
 * Optimistic update keyed on `updated_at`. A stale expectation changes 0 rows,
 * and the guarded audit statement in the same batch then writes no audit row.
 */
export function updateEntitlementRuleStatusStatement(
  db: D1Database,
  input: {
    themeId: string;
    ruleId: string;
    status: EntitlementStatus;
    actorUserId: string;
    now: number;
    expectedUpdatedAt: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE entitlement_rules
          SET status = ?, updated_at = ?, updated_by = ?
        WHERE id = ? AND theme_id = ? AND updated_at = ?`,
    )
    .bind(
      input.status,
      input.now,
      input.actorUserId,
      input.ruleId,
      input.themeId,
      input.expectedUpdatedAt,
    );
}

export function deleteEntitlementRuleStatement(
  db: D1Database,
  input: {
    themeId: string;
    ruleId: string;
    expectedUpdatedAt: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `DELETE FROM entitlement_rules
        WHERE id = ? AND theme_id = ? AND updated_at = ?`,
    )
    .bind(input.ruleId, input.themeId, input.expectedUpdatedAt);
}
