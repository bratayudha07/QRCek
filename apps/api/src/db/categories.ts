import type { CategoryStatus } from "@absensi/shared";

/** Data access for categories (DESAIN_API.md §5). No business rules here. */

export interface CategoryRow {
  id: string;
  theme_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  status: CategoryStatus;
  created_at: number;
  created_by: string | null;
  updated_at: number;
  updated_by: string | null;
  archived_at: number | null;
}

export interface CategoryListRow extends CategoryRow {
  participant_count: number;
}

export async function listCategories(
  db: D1Database,
  themeId: string,
  status: "active" | "archived" | "all",
): Promise<CategoryListRow[]> {
  const clauses = ["c.theme_id = ?"];
  const bindings: Array<string | number> = [themeId];
  if (status !== "all") {
    clauses.push("c.status = ?");
    bindings.push(status);
  }

  const { results } = await db
    .prepare(
      `SELECT c.*, COUNT(p.id) AS participant_count
         FROM categories c
         LEFT JOIN participants p
           ON p.category_id = c.id AND p.event_id = c.theme_id
        WHERE ${clauses.join(" AND ")}
        GROUP BY c.id
        ORDER BY c.sort_order ASC, c.name ASC, c.id ASC`,
    )
    .bind(...bindings)
    .all<CategoryListRow>();

  return results;
}

export async function findCategory(
  db: D1Database,
  themeId: string,
  categoryId: string,
): Promise<CategoryRow | null> {
  return db
    .prepare("SELECT * FROM categories WHERE id = ? AND theme_id = ?")
    .bind(categoryId, themeId)
    .first<CategoryRow>();
}

export async function findCategoryByName(
  db: D1Database,
  themeId: string,
  name: string,
): Promise<CategoryRow | null> {
  return db
    .prepare("SELECT * FROM categories WHERE theme_id = ? AND name = ?")
    .bind(themeId, name)
    .first<CategoryRow>();
}

export function insertCategoryStatement(
  db: D1Database,
  input: {
    id: string;
    themeId: string;
    name: string;
    description: string | null;
    sortOrder: number;
    createdBy: string;
    createdAt: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO categories
         (id, theme_id, name, description, sort_order, status,
          created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.themeId,
      input.name,
      input.description,
      input.sortOrder,
      input.createdAt,
      input.createdBy,
      input.createdAt,
      input.createdBy,
    );
}

export interface CategoryUpdate {
  name?: string;
  description?: string | null;
  sortOrder?: number;
}

export function updateCategoryStatement(
  db: D1Database,
  input: {
    themeId: string;
    categoryId: string;
    update: CategoryUpdate;
    actorUserId: string;
    now: number;
    expectedUpdatedAt: number;
  },
): D1PreparedStatement {
  const sets = ["updated_at = ?", "updated_by = ?"];
  const values: Array<string | number | null> = [input.now, input.actorUserId];

  if (input.update.name !== undefined) {
    sets.push("name = ?");
    values.push(input.update.name);
  }
  if (input.update.description !== undefined) {
    sets.push("description = ?");
    values.push(input.update.description);
  }
  if (input.update.sortOrder !== undefined) {
    sets.push("sort_order = ?");
    values.push(input.update.sortOrder);
  }

  values.push(input.categoryId, input.themeId, input.expectedUpdatedAt);

  return db
    .prepare(
      `UPDATE categories
          SET ${sets.join(", ")}
        WHERE id = ? AND theme_id = ? AND updated_at = ? AND status <> 'archived'`,
    )
    .bind(...values);
}

export function updateCategoryStatusStatement(
  db: D1Database,
  input: {
    themeId: string;
    categoryId: string;
    fromStatus: CategoryStatus;
    status: CategoryStatus;
    actorUserId: string;
    now: number;
    expectedUpdatedAt: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE categories
          SET status = ?, archived_at = ?, updated_at = ?, updated_by = ?
        WHERE id = ? AND theme_id = ? AND updated_at = ? AND status = ?`,
    )
    .bind(
      input.status,
      input.status === "archived" ? input.now : null,
      input.now,
      input.actorUserId,
      input.categoryId,
      input.themeId,
      input.expectedUpdatedAt,
      input.fromStatus,
    );
}
