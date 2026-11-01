import type {
  EventRole,
  InviteCreatedPayload,
  InviteListPayload,
  MemberListPayload,
} from "@absensi/shared";

import { apiRequest } from "./http";

export function listEventMembers(eventId: string) {
  return apiRequest<MemberListPayload>(`/api/events/${encodeURIComponent(eventId)}/members`);
}

export function listEventInvites(eventId: string) {
  return apiRequest<InviteListPayload>(`/api/events/${encodeURIComponent(eventId)}/invites`);
}

export function createEventInvite(
  eventId: string,
  input: { role: EventRole; invitedName?: string; expiresInHours: number },
) {
  return apiRequest<InviteCreatedPayload>(`/api/events/${encodeURIComponent(eventId)}/invites`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteEventInvite(eventId: string, inviteId: string) {
  return apiRequest<{ deleted: true }>(
    `/api/events/${encodeURIComponent(eventId)}/invites/${encodeURIComponent(inviteId)}`,
    { method: "DELETE" },
  );
}

export function revokeEventMember(eventId: string, userId: string) {
  return apiRequest<{ revoked: true }>(
    `/api/events/${encodeURIComponent(eventId)}/members/${encodeURIComponent(userId)}/revoke`,
    { method: "POST" },
  );
}
