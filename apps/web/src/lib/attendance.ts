import type {
  AdjustmentRequest,
  AuditListPayload,
  AttendanceDetailPayload,
  AttendanceListPayload,
  AttendanceManualRequest,
  AttendanceStatus,
  EventDashboardPayload,
  GlobalDashboardPayload,
  OutboxListPayload,
  OutboxRetryPayload,
  ReversalRequest,
  ScanResultPayload,
  SyncConfigPayload,
  SyncConfigRequest,
  SyncFullPayload,
  SyncRunPayload,
  SyncStatusPayload,
  SyncTestPayload,
  TransactionDetailPayload,
  TransactionListPayload,
  TransactionRecord,
} from "@absensi/shared";

import { apiRequest } from "./http";
import { apiUrl } from "./api";

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

export function scanQr(
  eventId: string,
  qr: string,
  context: { activityId?: string; sessionId?: string } = {},
) {
  return apiRequest<ScanResultPayload>(`/api/events/${encodeURIComponent(eventId)}/scan`, {
    method: "POST",
    body: JSON.stringify({ qr, deviceTs: Date.now(), ...context }),
  });
}

export function listAttendance(eventId: string, params: AttendanceListParams = {}) {
  return apiRequest<AttendanceListPayload>(eventAttendancePath(eventId, params));
}

export function listEventAudit(
  eventId: string,
  params: { action?: string; limit?: number; cursor?: string } = {},
) {
  const search = new URLSearchParams();
  if (params.action) search.set("action", params.action);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  const suffix = search.toString();
  return apiRequest<AuditListPayload>(
    `/api/events/${encodeURIComponent(eventId)}/audit${suffix ? `?${suffix}` : ""}`,
  );
}

export async function downloadAttendanceCsv(
  eventId: string,
  params: Pick<AttendanceListParams, "query" | "status"> = {},
): Promise<{ ok: true } | { ok: false; message: string }> {
  const search = new URLSearchParams();
  const query = params.query?.trim();
  if (query) search.set("query", query);
  if (params.status && params.status !== "all") search.set("status", params.status);
  const suffix = search.toString();
  const response = await fetch(
    apiUrl(`/api/events/${encodeURIComponent(eventId)}/attendance/export${suffix ? `?${suffix}` : ""}`),
    { credentials: "same-origin", headers: { "x-absensi-csrf": "1" } },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    return { ok: false, message: body?.error?.message ?? "Gagal mengunduh laporan" };
  }

  const blobUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = `laporan-absensi-${eventId}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  return { ok: true };
}

export function listStaffAttendance(params: StaffAttendanceParams = {}) {
  return apiRequest<AttendanceListPayload>(staffAttendancePath(params));
}

export function listTransactions(
  eventId: string,
  params: {
    activityId?: string;
    sessionId?: string;
    type?: TransactionRecord["type"];
    status?: AttendanceStatus | "all";
    effective?: "true" | "false" | "all";
    limit?: number;
    cursor?: string;
  } = {},
) {
  const search = new URLSearchParams();
  if (params.activityId) search.set("activityId", params.activityId);
  if (params.sessionId) search.set("sessionId", params.sessionId);
  if (params.type) search.set("type", params.type);
  if (params.status && params.status !== "all") search.set("status", params.status);
  if (params.effective) search.set("effective", params.effective);
  if (params.limit !== undefined) search.set("limit", String(params.limit));
  if (params.cursor) search.set("cursor", params.cursor);
  const suffix = search.toString();
  return apiRequest<TransactionListPayload>(
    `/api/events/${encodeURIComponent(eventId)}/transactions${suffix ? `?${suffix}` : ""}`,
  );
}

export function reverseTransaction(
  eventId: string,
  transactionId: string,
  input: ReversalRequest,
) {
  return apiRequest<TransactionDetailPayload>(
    `/api/events/${encodeURIComponent(eventId)}/transactions/${encodeURIComponent(
      transactionId,
    )}/reversal`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function adjustTransaction(
  eventId: string,
  transactionId: string,
  input: AdjustmentRequest,
) {
  return apiRequest<TransactionDetailPayload>(
    `/api/events/${encodeURIComponent(eventId)}/transactions/${encodeURIComponent(
      transactionId,
    )}/adjustment`,
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
