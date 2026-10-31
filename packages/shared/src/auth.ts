import type { EventRole, Role } from "./schemas/auth";

/** Response contracts for the auth surface (DESAIN_API.md §2, §4). */

export interface UserSummary {
  id: string;
  displayName: string;
  role: Role;
}

export interface MembershipSummary {
  eventId: string;
  eventName: string;
  role: EventRole;
}

/** `GET /api/auth/me` */
export interface MePayload {
  user: UserSummary;
  memberships: MembershipSummary[];
}

/** `POST /api/auth/activate` and `POST /api/auth/recover` */
export interface ActivatePayload {
  user: UserSummary;
  memberships: MembershipSummary[];
  /** Shown exactly once. Never returned by `GET /api/auth/me`. */
  recoveryCode: string;
}

/** `GET /api/auth/sessions` */
export interface SessionSummary {
  id: string;
  label: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  current: boolean;
}

export interface SessionListPayload {
  sessions: SessionSummary[];
}

/** `POST /api/events/:id/invites` */
export interface InviteCreatedPayload {
  inviteId: string;
  /** Shown exactly once; only the hash is stored. */
  token: string;
  /** Use the fragment (`#t=`) so the token never lands in access logs. */
  activatePath: string;
  expiresAt: number;
}

/** `GET /api/events/:id/invites` */
export interface InviteSummary {
  id: string;
  role: EventRole;
  invitedName: string | null;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  status: "pending" | "used" | "expired";
}

export interface InviteListPayload {
  invites: InviteSummary[];
}

/** `POST /api/auth/recovery-code` */
export interface RecoveryCodePayload {
  /** Shown exactly once; older codes stop working immediately. */
  recoveryCode: string;
}

/** `POST /api/auth/logout` */
export interface LogoutPayload {
  revoked: true;
}

/** `GET /api/events/:id/members` */
export interface MemberSummary {
  userId: string;
  displayName: string;
  role: EventRole;
  createdAt: number;
}

export interface MemberListPayload {
  members: MemberSummary[];
}
