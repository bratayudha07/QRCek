import type {
  EventCreateRequest,
  EventDeletePayload,
  EventDetailPayload,
  EventListPayload,
  EventStatus,
  EventStatusRequest,
  EventSummaryPayload,
  EventUpdateRequest,
} from "@absensi/shared";

import { apiRequest } from "./http";

/** Typed bindings for `/api/events`. No business rules here. */

export function listEvents() {
  return apiRequest<EventListPayload>("/api/events");
}

export function getEvent(eventId: string) {
  return apiRequest<EventDetailPayload>(`/api/events/${encodeURIComponent(eventId)}`);
}

export function getEventSummary(eventId: string) {
  return apiRequest<EventSummaryPayload>(`/api/events/${encodeURIComponent(eventId)}/summary`);
}

export function createEvent(input: EventCreateRequest) {
  return apiRequest<EventDetailPayload>("/api/events", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateEvent(eventId: string, input: EventUpdateRequest) {
  return apiRequest<EventDetailPayload>(`/api/events/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function changeEventStatus(eventId: string, status: EventStatus) {
  const body: EventStatusRequest = { status };

  return apiRequest<EventDetailPayload>(`/api/events/${encodeURIComponent(eventId)}/status`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteEvent(eventId: string) {
  return apiRequest<EventDeletePayload>(`/api/events/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
  });
}
