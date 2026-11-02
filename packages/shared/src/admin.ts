/**
 * Operational payloads (DESAIN_API.md §9): readiness probe and usage snapshot.
 *
 * These are for monitoring and capacity planning, not for the SPA. They carry
 * no PII: only row counts and the age of the audit trail.
 */

export interface ReadyPayload {
  service: string;
  version: string;
  status: "ready";
  /** `ok` only after a real `SELECT 1` round trip to D1 succeeded. */
  database: "ok";
  timestamp: number;
}

export interface AdminUsagePayload {
  generatedAt: number;
  counts: {
    users: number;
    events: number;
    participants: number;
    attendance: number;
    auditEntries: number;
    /** Unrevoked sessions that have not expired yet. */
    activeSessions: number;
    /** Live rate-limit buckets; finished windows are pruned hourly. */
    rateLimitBuckets: number;
    outbox: {
      /** `pending` plus `inflight`: still owed to the spreadsheet. */
      queued: number;
      failed: number;
      dead: number;
    };
  };
  /** Audit trail age, used to decide when to archive (ADR-008). */
  auditLog: {
    oldestAt: number | null;
    newestAt: number | null;
  };
}
