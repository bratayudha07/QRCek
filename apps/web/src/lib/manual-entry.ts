import {
  staffContextReadiness,
  type AttendanceManualRequest,
  type AttendanceRecord,
  type AttendanceStatus,
  type StaffContext,
} from "@absensi/shared";

/**
 * Pure helpers for Manual Entry on the staff scanner (Q5 delta).
 *
 * The Worker stays authoritative: the UI only decides whether the button is
 * offered and how to shape the request. Manual Entry is never an entitlement
 * bypass (FR-073, BR-034, AC-055).
 */

export interface ManualEntryStatusOption {
  status: AttendanceStatus;
  label: string;
}

/** Same wording as the attendance screens, so a status never reads differently. */
export const MANUAL_ENTRY_STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Hadir",
  late: "Terlambat",
  excused: "Izin",
  absent: "Tidak hadir",
};

export function manualEntryStatuses(): ManualEntryStatusOption[] {
  return [
    { status: "present", label: MANUAL_ENTRY_STATUS_LABEL.present },
    { status: "late", label: MANUAL_ENTRY_STATUS_LABEL.late },
    { status: "excused", label: MANUAL_ENTRY_STATUS_LABEL.excused },
    { status: "absent", label: MANUAL_ENTRY_STATUS_LABEL.absent },
  ];
}

/**
 * Manual Entry needs both the assignment flag and a usable context. A closed
 * Aktivitas/Sesi would be rejected by the Worker anyway, so it is not offered.
 */
export function canUseManualEntry(context: StaffContext): boolean {
  return context.canManualCheckIn === true && staffContextReadiness(context).ready;
}

/**
 * Aktivitas/Sesi always come from the active scanner context; the operator
 * cannot move the scope from the dialog. An empty note is omitted rather than
 * sent as `""` (the Worker trims and treats it as absent).
 */
export function manualEntryRequest(
  context: StaffContext,
  participantId: string,
  status: AttendanceStatus,
  note: string | null | undefined,
): AttendanceManualRequest {
  const trimmedNote = note?.trim() ?? "";

  return {
    participantId,
    activityId: context.activityId,
    ...(context.sessionId !== null ? { sessionId: context.sessionId } : {}),
    status,
    ...(trimmedNote ? { note: trimmedNote } : {}),
  };
}

export function manualEntrySuccessMessage(
  record: Pick<AttendanceRecord, "participantName" | "status">,
): string {
  return `Kehadiran manual tercatat untuk ${record.participantName} (${MANUAL_ENTRY_STATUS_LABEL[record.status]}).`;
}
