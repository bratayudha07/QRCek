import type {
  CustomFieldScope,
  CustomFieldStatus,
  CustomFieldType,
} from "@absensi/shared";

/** Data access for custom fields (DESAIN_API.md §5). No business rules here. */

export interface CustomFieldRow {
  id: string;
  theme_id: string;
  key: string;
  label: string;
  description: string | null;
  type: CustomFieldType;
  required: number;
  options_json: string | null;
  scope: CustomFieldScope;
  sort_order: number;
  status: CustomFieldStatus;
  created_at: number;
  created_by: string | null;
  updated_at: number;
  updated_by: string | null;
  archived_at: number | null;
}

export function parseOptions(row: CustomFieldRow): string[] {
  if (!row.options_json) return [];
  const parsed: unknown = JSON.parse(row.options_json);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

export async function listCustomFields(
  db: D1Database,
  themeId: string,
  filters: { scope?: CustomFieldScope; status: "active" | "archived" | "all" },
): Promise<CustomFieldRow[]> {
  const clauses = ["theme_id = ?"];
  const bindings: Array<string | number> = [themeId];

  if (filters.scope) {
    clauses.push("scope = ?");
    bindings.push(filters.scope);
  }
  if (filters.status !== "all") {
    clauses.push("status = ?");
    bindings.push(filters.status);
  }

  const { results } = await db
    .prepare(
      `SELECT * FROM custom_fields
        WHERE ${clauses.join(" AND ")}
        ORDER BY sort_order ASC, label ASC, id ASC`,
    )
    .bind(...bindings)
    .all<CustomFieldRow>();

  return results;
}

export async function findCustomField(
  db: D1Database,
  themeId: string,
  fieldId: string,
): Promise<CustomFieldRow | null> {
  return db
    .prepare("SELECT * FROM custom_fields WHERE id = ? AND theme_id = ?")
    .bind(fieldId, themeId)
    .first<CustomFieldRow>();
}

export async function findCustomFieldByKey(
  db: D1Database,
  themeId: string,
  key: string,
): Promise<CustomFieldRow | null> {
  return db
    .prepare("SELECT * FROM custom_fields WHERE theme_id = ? AND key = ?")
    .bind(themeId, key)
    .first<CustomFieldRow>();
}

export async function countActiveFields(
  db: D1Database,
  themeId: string,
  exceptId?: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM custom_fields
        WHERE theme_id = ? AND status = 'active' AND id <> ?`,
    )
    .bind(themeId, exceptId ?? "")
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export function insertCustomFieldStatement(
  db: D1Database,
  input: {
    id: string;
    themeId: string;
    key: string;
    label: string;
    description: string | null;
    type: CustomFieldType;
    required: boolean;
    optionsJson: string | null;
    scope: CustomFieldScope;
    sortOrder: number;
    createdBy: string;
    createdAt: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO custom_fields
         (id, theme_id, key, label, description, type, required, options_json,
          scope, sort_order, status, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.themeId,
      input.key,
      input.label,
      input.description,
      input.type,
      input.required ? 1 : 0,
      input.optionsJson,
      input.scope,
      input.sortOrder,
      input.createdAt,
      input.createdBy,
      input.createdAt,
      input.createdBy,
    );
}

export interface CustomFieldUpdate {
  label?: string;
  description?: string | null;
  required?: boolean;
  optionsJson?: string | null;
  sortOrder?: number;
  type?: CustomFieldType;
}

export function updateCustomFieldStatement(
  db: D1Database,
  input: {
    themeId: string;
    fieldId: string;
    update: CustomFieldUpdate;
    actorUserId: string;
    now: number;
    expectedUpdatedAt: number;
  },
): D1PreparedStatement {
  const sets = ["updated_at = ?", "updated_by = ?"];
  const values: Array<string | number | null> = [input.now, input.actorUserId];

  if (input.update.label !== undefined) {
    sets.push("label = ?");
    values.push(input.update.label);
  }
  if (input.update.description !== undefined) {
    sets.push("description = ?");
    values.push(input.update.description);
  }
  if (input.update.required !== undefined) {
    sets.push("required = ?");
    values.push(input.update.required ? 1 : 0);
  }
  if (input.update.optionsJson !== undefined) {
    sets.push("options_json = ?");
    values.push(input.update.optionsJson);
  }
  if (input.update.sortOrder !== undefined) {
    sets.push("sort_order = ?");
    values.push(input.update.sortOrder);
  }
  if (input.update.type !== undefined) {
    sets.push("type = ?");
    values.push(input.update.type);
  }

  values.push(input.fieldId, input.themeId, input.expectedUpdatedAt);

  return db
    .prepare(
      `UPDATE custom_fields
          SET ${sets.join(", ")}
        WHERE id = ? AND theme_id = ? AND updated_at = ? AND status = 'active'`,
    )
    .bind(...values);
}

export function updateCustomFieldStatusStatement(
  db: D1Database,
  input: {
    themeId: string;
    fieldId: string;
    fromStatus: CustomFieldStatus;
    status: CustomFieldStatus;
    actorUserId: string;
    now: number;
    expectedUpdatedAt: number;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE custom_fields
          SET status = ?, archived_at = ?, updated_at = ?, updated_by = ?
        WHERE id = ? AND theme_id = ? AND updated_at = ? AND status = ?`,
    )
    .bind(
      input.status,
      input.status === "archived" ? input.now : null,
      input.now,
      input.actorUserId,
      input.fieldId,
      input.themeId,
      input.expectedUpdatedAt,
      input.fromStatus,
    );
}
