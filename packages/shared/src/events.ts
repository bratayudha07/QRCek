import type { EventRole } from "./schemas/auth";
import type { EventStatus } from "./schemas/events";

/** Response contracts for event management (DESAIN_API.md §3). */

export type EventAccessRole = EventRole | "superadmin";

/**
 * Event lifecycle: `archived` is final, and `active → archived` is deliberately
 * missing so an event cannot be archived without being closed first.
 *
 * Shared so the web UI offers exactly the transitions the Worker accepts; the
 * Worker still makes the authoritative decision.
 */
export const EVENT_TRANSITIONS: Readonly<Record<EventStatus, readonly EventStatus[]>> = {
  draft: ["active"],
  active: ["closed"],
  closed: ["active", "archived"],
  archived: [],
};

export function allowedEventTransitions(from: EventStatus): readonly EventStatus[] {
  return EVENT_TRANSITIONS[from];
}

export function canTransitionEvent(from: EventStatus, to: EventStatus): boolean {
  return EVENT_TRANSITIONS[from].includes(to);
}

export interface EventSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  timezone: string;
  startsAt: number | null;
  endsAt: number | null;
  status: EventStatus;
  allowManual: boolean;
  createdAt: number;
  /** Caller's effective role: membership role, or `superadmin`. */
  accessRole: EventAccessRole;
  participantCount: number;
}

export interface EventListPayload {
  events: EventSummary[];
}

export interface EventDetailPayload {
  event: EventSummary;
}

export interface EventSummaryPayload {
  participantCount: number;
  activeParticipantCount: number;
  inactiveParticipantCount: number;
}

export interface EventDeletePayload {
  deleted: true;
}
