import type { SyncRunPayload } from "@absensi/shared";

import {
  claimOutboxStatement,
  listDueOutbox,
  markOutboxDoneStatement,
  markOutboxFailureStatement,
  pruneDoneOutboxStatement,
  reclaimStaleStatement,
} from "../db/outbox";
import type { OutboxJoinedRow } from "../db/outbox";
import { findSyncState, findProjectionData, reserveSheetRow, setSyncErrorStatement } from "../db/sync";
import type { ProjectionRow } from "../db/sync";
import {
  OUTBOX_DONE_RETENTION_MS,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_STALE_MS,
  describeSyncFailure,
  isPermanentSyncFailure,
  nextAttemptAt,
} from "../domain/outbox-policy";
import { GoogleSheetsGateway, SheetsConfigError } from "../domain/sheets";
import type { SheetTarget, SheetsGateway, SheetWriteRow } from "../domain/sheets";
import { buildSheetRow } from "../domain/sheet-projection";
import type { Env } from "../env";

/**
 * Outbox processor (ADR-005).
 *
 * Attendance never waits for this service: the scan response is already sent
 * when cron runs. A failure here only affects the spreadsheet projection, never
 * the authoritative D1 attendance row.
 *
 * Idempotency comes from `sheet_rows`: a retry writes the same participant row,
 * so a successful but unacknowledged batch cannot create duplicates.
 */

export interface ProcessOutboxOptions {
  now: number;
  limit?: number;
  /** Restrict a manual run to one event; cron omits it. */
  eventId?: string;
  /** Injected in tests; production uses the real Workers-compatible client. */
  gateway?: SheetsGateway;
  random?: () => number;
}

interface PendingWrite {
  item: OutboxJoinedRow;
  rowIndex: number;
  values: string[];
}

function projection(row: ProjectionRow): {
  participant: Parameters<typeof buildSheetRow>[0];
  attendance: Parameters<typeof buildSheetRow>[1];
} {
  return {
    participant: {
      id: row.participant_id,
      externalRef: row.external_ref,
      fullName: row.full_name,
      category: row.category,
    },
    attendance:
      row.attendance_status === null
        ? null
        : {
            status: row.attendance_status,
            checkedInAt: row.checked_in_at ?? 0,
            method: row.method ?? "",
            updatedAt: row.attendance_updated_at ?? 0,
          },
  };
}

export async function processOutbox(
  env: Env,
  options: ProcessOutboxOptions,
): Promise<SyncRunPayload> {
  const now = options.now;
  const limit = options.limit ?? 5;
  const random = options.random ?? Math.random;

  await env.DB.batch([
    reclaimStaleStatement(env.DB, { now, staleBefore: now - OUTBOX_STALE_MS }),
    pruneDoneOutboxStatement(env.DB, {
      now,
      olderThan: now - OUTBOX_DONE_RETENTION_MS,
    }),
  ]);

  const due = await listDueOutbox(env.DB, { now, limit, eventId: options.eventId });
  if (due.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, dead: 0, skipped: 0, error: null };
  }

  const claims = await env.DB.batch(
    due.map((item) => claimOutboxStatement(env.DB, { id: item.id, now })),
  );

  const claimed = due.filter((_, index) => (claims[index]?.meta.changes ?? 0) > 0);
  const skipped = due.length - claimed.length;

  if (claimed.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, dead: 0, skipped, error: null };
  }

  const gateway = options.gateway ?? new GoogleSheetsGateway(env, fetch, () => now);

  const byEvent = new Map<string, OutboxJoinedRow[]>();
  for (const item of claimed) {
    const group = byEvent.get(item.event_id) ?? [];
    group.push(item);
    byEvent.set(item.event_id, group);
  }

  let succeeded = 0;
  let failed = 0;
  let dead = 0;
  let lastError: string | null = null;

  for (const [eventId, items] of byEvent) {
    const state = await findSyncState(env.DB, eventId);
    if (!state || state.sync_enabled !== 1) {
      // Cancelled between claim and processing: release without burning tries.
      await env.DB.batch(
        items.map((item) =>
          markOutboxFailureStatement(env.DB, {
            id: item.id,
            attempts: item.attempts,
            nextAttemptAt: now,
            error: "Sinkronisasi acara dinonaktifkan",
            dead: false,
            now,
          }),
        ),
      );
      continue;
    }

    const target: SheetTarget = {
      spreadsheetId: state.spreadsheet_id,
      sheetTab: state.sheet_tab,
    };

    const writes: PendingWrite[] = [];

    for (const item of items) {
      try {
        const data = await findProjectionData(env.DB, eventId, item.participant_id);
        if (!data) throw new Error("participant_missing");

        const rowIndex = await reserveSheetRow(env.DB, eventId, item.participant_id, now);
        const { participant, attendance } = projection(data);

        writes.push({
          item,
          rowIndex,
          values: buildSheetRow(participant, attendance),
        });
      } catch (error) {
        const attempts = item.attempts + 1;
        const failure = describeSyncFailure(error);
        const isDead = attempts >= OUTBOX_MAX_ATTEMPTS;

        await markOutboxFailureStatement(env.DB, {
          id: item.id,
          attempts,
          nextAttemptAt: nextAttemptAt(attempts, now, random),
          error: failure,
          dead: isDead,
          now,
        }).run();

        if (isDead) dead += 1;
        else failed += 1;
        lastError = failure;
      }
    }

    if (writes.length === 0) continue;

    try {
      await gateway.ensureLayout(target, eventId);
      await gateway.writeRows(
        target,
        writes.map<SheetWriteRow>((write) => ({
          rowIndex: write.rowIndex,
          values: write.values,
        })),
      );

      await env.DB.batch([
        ...writes.map((write) => markOutboxDoneStatement(env.DB, { id: write.item.id, now })),
        setSyncErrorStatement(env.DB, { eventId, message: null, now }),
      ]);

      succeeded += writes.length;
      lastError = null;
    } catch (error) {
      const message = describeSyncFailure(error);
      const permanent =
        isPermanentSyncFailure(error) || error instanceof SheetsConfigError;

      const statements = writes.map((write) => {
        const attempts = write.item.attempts + 1;
        const isDead = permanent || attempts >= OUTBOX_MAX_ATTEMPTS;
        if (isDead) dead += 1;
        else failed += 1;

        return markOutboxFailureStatement(env.DB, {
          id: write.item.id,
          attempts,
          nextAttemptAt: nextAttemptAt(attempts, now, random),
          error: message,
          dead: isDead,
          now,
        });
      });

      await env.DB.batch([
        ...statements,
        setSyncErrorStatement(env.DB, { eventId, message, now }),
      ]);

      lastError = message;
    }
  }

  return {
    processed: claimed.length,
    succeeded,
    failed,
    dead,
    skipped,
    error: lastError,
  };
}
