import type { TransactionType } from "@absensi/shared";

import type { ActivityRow } from "../db/activities";
import { findActivity, listActivities } from "../db/activities";
import type { ActivitySessionRow } from "../db/activity-sessions";
import {
  findActivitySession,
  listActivitySessions,
} from "../db/activity-sessions";
import { businessRule, notFound } from "../http/errors";

/**
 * Resolve the Aktivitas + Sesi context for a transaction (ADR-0018/0019).
 *
 * `activityId` is optional only because Tema created before Q1 have exactly one
 * default Attendance Aktivitas (migration `0011`). When the Tema has zero or
 * several candidates the request is ambiguous, so the caller must choose one;
 * the route never guesses. A Sesi is never inferred from the clock — an
 * Aktivitas with Sesi always needs an explicit, valid `sessionId` (FR-185).
 *
 * `resolveTransactionContext` is type-agnostic on purpose: the scan route accepts
 * both Attendance and Consumption and branches afterwards, while every
 * Attendance-only caller keeps using `resolveAttendanceContext`.
 */

export interface TransactionContext {
  activity: ActivityRow;
  session: ActivitySessionRow | null;
}

export async function resolveTransactionContext(
  db: D1Database,
  input: {
    eventId: string;
    activityId?: string;
    sessionId?: string;
  },
): Promise<TransactionContext> {
  let activity: ActivityRow | null;

  if (input.activityId) {
    activity = await findActivity(db, input.eventId, input.activityId);
    if (!activity) throw notFound("Aktivitas tidak ditemukan pada acara ini");
  } else {
    // Only Attendance can be inferred: it is the single Aktivitas the Q5
    // migration created per Tema. A Consumption Aktivitas is never assumed.
    const candidates = (await listActivities(db, input.eventId)).filter(
      (row) => row.transaction_type === "attendance" && row.status !== "archived",
    );

    if (candidates.length === 0) {
      throw businessRule(
        "Acara ini belum punya Aktivitas absensi. Buat Aktivitas terlebih dahulu.",
        { reason: "context_mismatch" },
      );
    }
    if (candidates.length > 1) {
      throw businessRule(
        "Ada lebih dari satu Aktivitas absensi. Pilih Aktivitas terlebih dahulu.",
        {
          reason: "context_mismatch",
          activityIds: candidates.map((row) => row.id),
        },
      );
    }

    activity = candidates[0] as ActivityRow;
  }

  const sessions = await listActivitySessions(db, activity.id);

  if (sessions.length > 0) {
    if (!input.sessionId) {
      throw businessRule("Sesi wajib dipilih untuk Aktivitas ini.", {
        reason: "session_required",
      });
    }

    const session = await findActivitySession(db, activity.id, input.sessionId);
    if (!session) {
      throw businessRule("Sesi bukan milik Aktivitas ini.", {
        reason: "context_mismatch",
      });
    }

    return { activity, session };
  }

  if (input.sessionId) {
    throw businessRule("Aktivitas ini tidak memiliki Sesi.", {
      reason: "context_mismatch",
    });
  }

  return { activity, session: null };
}

/**
 * Attendance-only context. A Consumption Aktivitas is a request error here, so a
 * scan or Manual Entry can never write the wrong transaction type.
 */
export async function resolveAttendanceContext(
  db: D1Database,
  input: {
    eventId: string;
    activityId?: string;
    sessionId?: string;
  },
): Promise<TransactionContext> {
  const context = await resolveTransactionContext(db, input);
  assertActivityType(context.activity, "attendance");
  return context;
}

/**
 * Consumption-only context (Q7). The Aktivitas must be named: unlike Attendance
 * there is no default one to fall back to, and guessing would spend a quota on
 * the wrong Aktivitas.
 */
export async function resolveConsumptionContext(
  db: D1Database,
  input: {
    eventId: string;
    activityId?: string;
    sessionId?: string;
  },
): Promise<TransactionContext> {
  if (!input.activityId) {
    throw businessRule("Pilih Aktivitas konsumsi terlebih dahulu.", {
      reason: "context_mismatch",
    });
  }

  const context = await resolveTransactionContext(db, input);
  assertActivityType(context.activity, "consumption");
  return context;
}

function assertActivityType(activity: ActivityRow, expected: TransactionType): void {
  if (activity.transaction_type === expected) return;

  throw businessRule(
    expected === "attendance"
      ? "Aktivitas ini bukan Aktivitas absensi."
      : "Aktivitas ini bukan Aktivitas konsumsi.",
    { reason: "context_mismatch" },
  );
}
