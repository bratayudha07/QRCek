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

/**
 * The layout renders one event list (switcher, status chip, schedule) while the
 * pages own the mutations, so a rename or a status transition would leave that
 * chrome showing the previous values until a reload.
 *
 * Pages announce it with a DOM event instead of pulling a store or a React
 * context into a component that sits above the route tree.
 */
const EVENTS_CHANGED = "absensi:events-changed";

/** Call after a mutation that changes the event list (name, status, membership). */
export function notifyEventsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENTS_CHANGED));
}

/** Subscribe to `notifyEventsChanged`; returns the unsubscribe function. */
export function onEventsChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENTS_CHANGED, handler);
  return () => window.removeEventListener(EVENTS_CHANGED, handler);
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
