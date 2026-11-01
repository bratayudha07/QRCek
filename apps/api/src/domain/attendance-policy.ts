import type { EventStatus } from "@absensi/shared";

/**
 * Attendance windows (DESAIN_API.md §6).
 *
 * An event accepts attendance only while it is `active` AND `now` is inside the
 * configured window. A missing bound means "unbounded on that side"; a `draft`,
 * `closed`, or `archived` event never accepts attendance, even if its dates
 * still look valid.
 *
 * Pure so the scanner decision is testable without D1 or a clock.
 */
export interface AttendanceWindow {
  status: EventStatus;
  starts_at: number | null;
  ends_at: number | null;
}

export function isEventOpenForAttendance(event: AttendanceWindow, now: number): boolean {
  if (event.status !== "active") return false;
  if (event.starts_at !== null && now < event.starts_at) return false;
  if (event.ends_at !== null && now > event.ends_at) return false;
  return true;
}
