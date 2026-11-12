import type {
  AttendanceStatus,
  EventStatus,
  ScanReason,
  TransactionSource,
  TransactionType,
} from "@absensi/shared";

/**
 * Pure transaction rules (ADR-0018/0019/0020/0022).
 *
 * The route still performs the lookups; everything here is a decision table so
 * the lifecycle and result-code mapping can be tested without D1 or a clock.
 */

export interface TransactionLifecycleInput {
  event: { status: EventStatus; starts_at: number | null; ends_at: number | null };
  activity: { status: string; archived_at: number | null };
  session: { status: string; archived_at: number | null } | null;
  participant: { status: "active" | "inactive" };
  now: number;
}

/**
 * Returns the rejection reason for a *new* transaction, or `null` when the
 * context currently accepts one. Adjustments deliberately skip this check.
 */
export function lifecycleRejection(
  input: TransactionLifecycleInput,
): ScanReason | null {
  const { event, activity, session, participant, now } = input;

  if (event.status === "archived") return "theme_archived";
  if (event.status !== "active") return "theme_not_active";
  if (event.starts_at !== null && now < event.starts_at) return "theme_not_active";
  if (event.ends_at !== null && now > event.ends_at) return "theme_not_active";

  if (participant.status !== "active") return "participant_inactive";

  if (activity.archived_at !== null || activity.status === "archived") {
    return "activity_archived";
  }
  if (activity.status !== "active") return "activity_not_active";

  if (session !== null) {
    if (session.archived_at !== null) return "session_archived";
    if (session.status !== "in_progress") return "session_not_in_progress";
  }

  return null;
}

/**
 * Shape checks that are request errors (422), not business results. A Sesi is
 * never inferred from the clock, and an Activity with Sessions always needs an
 * explicit Session id (FR-185, FR-187).
 */
export function contextShapeError(input: {
  activityType: TransactionType;
  activityHasSessions: boolean;
  requestedSessionId: string | null;
}): "context_mismatch" | "session_required" | null {
  if (input.activityType !== "attendance") return "context_mismatch";
  if (input.activityHasSessions && input.requestedSessionId === null) {
    return "session_required";
  }
  if (!input.activityHasSessions && input.requestedSessionId !== null) {
    return "context_mismatch";
  }
  return null;
}

const REASON_MESSAGES: Record<ScanReason, string> = {
  duplicate: "Sudah tercatat hadir",
  qr_invalid: "QR tidak dikenali",
  participant_inactive: "Peserta tidak aktif",
  entitlement_denied: "Peserta tidak berhak mengikuti aktivitas ini",
  theme_archived: "Acara sudah diarsipkan",
  theme_not_active: "Acara belum atau sudah tidak menerima absensi",
  activity_not_active: "Aktivitas belum aktif atau sudah selesai",
  activity_archived: "Aktivitas sudah diarsipkan",
  session_required: "Sesi belum dipilih",
  context_mismatch: "Konteks Aktivitas/Sesi tidak cocok",
  session_not_in_progress: "Sesi belum berlangsung atau sudah selesai",
  session_archived: "Sesi sudah diarsipkan",
};

export function scanMessage(reason: ScanReason | null): string {
  if (reason === null) return "Kehadiran tercatat";
  return REASON_MESSAGES[reason];
}

export interface AdjustableValues {
  occurredAt: number;
  note: string | null;
  status: AttendanceStatus | null;
}

export interface AdjustmentDiff {
  changed: boolean;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/**
 * Snapshot only allowlisted adjustment fields. Notes are never stored in audit
 * or correction JSON; `noteChanged` carries the fact without the value.
 */
export function adjustmentDiff(
  before: AdjustableValues,
  after: AdjustableValues,
): AdjustmentDiff {
  const beforeSnapshot: Record<string, unknown> = {};
  const afterSnapshot: Record<string, unknown> = {};

  if (before.occurredAt !== after.occurredAt) {
    beforeSnapshot.occurredAt = before.occurredAt;
    afterSnapshot.occurredAt = after.occurredAt;
  }

  if (before.status !== after.status) {
    beforeSnapshot.status = before.status;
    afterSnapshot.status = after.status;
  }

  if (before.note !== after.note) {
    beforeSnapshot.noteChanged = true;
    afterSnapshot.noteChanged = true;
  }

  return {
    changed: Object.keys(afterSnapshot).length > 0,
    before: beforeSnapshot,
    after: afterSnapshot,
  };
}

export interface TransactionLike {
  id: string;
  theme_id: string;
  activity_id: string;
  session_id: string | null;
  participant_id: string;
  type: TransactionType;
  source: TransactionSource;
  status: AttendanceStatus | null;
  occurred_at: number;
  adjusts_transaction_id: string | null;
  reversed_at: number | null;
  superseded_at: number | null;
}

/** Allowlisted audit snapshot for a transaction (ADR-0020). */
export function transactionSnapshot(
  row: TransactionLike,
  overrides: { noteChanged?: boolean } = {},
): Record<string, unknown> {
  return {
    themeId: row.theme_id,
    activityId: row.activity_id,
    sessionId: row.session_id,
    participantId: row.participant_id,
    type: row.type,
    source: row.source,
    status: row.status,
    occurredAt: row.occurred_at,
    ...(overrides.noteChanged ? { noteChanged: true } : {}),
    adjustsTransactionId: row.adjusts_transaction_id,
    reversedAt: row.reversed_at,
    supersededAt: row.superseded_at,
  };
}
