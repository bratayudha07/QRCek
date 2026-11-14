import { z } from "zod";

import { ActivityIdSchema } from "./activities";
import { ActivitySessionIdSchema } from "./activity-sessions";
import { UserIdSchema } from "./auth";
import { STAFF_ASSIGNMENT_STATUSES } from "../staff-assignments";

/**
 * Runtime schemas for assignment management (DESAIN_API.md §4, Q6).
 *
 * Changing Aktivitas/Sesi on an existing assignment is deliberately absent:
 * revoking and creating a new row preserves who was assigned to which context.
 * `PATCH` only toggles the Manual Check-in flag.
 */

export const StaffAssignmentStatusSchema = z.enum(STAFF_ASSIGNMENT_STATUSES);

export const StaffAssignmentListQuerySchema = z.object({
  status: z.enum(["active", "revoked", "all"]).default("active"),
});

export type StaffAssignmentListQuery = z.infer<typeof StaffAssignmentListQuerySchema>;

export const StaffAssignmentCreateRequestSchema = z
  .object({
    userId: UserIdSchema,
    activityId: ActivityIdSchema,
    sessionId: ActivitySessionIdSchema.nullable().optional(),
    canManualCheckIn: z.boolean().default(false),
  })
  .strict();

export type StaffAssignmentCreateRequest = z.infer<
  typeof StaffAssignmentCreateRequestSchema
>;

export const StaffAssignmentUpdateRequestSchema = z
  .object({ canManualCheckIn: z.boolean() })
  .strict();

export type StaffAssignmentUpdateRequest = z.infer<
  typeof StaffAssignmentUpdateRequestSchema
>;

export const AssignmentIdSchema = z.string().min(1).max(64);
