import type {
  StaffAssignmentCreateRequest,
  StaffAssignmentDetailPayload,
  StaffAssignmentListPayload,
  StaffAssignmentStatus,
  StaffAssignmentUpdateRequest,
  StaffContextListPayload,
} from "@absensi/shared";

import { apiRequest } from "./http";

/** Typed bindings for assignment management and the scanner context list. */

export type AssignmentStatusFilter = StaffAssignmentStatus | "all";

export function assignmentsPath(
  eventId: string,
  status: AssignmentStatusFilter = "active",
): string {
  const search = new URLSearchParams();
  if (status !== "active") search.set("status", status);
  const suffix = search.toString();
  return `/api/events/${encodeURIComponent(eventId)}/assignments${suffix ? `?${suffix}` : ""}`;
}

export function assignmentPath(eventId: string, assignmentId: string): string {
  return `/api/events/${encodeURIComponent(eventId)}/assignments/${encodeURIComponent(
    assignmentId,
  )}`;
}

export function assignmentRevokePath(eventId: string, assignmentId: string): string {
  return `${assignmentPath(eventId, assignmentId)}/revoke`;
}

export const staffAssignmentsPath = "/api/staff/assignments";

export function listEventAssignments(
  eventId: string,
  status: AssignmentStatusFilter = "active",
) {
  return apiRequest<StaffAssignmentListPayload>(assignmentsPath(eventId, status));
}

export function createAssignment(
  eventId: string,
  input: StaffAssignmentCreateRequest,
) {
  return apiRequest<StaffAssignmentDetailPayload>(assignmentsPath(eventId), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAssignmentManualFlag(
  eventId: string,
  assignmentId: string,
  input: StaffAssignmentUpdateRequest,
) {
  return apiRequest<StaffAssignmentDetailPayload>(
    assignmentPath(eventId, assignmentId),
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function revokeAssignment(eventId: string, assignmentId: string) {
  return apiRequest<StaffAssignmentDetailPayload>(
    assignmentRevokePath(eventId, assignmentId),
    { method: "POST" },
  );
}

/** Active scanner contexts of the signed-in user. */
export function listMyStaffContexts() {
  return apiRequest<StaffContextListPayload>(staffAssignmentsPath);
}
