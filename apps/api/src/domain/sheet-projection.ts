/**
 * Sheet projection (ADR-004): one participant = one fixed row.
 *
 * Row 1 carries metadata, row 2 is the header, data starts at row 3. The layout
 * is pure data so tests can assert the exact cells without a Sheets call.
 */

export const SHEET_COLUMNS = [
  "participant_id",
  "external_ref",
  "full_name",
  "category",
  "status",
  "checked_in_at",
  "method",
  "updated_at",
] as const;

export const SHEET_SCHEMA_VERSION = 1;

export interface SheetParticipant {
  id: string;
  externalRef: string | null;
  fullName: string;
  category: string | null;
}

export interface SheetAttendance {
  status: string;
  checkedInAt: number;
  method: string;
  updatedAt: number;
}

function iso(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : new Date(value).toISOString();
}

export function buildSheetRow(
  participant: SheetParticipant,
  attendance: SheetAttendance | null,
): string[] {
  return [
    participant.id,
    participant.externalRef ?? "",
    participant.fullName,
    participant.category ?? "",
    attendance?.status ?? "",
    iso(attendance?.checkedInAt),
    attendance?.method ?? "",
    iso(attendance?.updatedAt),
  ];
}

export function metadataRow(eventId: string): string[] {
  return [
    `event_id:${eventId}`,
    `schema_version:${SHEET_SCHEMA_VERSION}`,
    "managed_by:absensi",
    "",
    "",
    "",
    "",
    "",
  ];
}

export function headerRow(): string[] {
  return [...SHEET_COLUMNS];
}

/** Quotes a tab name for A1 notation; a literal quote is doubled. */
export function quoteSheetTab(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

export function dataRowRange(tab: string, rowIndex: number): string {
  return `${quoteSheetTab(tab)}!A${rowIndex}:H${rowIndex}`;
}

export function layoutRange(tab: string): string {
  return `${quoteSheetTab(tab)}!A1:H2`;
}

export function metadataCellRange(tab: string): string {
  return `${quoteSheetTab(tab)}!A1`;
}
