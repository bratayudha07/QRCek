import type { LabelConfigPayload, LabelFieldKey } from "@absensi/shared";
import { DEFAULT_LABEL_FIELDS, MAX_LABEL_FIELDS, isLabelFieldKey } from "@absensi/shared";

/** Per-event label configuration (DESAIN_DATABASE.md §3, Tahap 4). */

interface LabelConfigRow {
  event_id: string;
  fields_json: string;
  show_event_name: number;
}

/** Used when an event has never saved a configuration. */
export function defaultLabelConfig(): LabelConfigPayload {
  return { fields: [...DEFAULT_LABEL_FIELDS], showEventName: true };
}

/**
 * Defensive read: the API validates before writing, but a manual SQL edit or a
 * future catalog change must not crash a print job. Unknown keys are dropped,
 * duplicates removed, and an empty result falls back to the default.
 */
export function parseLabelConfigRow(
  fieldsJson: string,
  showEventName: number,
): LabelConfigPayload {
  let parsed: unknown;

  try {
    parsed = JSON.parse(fieldsJson);
  } catch {
    return defaultLabelConfig();
  }

  if (!Array.isArray(parsed)) return defaultLabelConfig();

  const fields: LabelFieldKey[] = [];
  for (const value of parsed) {
    if (typeof value === "string" && isLabelFieldKey(value) && !fields.includes(value)) {
      fields.push(value);
    }
  }

  return {
    fields: fields.length > 0 ? fields.slice(0, MAX_LABEL_FIELDS) : [...DEFAULT_LABEL_FIELDS],
    showEventName: showEventName === 1,
  };
}

export async function findLabelConfig(
  db: D1Database,
  eventId: string,
): Promise<LabelConfigPayload> {
  const row = await db
    .prepare("SELECT fields_json, show_event_name FROM event_label_config WHERE event_id = ?")
    .bind(eventId)
    .first<LabelConfigRow>();

  return row ? parseLabelConfigRow(row.fields_json, row.show_event_name) : defaultLabelConfig();
}

export async function saveLabelConfig(
  db: D1Database,
  eventId: string,
  config: LabelConfigPayload,
  updatedBy: string,
  now: number,
): Promise<LabelConfigPayload> {
  await db
    .prepare(
      `INSERT INTO event_label_config
         (event_id, fields_json, show_event_name, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (event_id) DO UPDATE SET
         fields_json     = excluded.fields_json,
         show_event_name = excluded.show_event_name,
         updated_at      = excluded.updated_at,
         updated_by      = excluded.updated_by`,
    )
    .bind(eventId, JSON.stringify(config.fields), config.showEventName ? 1 : 0, now, updatedBy)
    .run();

  return config;
}
