import type { EventRole, Role } from "@absensi/shared";

/**
 * Single source of truth for authorization (AGENTS.md: "Otorisasi selalu
 * dievaluasi di Worker"; RENCANA_PENGUJIAN.md §5.1).
 *
 * Tests iterate `ACTIONS × ROLES`, so adding an action without a rule fails
 * the matrix test instead of silently defaulting to "allow".
 */

export type Action =
  | "event:create"
  | "event:read"
  | "event:update"
  | "event:delete"
  | "invite:manage"
  | "participant:read"
  | "participant:write"
  | "participant:import"
  | "qr:print"
  | "scan"
  | "recap:read"
  | "attendance:correct"
  | "audit:read"
  | "sync:configure";

/**
 * Minimum event membership needed for a non-superadmin to perform an action on
 * that event. `null` means "no event membership can grant it" (superadmin only).
 *
 * The membership role, not `users.role`, is the authority for a specific
 * event: a user can be `event_admin` globally but only an `officer` in an event
 * they were invited to as an officer.
 */
const MIN_MEMBERSHIP: Record<Action, EventRole | null> = {
  "event:create": null,
  "event:read": "officer",
  "event:update": "event_admin",
  "event:delete": null,
  "invite:manage": "event_admin",
  "participant:read": "officer",
  "participant:write": "event_admin",
  "participant:import": "event_admin",
  "qr:print": "event_admin",
  scan: "officer",
  "recap:read": "officer",
  "attendance:correct": "event_admin",
  "audit:read": "event_admin",
  "sync:configure": "event_admin",
};

export const ACTIONS: readonly Action[] = Object.keys(MIN_MEMBERSHIP) as Action[];

const MEMBERSHIP_RANK: Record<EventRole, number> = {
  officer: 1,
  event_admin: 2,
};

export interface AuthorizationInput {
  /** Global role from `users.role`. */
  role: Role;
  action: Action;
  /** Membership role for the event in question, or null when not a member. */
  membershipRole: EventRole | null;
}

/**
 * `true` when the principal may perform `action` on the given event.
 *
 * Superadmin passes every check (DESAIN_API.md §1). Everyone else must have an
 * active membership whose role ranks at least as high as the action requires.
 */
export function isAllowed({ role, action, membershipRole }: AuthorizationInput): boolean {
  if (role === "superadmin") return true;

  const minimum = MIN_MEMBERSHIP[action];
  if (minimum === null) return false; // superadmin-only action
  if (membershipRole === null) return false;

  return MEMBERSHIP_RANK[membershipRole] >= MEMBERSHIP_RANK[minimum];
}

/** Explicit matrix, used by tests and by `docs/RENCANA_PENGUJIAN.md` §5.1. */
export function minMembershipFor(action: Action): EventRole | null {
  return MIN_MEMBERSHIP[action];
}
