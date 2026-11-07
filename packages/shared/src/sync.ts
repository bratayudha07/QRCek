/** Google Sheets sync contracts (DESAIN_API.md §9). */

export const OUTBOX_STATUSES = ["pending", "inflight", "done", "failed", "dead"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const OUTBOX_KINDS = ["attendance", "participant", "delete"] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

export interface SyncConfig {
  eventId: string;
  configured: boolean;
  spreadsheetId: string | null;
  sheetTab: string | null;
  syncEnabled: boolean;
  schemaVersion: number;
  lastFullSyncAt: number | null;
  lastError: string | null;
  updatedAt: number | null;
  /** Public address of the service account; never the private key. */
  serviceAccountEmail: string | null;
}

export interface SyncConfigPayload {
  config: SyncConfig;
}

export interface SyncStatusPayload {
  config: SyncConfig;
  counts: Record<OutboxStatus, number>;
  items: OutboxItem[];
}

export interface OutboxListPayload {
  items: OutboxItem[];
}

export interface OutboxItem {
  id: string;
  participantId: string;
  participantName: string;
  kind: OutboxKind;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  updatedAt: number;
}

export interface SyncTestPayload {
  ok: true;
  spreadsheetTitle: string;
  sheetTab: string;
  serviceAccountEmail: string;
}

export interface SyncRunPayload {
  processed: number;
  succeeded: number;
  failed: number;
  dead: number;
  /** Items skipped because the event has no enabled destination. */
  skipped: number;
  error: string | null;
}

export interface SyncFullPayload {
  enqueued: number;
}

export interface OutboxRetryPayload {
  item: OutboxItem;
}
