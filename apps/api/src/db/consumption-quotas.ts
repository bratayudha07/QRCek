/**
 * Data access for consumption quotas (Q7, DESAIN_DATABASE.md §3, D-014).
 *
 * No business rules here: priority (individual → category → Aktivitas) lives in
 * `apps/api/src/domain/consumption.ts`, and the ceiling itself is a database
 * trigger. Every query is scoped by `theme_id` and `activity_id`, so a category,
 * participant, or quota row from another Tema resolves to `null`.
 */

export interface ConsumptionQuotaRow {
  id: string;
  theme_id: string;
  activity_id: string;
  category_id: string | null;
  participant_id: string | null;
  quota: number;
  created_at: number;
  created_by: string | null;
  updated_at: number;
  updated_by: string | null;
}

/** The two override levels a single participant resolves against. */
export interface ConsumptionQuotaOverrides {
  categoryOverride: number | null;
  participantOverride: number | null;
}

export interface ConsumptionUsageRow {
  participant_id: string;
  used: number;
}

/** Hard cap so the quota screen never pulls every participant (§14.5). */
export const CONSUMPTION_USAGE_LIMIT = 200;

/**
 * One query for both override levels of one participant. The predicates repeat
 * the partial unique indexes so each branch is an index SEARCH.
 */
export async function findQuotaOverrides(
  db: D1Database,
  input: {
    themeId: string;
    activityId: string;
    participantId: string;
    categoryId: string;
  },
): Promise<ConsumptionQuotaOverrides> {
  const { results } = await db
    .prepare(
      `SELECT category_id, participant_id, quota
         FROM consumption_quotas
        WHERE theme_id = ? AND activity_id = ?
          AND (participant_id = ?
               OR (participant_id IS NULL AND category_id = ?))`,
    )
    .bind(input.themeId, input.activityId, input.participantId, input.categoryId)
    .all<Pick<ConsumptionQuotaRow, "category_id" | "participant_id" | "quota">>();

  const overrides: ConsumptionQuotaOverrides = {
    categoryOverride: null,
    participantOverride: null,
  };

  for (const row of results) {
    if (row.participant_id !== null) {
      overrides.participantOverride = row.quota;
    } else {
      overrides.categoryOverride = row.quota;
    }
  }

  return overrides;
}

export async function findCategoryQuota(
  db: D1Database,
  themeId: string,
  activityId: string,
  categoryId: string,
): Promise<ConsumptionQuotaRow | null> {
  return db
    .prepare(
      `SELECT * FROM consumption_quotas
        WHERE theme_id = ? AND activity_id = ? AND category_id = ?
          AND participant_id IS NULL`,
    )
    .bind(themeId, activityId, categoryId)
    .first<ConsumptionQuotaRow>();
}

export async function findParticipantQuota(
  db: D1Database,
  themeId: string,
  activityId: string,
  participantId: string,
): Promise<ConsumptionQuotaRow | null> {
  return db
    .prepare(
      `SELECT * FROM consumption_quotas
        WHERE theme_id = ? AND activity_id = ? AND participant_id = ?
          AND category_id IS NULL`,
    )
    .bind(themeId, activityId, participantId)
    .first<ConsumptionQuotaRow>();
}

export async function listCategoryQuotas(
  db: D1Database,
  themeId: string,
  activityId: string,
): Promise<ConsumptionQuotaRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM consumption_quotas
        WHERE theme_id = ? AND activity_id = ? AND category_id IS NOT NULL
          AND participant_id IS NULL
        ORDER BY category_id`,
    )
    .bind(themeId, activityId)
    .all<ConsumptionQuotaRow>();

  return results;
}

export async function listParticipantQuotas(
  db: D1Database,
  themeId: string,
  activityId: string,
  limit = CONSUMPTION_USAGE_LIMIT,
): Promise<ConsumptionQuotaRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM consumption_quotas
        WHERE theme_id = ? AND activity_id = ? AND participant_id IS NOT NULL
          AND category_id IS NULL
        ORDER BY participant_id
        LIMIT ?`,
    )
    .bind(themeId, activityId, limit)
    .all<ConsumptionQuotaRow>();

  return results;
}

/**
 * Existing overrides for the exact cells of a bulk request. Reading all rows and
 * filtering in memory would silently miss a cell beyond the usage limit, and the
 * insert would then fail on the unique index instead of updating in place.
 */
export async function findCategoryQuotasByIds(
  db: D1Database,
  themeId: string,
  activityId: string,
  categoryIds: readonly string[],
): Promise<ConsumptionQuotaRow[]> {
  const unique = [...new Set(categoryIds)];
  if (unique.length === 0) return [];

  const placeholders = unique.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT * FROM consumption_quotas
        WHERE theme_id = ? AND activity_id = ?
          AND participant_id IS NULL AND category_id IN (${placeholders})`,
    )
    .bind(themeId, activityId, ...unique)
    .all<ConsumptionQuotaRow>();

  return results;
}

export async function findParticipantQuotasByIds(
  db: D1Database,
  themeId: string,
  activityId: string,
  participantIds: readonly string[],
): Promise<ConsumptionQuotaRow[]> {
  const unique = [...new Set(participantIds)];
  if (unique.length === 0) return [];

  const placeholders = unique.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT * FROM consumption_quotas
        WHERE theme_id = ? AND activity_id = ?
          AND category_id IS NULL AND participant_id IN (${placeholders})`,
    )
    .bind(themeId, activityId, ...unique)
    .all<ConsumptionQuotaRow>();

  return results;
}

/**
 * Effective slot numbers of one participant in one Aktivitas, across every Sesi
 * (A1). The predicate is the same one the quota trigger counts, so the Worker and
 * the database cannot disagree about "used"; the numbers feed `nextSlotNo`, which
 * reuses a slot freed by a Reversal.
 */
export async function listEffectiveConsumptionSlots(
  db: D1Database,
  input: { themeId: string; activityId: string; participantId: string },
): Promise<number[]> {
  const { results } = await db
    .prepare(
      `SELECT slot_no
         FROM transactions
        WHERE theme_id = ? AND participant_id = ? AND activity_id = ?
          AND type = 'consumption'
          AND reversed_at IS NULL
          AND superseded_at IS NULL
        ORDER BY slot_no`,
    )
    .bind(input.themeId, input.participantId, input.activityId)
    .all<{ slot_no: number }>();

  return results.map((row) => row.slot_no);
}

/**
 * Usage per participant for the admin quota screen. Bounded and ordered so a
 * large Tema returns a predictable slice instead of every transaction.
 */
export async function listConsumptionUsage(
  db: D1Database,
  themeId: string,
  activityId: string,
  limit = CONSUMPTION_USAGE_LIMIT,
): Promise<ConsumptionUsageRow[]> {
  const { results } = await db
    .prepare(
      `SELECT participant_id, COUNT(*) AS used
         FROM transactions
        WHERE theme_id = ? AND activity_id = ? AND type = 'consumption'
          AND reversed_at IS NULL AND superseded_at IS NULL
        GROUP BY participant_id
        ORDER BY used DESC, participant_id
        LIMIT ?`,
    )
    .bind(themeId, activityId, limit)
    .all<ConsumptionUsageRow>();

  return results;
}

export interface ConsumptionQuotaInsert {
  id: string;
  themeId: string;
  activityId: string;
  categoryId: string | null;
  participantId: string | null;
  quota: number;
  createdAt: number;
  createdBy: string;
}

export function insertConsumptionQuotaStatement(
  db: D1Database,
  input: ConsumptionQuotaInsert,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO consumption_quotas
         (id, theme_id, activity_id, category_id, participant_id, quota,
          created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.themeId,
      input.activityId,
      input.categoryId,
      input.participantId,
      input.quota,
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
export function updateConsumptionQuotaStatement(
  db: D1Database,
  input: {
    themeId: string;
    quotaId: string;
    quota: number;
    actorUserId: string;
    now: number;
    expectedUpdatedAt: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE consumption_quotas
          SET quota = ?, updated_at = ?, updated_by = ?
        WHERE id = ? AND theme_id = ? AND updated_at = ?`,
    )
    .bind(
      input.quota,
      input.now,
      input.actorUserId,
      input.quotaId,
      input.themeId,
      input.expectedUpdatedAt,
    );
}

/** Removing an override falls back to the next level; history is untouched. */
export function deleteConsumptionQuotaStatement(
  db: D1Database,
  input: { themeId: string; quotaId: string; expectedUpdatedAt: number },
): D1PreparedStatement {
  return db
    .prepare(
      `DELETE FROM consumption_quotas
        WHERE id = ? AND theme_id = ? AND updated_at = ?`,
    )
    .bind(input.quotaId, input.themeId, input.expectedUpdatedAt);
}
