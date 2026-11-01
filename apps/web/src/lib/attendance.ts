import type {
  AttendanceCorrectionRequest,
  AttendanceDetailPayload,
  AttendanceListPayload,
  AttendanceManualRequest,
  AttendanceStatus,
  EventDashboardPayload,
  GlobalDashboardPayload,
  OutboxListPayload,
  OutboxRetryPayload,
  ScanResultPayload,
  SyncConfigPayload,
  SyncConfigRequest,
  SyncFullPayload,
  SyncRunPayload,
  SyncStatusPayload,
  SyncTestPayload,
} from "@absensi/shared";

import { apiRequest } from "./http";

/** Typed bindings for scan, attendance, dashboard, and sync. No business rules. */

export interface AttendanceListParams {
  query?: string;
  status?: AttendanceStatus | "all";
  limit?: number;
  cursor?: string;
}

export interface StaffAttendanceParams {
  eventId?: string;
  limit?: number;
  cursor?: string;
}

export function eventAttendancePath(
  eventId: string,
  params: AttendanceListParams = {},
): string {
  const search = new URLSearchParams();

  const query = params.query?.trim();
  if (query) search.set("query", query);
  if (params.status && params.status !== "all") search.set("status", params.status);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);

  const suffix = search.toString();

  return `/api/events/${encodeURIComponent(eventId)}/attendance${suffix ? `?${suffix}` : ""}`;
}

export function staffAttendancePath(params: StaffAttendanceParams = {}): string {
  const search = new URLSearchParams();

  if (params.eventId) search.set("eventId", params.eventId);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);

  const suffix = search.toString();
  return `/api/staff/attendance${suffix ? `?${suffix}` : ""}`;
}

export function scanQr(eventId: string, qr: string) {
  return apiRequest<ScanResultPayload>(`/api/events/${encodeURIComponent(eventId)}/scan`, {
    method: "POST",
    body: JSON.stringify({ qr, deviceTs: Date.now() }),
  });
}

export function listAttendance(eventId: string, params: AttendanceListParams = {}) {
  return apiRequest<AttendanceListPayload>(eventAttendancePath(eventId, params));
}

export function listStaffAttendance(params: StaffAttendanceParams = {}) {
  return apiRequest<AttendanceListPayload>(staffAttendancePath(params));
}

export function correctAttendance(
  eventId: string,
  attendanceId: string,
  input: AttendanceCorrectionRequest,
) {
  return apiRequest<AttendanceDetailPayload>(
    `/api/events/${encodeURIComponent(eventId)}/attendance/${encodeURIComponent(
      attendanceId,
    )}/correction`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function createManualAttendance(eventId: string, input: AttendanceManualRequest) {
  return apiRequest<AttendanceDetailPayload>(
    `/api/events/${encodeURIComponent(eventId)}/attendance/manual`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function getEventDashboard(eventId: string) {
  return apiRequest<EventDashboardPayload>(
    `/api/events/${encodeURIComponent(eventId)}/dashboard`,
  );
}

export function getGlobalDashboard() {
  return apiRequest<GlobalDashboardPayload>("/api/dashboard");
}

export function getSyncConfig(eventId: string) {
  return apiRequest<SyncStatusPayload>(`/api/events/${encodeURIComponent(eventId)}/sync`);
}

export function saveSyncConfig(eventId: string, input: SyncConfigRequest) {
  return apiRequest<SyncConfigPayload>(`/api/events/${encodeURIComponent(eventId)}/sync`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function testSync(eventId: string) {
  return apiRequest<SyncTestPayload>(
    `/api/events/${encodeURIComponent(eventId)}/sync/test`,
    { method: "POST" },
  );
}

export function runSync(eventId: string, limit = 5) {
  return apiRequest<SyncRunPayload>(
    `/api/events/${encodeURIComponent(eventId)}/sync/run`,
    { method: "POST", body: JSON.stringify({ limit }) },
  );
}

export function fullSync(eventId: string) {
  return apiRequest<SyncFullPayload>(
    `/api/events/${encodeURIComponent(eventId)}/sync/full`,
    { method: "POST" },
  );
}

export function listSyncOutbox(eventId: string, status = "all", limit = 25) {
  const search = new URLSearchParams({ status, limit: String(limit) });
  return apiRequest<OutboxListPayload>(
    `/api/events/${encodeURIComponent(eventId)}/sync/outbox?${search.toString()}`,
  );
}

export function retrySyncItem(eventId: string, outboxId: string) {
  return apiRequest<OutboxRetryPayload>(
    `/api/events/${encodeURIComponent(eventId)}/sync/outbox/${encodeURIComponent(
      outboxId,
    )}/retry`,
    { method: "POST" },
  );
}
