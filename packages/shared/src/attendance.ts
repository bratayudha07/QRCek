import type { EventStatus } from "./schemas/events";
import type { TransactionType } from "./schemas/activities";

/** Response contracts for scan, attendance, recap, and transactions (DESAIN_API.md §7). */

export const ATTENDANCE_STATUSES = ["present", "late", "absent", "excused"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/**
 * `correction` is kept only for legacy `attendance.method` rows that existed
 * before Q5. New writes use `TransactionSource`, which never contains it
 * (FR-072, ADR-0018).
 */
export const ATTENDANCE_METHODS = ["qr_scan", "manual", "correction"] as const;
export type AttendanceMethod = (typeof ATTENDANCE_METHODS)[number];

export const TRANSACTION_SOURCES = ["qr_scan", "manual"] as const;
export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

/**
 * Stable business results (FR-088, ADR-0022). They are never translated and
 * never aliased to the pre-Q5 values; the web client is updated in the same
 * release.
 */
export const SCAN_RESULTS = ["SUCCESS", "DUPLICATE", "NOT_ENTITLED", "INVALID_QR"] as const;
export type ScanResult = (typeof SCAN_RESULTS)[number];

/** Machine-readable reason for a non-success result. Adding values is safe. */
export const SCAN_REASONS = [
  "duplicate",
  "qr_invalid",
  "participant_inactive",
  "entitlement_denied",
  "theme_archived",
  "theme_not_active",
  "activity_not_active",
  "activity_archived",
  "session_required",
  "context_mismatch",
  "session_not_in_progress",
  "session_archived",
] as const;
export type ScanReason = (typeof SCAN_REASONS)[number];

export interface ScanParticipant {
  id: string;
  fullName: string;
  externalRef: string | null;
  category: string | null;
}

export interface ScanTransaction {
  id: string;
  activityId: string;
  sessionId: string | null;
  occurredAt: number;
  status: AttendanceStatus | null;
}

export interface ScanResultPayload {
  result: ScanResult;
  /** `null` only for `SUCCESS`. */
  reason: ScanReason | null;
  /** Ready-to-display Bahasa Indonesia message. */
  message: string;
  /** Present only when the participant belongs to the scanned Tema. */
  participant?: ScanParticipant;
  /** Present for `SUCCESS` and `DUPLICATE`. */
  transaction?: ScanTransaction;
}

/** Legacy attendance list contract, kept until Q8 (ADR-0022). */
export interface AttendanceRecord {
  id: string;
  eventId: string;
  eventName: string;
  participantId: string;
  participantName: string;
  participantExternalRef: string | null;
  category: string | null;
  status: AttendanceStatus;
  checkedInAt: number;
  recordedBy: string | null;
  recordedByName: string | null;
  method: AttendanceMethod;
  note: string | null;
  updatedAt: number;
}

export interface AttendanceListPayload {
  items: AttendanceRecord[];
  nextCursor: string | null;
}

export interface AttendanceDetailPayload {
  attendance: AttendanceRecord;
}

export interface AttendanceActivity {
  participantId: string;
  participantName: string;
  category: string | null;
  status: AttendanceStatus;
  checkedInAt: number;
}

/** Target transaction contract (ADR-0018). */
export interface TransactionRecord {
  id: string;
  themeId: string;
  activityId: string;
  sessionId: string | null;
  participantId: string;
  type: TransactionType;
  source: TransactionSource;
  status: AttendanceStatus | null;
  occurredAt: number;
  recordedBy: string | null;
  note: string | null;
  slotNo: number | null;
  adjustsTransactionId: string | null;
  reversedAt: number | null;
  supersededAt: number | null;
  effective: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TransactionDetailPayload {
  transaction: TransactionRecord;
}

export interface TransactionListPayload {
  items: TransactionRecord[];
  nextCursor: string | null;
}

export interface EventDashboardPayload {
  event: {
    id: string;
    name: string;
    status: EventStatus;
    startsAt: number | null;
    endsAt: number | null;
    allowManual: boolean;
  };
  totalParticipants: number;
  activeParticipants: number;
  presentCount: number;
  notPresentCount: number;
  /** `present / totalParticipants × 100`, one decimal. */
  attendancePercentage: number;
  byStatus: Record<AttendanceStatus, number>;
  recent: AttendanceActivity[];
  lastAttendanceAt: number | null;
}

export type GlobalEventAccessRole = "superadmin" | "event_admin" | "officer";

export interface GlobalDashboardEvent {
  id: string;
  name: string;
  status: EventStatus;
  startsAt: number | null;
  endsAt: number | null;
  accessRole: GlobalEventAccessRole;
  participantCount: number;
  presentCount: number;
  attendancePercentage: number;
}

export interface GlobalDashboardPayload {
  events: GlobalDashboardEvent[];
  totals: {
    events: number;
    participants: number;
    present: number;
    attendancePercentage: number;
  };
}

/** One decimal place, integer-safe, and `0` when the denominator is zero. */
export function attendancePercentage(present: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((present / total) * 1000) / 10;
}

/**
 * Stage 4 QR payload contract, mirrored for the scanner so the browser can
 * reject obvious garbage before spending a request. The Worker still parses
 * and hashes the token; this is a UX filter, never an authorization decision.
 */
export const QR_SCAN_PREFIX = "absensi:v1:";

export function normalizeScannedQr(raw: string): string | null {
  const value = raw.trim();
  if (!value.startsWith(QR_SCAN_PREFIX)) return null;

  const token = value.slice(QR_SCAN_PREFIX.length);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? value : null;
}
