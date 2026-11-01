import type {
  LabelConfigPayload,
  LabelConfigRequest,
  LabelFieldKey,
  QrLabelPayload,
  QrLabelRequestInput,
} from "@absensi/shared";
import { MAX_LABEL_FIELDS } from "@absensi/shared";

import { apiRequest } from "./http";

/** Typed bindings for QR labels and the per-event label configuration. */

export function issueQrLabels(eventId: string, input: QrLabelRequestInput) {
  return apiRequest<QrLabelPayload>(
    `/api/events/${encodeURIComponent(eventId)}/participants/qr-labels`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function getLabelConfig(eventId: string) {
  return apiRequest<LabelConfigPayload>(
    `/api/events/${encodeURIComponent(eventId)}/label-config`,
  );
}

export function saveLabelConfig(eventId: string, input: LabelConfigRequest) {
  return apiRequest<LabelConfigPayload>(
    `/api/events/${encodeURIComponent(eventId)}/label-config`,
    { method: "PUT", body: JSON.stringify(input) },
  );
}

/**
 * Pure preview helpers, unit tested without a DOM.
 *
 * The page keeps the selected fields as an ordered array, so the same functions
 * drive both the on-screen list and the printed lines.
 */

export function toggleLabelField(
  fields: readonly LabelFieldKey[],
  key: LabelFieldKey,
): LabelFieldKey[] {
  if (fields.includes(key)) {
    // At least one text field must remain; the QR itself is always present.
    return fields.length === 1 ? [...fields] : fields.filter((field) => field !== key);
  }

  if (fields.length >= MAX_LABEL_FIELDS) return [...fields];

  return [...fields, key];
}

export function moveLabelField(
  fields: readonly LabelFieldKey[],
  key: LabelFieldKey,
  direction: -1 | 1,
): LabelFieldKey[] {
  const index = fields.indexOf(key);
  const target = index + direction;

  if (index < 0 || target < 0 || target >= fields.length) return [...fields];

  const next = [...fields];
  next[index] = fields[target] as LabelFieldKey;
  next[target] = key;
  return next;
}

/** Empty values are dropped, not printed as blank lines. */
export function orderedLabelValues(
  fields: readonly LabelFieldKey[],
  values: Partial<Record<LabelFieldKey, string>>,
): string[] {
  return fields
    .map((field) => values[field]?.trim() ?? "")
    .filter((value) => value !== "");
}

export function paginateLabels<T>(labels: readonly T[], perPage: number): T[][] {
  if (perPage <= 0) return labels.length > 0 ? [[...labels]] : [];

  const pages: T[][] = [];
  for (let offset = 0; offset < labels.length; offset += perPage) {
    pages.push(labels.slice(offset, offset + perPage));
  }

  return pages;
}

export type LabelFormat = "a4" | "sticker";

/**
 * `@page` rules must match the physical medium, not the screen. A4 uses 8 mm
 * margins (the browser scales the 194 mm content area); the sticker is exactly
 * 50 × 30 mm with no margin, because the label stock already has the die cut.
 */
export function labelPrintCss(format: LabelFormat): string {
  if (format === "a4") {
    return [
      "@page { size: A4 portrait; margin: 8mm; }",
      ".label-sheet { width: 194mm; }",
      ".label-page { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3mm; }",
      ".label-cell { height: 32mm; }",
    ].join("\n");
  }

  return [
    "@page { size: 50mm 30mm; margin: 0; }",
    ".label-sheet { width: 50mm; }",
    ".label-cell { width: 50mm; height: 30mm; }",
  ].join("\n");
}
