/**
 * Outbox retry policy (DESAIN_DATABASE.md §6).
 *
 * `delay = min(2^attempts × 30s, 30min) + jitter(0–30s)`, with `attempts`
 * starting at 1. Jitter prevents every failed item becoming due at the same
 * instant after an outage.
 *
 * Pure, so backoff and error classification are unit tested without waiting.
 */

export const OUTBOX_MAX_ATTEMPTS = 8;
export const OUTBOX_BASE_DELAY_MS = 30_000;
export const OUTBOX_MAX_DELAY_MS = 30 * 60_000;
export const OUTBOX_JITTER_MS = 30_000;
/** An `inflight` row older than this is presumed abandoned by a dead cron. */
export const OUTBOX_STALE_MS = 10 * 60_000;
export const OUTBOX_DONE_RETENTION_MS = 7 * 24 * 60 * 60_000;

export function retryDelayMs(attempts: number, random: () => number = Math.random): number {
  const exponent = Math.max(1, attempts);
  const base = Math.min(2 ** exponent * OUTBOX_BASE_DELAY_MS, OUTBOX_MAX_DELAY_MS);
  const jitter = Math.floor(random() * OUTBOX_JITTER_MS);
  return base + jitter;
}

export interface SyncFailureShape {
  status?: number;
  reason?: string;
}

/**
 * Google returns 429 for rate limits and 403 for both "no permission" and
 * "rate limit exceeded" (reason `rateLimitExceeded`). Only the rate-limit
 * variants are retryable; every other 4xx means the admin must fix the sheet.
 */
export function isPermanentSyncFailure(error: unknown): boolean {
  const failure = error as SyncFailureShape | null;
  const status = failure?.status;

  if (status === undefined) return false; // network/unknown: retry
  if (status === 429) return false;
  if (status === 403) return !isRateLimitReason(failure?.reason);
  return status >= 400 && status < 500;
}

function isRateLimitReason(reason: string | undefined): boolean {
  return (
    reason === "rateLimitExceeded" ||
    reason === "userRateLimitExceeded" ||
    reason === "quotaExceeded"
  );
}

/**
 * Stored failure text is deliberately generic: no request URL, no spreadsheet
 * contents, no participant data. Operators get a status and a reason code.
 */
export function describeSyncFailure(error: unknown): string {
  const failure = error as SyncFailureShape | null;
  const status = failure?.status;

  if (status === undefined) return "Tidak dapat menghubungi Google Sheets";

  const reason = failure?.reason;
  if (reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") {
    return `Google Sheets membatasi permintaan (${status})`;
  }
  if (status === 401) return "Kredensial Google tidak valid atau kedaluwarsa";
  if (status === 403) return "Service account tidak punya akses tulis ke spreadsheet";
  if (status === 404) return "Spreadsheet atau tab tidak ditemukan";
  if (status === 429) return "Kuota Google Sheets terlampaui";

  return `Google Sheets menolak permintaan (${status})`;
}

export function nextAttemptAt(
  attempts: number,
  now: number,
  random: () => number = Math.random,
): number {
  return now + retryDelayMs(attempts, random);
}
