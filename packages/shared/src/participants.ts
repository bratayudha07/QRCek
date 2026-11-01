import type { ParticipantStatus } from "./schemas/participants";

/** Response contracts for participant management (DESAIN_API.md §5). */

export interface ParticipantSummary {
  id: string;
  externalRef: string | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  category: string | null;
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
