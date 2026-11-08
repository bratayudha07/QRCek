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
  | "category:read"
  | "category:write"
  | "custom_field:read"
  | "custom_field:write"
  | "entitlement:read"
  | "entitlement:write"
  | "qr:print"
  | "scan"
  | "recap:read"
  | "attendance:correct"
  | "audit:read"
  | "sync:configure"
  | "admin:usage";

/**
 * Minimum event membership needed for a non-superadmin to perform an action on
 * that event. `null` means "no event membership can grant it" (superadmin only,
 * unless the action is listed in `MIN_GLOBAL_ROLE`).
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
  "category:read": "officer",
  "category:write": "event_admin",
  "custom_field:read": "officer",
  "custom_field:write": "event_admin",
  // Officers may read the matrix/resolver preview; only Admins configure it.
  "entitlement:read": "officer",
  "entitlement:write": "event_admin",
  "qr:print": "event_admin",
  scan: "officer",
  "recap:read": "officer",
  "attendance:correct": "event_admin",
  "audit:read": "event_admin",
  "sync:configure": "event_admin",
  // Cross-tenant counters: no membership can grant them.
  "admin:usage": null,
};

export const ACTIONS: readonly Action[] = Object.keys(MIN_MEMBERSHIP) as Action[];

const MEMBERSHIP_RANK: Record<EventRole, number> = {
  officer: 1,
  event_admin: 2,
};

const ROLE_RANK: Record<Role, number> = {
  officer: 1,
  event_admin: 2,
  superadmin: 3,
};

/**
 * Actions a non-superadmin may perform without any event membership (ADR-007).
 *
 * Only *creation of a new resource* belongs here: the caller becomes the owner
 * of what it creates, so no existing event's data is exposed. Reading or
 * mutating someone else's event still needs a membership.
 */
const MIN_GLOBAL_ROLE: Partial<Record<Action, Role>> = {
  "event:create": "event_admin",
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

  // A global action may be granted by `users.role` alone (event creation).
  const globalMinimum = MIN_GLOBAL_ROLE[action];
  if (globalMinimum !== undefined && ROLE_RANK[role] >= ROLE_RANK[globalMinimum]) return true;

  const minimum = MIN_MEMBERSHIP[action];
  if (minimum === null) return false; // superadmin-only action
  if (membershipRole === null) return false;

  return MEMBERSHIP_RANK[membershipRole] >= MEMBERSHIP_RANK[minimum];
}

/** Explicit matrix, used by tests and by `docs/RENCANA_PENGUJIAN.md` §5.1. */
export function minMembershipFor(action: Action): EventRole | null {
  return MIN_MEMBERSHIP[action];
}
