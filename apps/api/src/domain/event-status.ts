import type { EventStatus } from "@absensi/shared";
import { EVENT_TRANSITIONS, canTransitionEvent } from "@absensi/shared";

/**
 * Event lifecycle (DESAIN_API.md §3).
 *
 * The transition table lives in `packages/shared` so the UI and the Worker
 * cannot disagree about which buttons are possible. This module is the API's
 * naming layer for it; the rule itself is still enforced server-side.
 */

export const ALLOWED_TRANSITIONS: Readonly<Record<EventStatus, readonly EventStatus[]>> =
  EVENT_TRANSITIONS;

export const canTransition: (from: EventStatus, to: EventStatus) => boolean = canTransitionEvent;

export function allowedTransitions(from: EventStatus): readonly EventStatus[] {
  return ALLOWED_TRANSITIONS[from];
}
