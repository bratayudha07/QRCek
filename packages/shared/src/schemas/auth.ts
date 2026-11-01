import { z } from "zod";

/**
 * Runtime validation for every auth payload crossing the Worker boundary.
 * TypeScript types alone are not validation (AGENTS.md "Keamanan").
 */

export const RoleSchema = z.enum(["superadmin", "event_admin", "officer"]);
export type Role = z.infer<typeof RoleSchema>;

/** Roles that are scoped to a single event. */
export const EventRoleSchema = z.enum(["event_admin", "officer"]);
export type EventRole = z.infer<typeof EventRoleSchema>;

const LabelSchema = z.string().trim().max(80);

export const ActivateRequestSchema = z
  .object({
    // 128-bit base64url is 22 chars; allow headroom for future formats.
    token: z.string().min(16).max(512),
    label: LabelSchema.optional(),
  })
  .strict();

export const RecoverRequestSchema = z
  .object({
    // "ABCD-EFGH-IJKL-MNOP-QRST" is 24 chars; strip separators before
    // comparing, so the bound is generous.
    recoveryCode: z.string().min(16).max(64),
    label: LabelSchema.optional(),
  })
  .strict();

/**
 * ADR-007: self-service registration. Only a display name is required — there
 * is no email verification in this system, so no email is collected at all.
 * `turnstileToken` is present only when the deployment enabled Turnstile.
 */
export const RegisterRequestSchema = z
  .object({
    displayName: z.string().trim().min(2).max(120),
    label: LabelSchema.optional(),
    turnstileToken: z.string().trim().max(2048).optional(),
  })
  .strict();

export const InviteCreateRequestSchema = z
  .object({
    role: EventRoleSchema,
    invitedName: z.string().trim().min(1).max(120).optional(),
    invitedPhone: z.string().trim().max(32).optional(),
    expiresInHours: z.number().int().min(1).max(168).default(72),
  })
  .strict();

export const SessionIdSchema = z.string().min(1).max(64);
export const EventIdSchema = z.string().min(1).max(64);
export const InviteIdSchema = z.string().min(1).max(64);
export const UserIdSchema = z.string().min(1).max(64);
