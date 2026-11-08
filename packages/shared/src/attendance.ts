import type { EventStatus } from "./schemas/events";

/** Response contracts for scan, attendance, and recap (DESAIN_API.md §7). */

export const ATTENDANCE_STATUSES = ["present", "late", "absent", "excused"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_METHODS = ["qr_scan", "manual", "correction"] as const;
export type AttendanceMethod = (typeof ATTENDANCE_METHODS)[number];

/** Business results are HTTP 200; only auth/validation/system failures are 4xx/5xx. */
export const SCAN_RESULTS = [
  "present",
  "duplicate",
  "not_found",
  "wrong_event",
  "event_closed",
  "participant_inactive",
] as const;
export type ScanResult = (typeof SCAN_RESULTS)[number];

export interface ScanParticipant {
  id: string;
  fullName: string;
  externalRef: string | null;
  category: string | null;
}

export interface ScanAttendance {
  status: AttendanceStatus;
  checkedInAt: number;
}

export interface ScanResultPayload {
  result: ScanResult;
  /** Present for `present`, `duplicate`, and `participant_inactive`. */
  participant?: ScanParticipant;
  /** Present for `present` and `duplicate`. */
  attendance?: ScanAttendance;
  /** Present for `event_closed`, so staff can tell which event blocked them. */
  eventName?: string;
}

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
