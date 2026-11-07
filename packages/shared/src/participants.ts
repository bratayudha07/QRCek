import type { ParticipantStatus } from "./schemas/participants";

/** Response contracts for participant management (DESAIN_API.md §5). */

export interface ParticipantSummary {
  id: string;
  externalRef: string | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  /** Display name of `categoryId` (legacy clients read this). */
  category: string | null;
  categoryId: string;
  /** Participant-scoped custom field values, keyed by `custom_fields.key`. */
  attributes: Record<string, unknown>;
  note: string | null;
  status: ParticipantStatus;
  createdAt: number;
  updatedAt: number;
}

export interface ParticipantListPayload {
  items: ParticipantSummary[];
  nextCursor: string | null;
}

export interface ParticipantDetailPayload {
  participant: ParticipantSummary;
}

export interface ParticipantDeletePayload {
  deleted: true;
  status: "inactive";
}

export interface ImportInvalidRow {
  line: number;
  reason: string;
}

export interface ImportPreviewRow {
  line: number;
  externalRef: string | null;
  fullName: string;
  phone: string | null;
  category: string | null;
  categoryId: string;
  action: "create" | "update";
}

export interface ImportPreviewPayload {
  dryRun: true;
  total: number;
  valid: number;
  created: number;
  updated: number;
  invalid: ImportInvalidRow[];
  sample: ImportPreviewRow[];
}

export interface ImportResultPayload {
  dryRun: false;
  total: number;
  valid: number;
  created: number;
  updated: number;
  skipped: number;
  invalid: ImportInvalidRow[];
}

export type ParticipantImportPayload = ImportPreviewPayload | ImportResultPayload;
