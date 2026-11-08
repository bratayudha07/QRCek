import { z } from "zod";

import { ActivityIdSchema } from "./activities";
import { ActivitySessionIdSchema } from "./activity-sessions";
import { EventIdSchema } from "./auth";
import { CategoryIdSchema } from "./categories";
import { ParticipantIdSchema } from "./participants";

/**
 * Runtime schemas for entitlement configuration (DESAIN_API.md §6, ADR-0016).
 *
 * The batch limit is 15 rules per request, not 100: one cell needs an upsert and
 * an audit row, and the endpoint also runs a completeness query. That keeps the
 * whole invocation below D1's 50-statement limit even after auth queries.
 */

export const EntitlementStatusSchema = z.enum(["inherit", "allowed", "denied"]);

const ThemeDefaultStatusSchema = z.enum(["allowed", "denied"]);

export const EntitlementDefaultRequestSchema = z
  .object({ status: ThemeDefaultStatusSchema })
  .strict();

export type EntitlementDefaultRequest = z.infer<typeof EntitlementDefaultRequestSchema>;

const CategoryRuleSchema = z
  .object({
    categoryId: CategoryIdSchema,
    status: EntitlementStatusSchema,
  })
  .strict();

export const EntitlementCategoryRulesRequestSchema = z
  .object({
    rules: z
      .array(CategoryRuleSchema)
      .min(1, "Minimal satu aturan")
      .max(15, "Maksimal 15 aturan per permintaan")
      .superRefine((rules, ctx) => {
        const seen = new Set<string>();
        rules.forEach((rule, index) => {
          if (seen.has(rule.categoryId)) {
            ctx.addIssue({
              code: "custom",
              path: [index, "categoryId"],
              message: "Kategori yang sama dikirim lebih dari sekali",
            });
          }
          seen.add(rule.categoryId);
        });
      }),
  })
  .strict();

export type EntitlementCategoryRulesRequest = z.infer<
  typeof EntitlementCategoryRulesRequestSchema
>;

export const EntitlementParticipantRuleRequestSchema = z
  .object({ status: EntitlementStatusSchema })
  .strict();

export type EntitlementParticipantRuleRequest = z.infer<
  typeof EntitlementParticipantRuleRequestSchema
>;

export const EntitlementResolveQuerySchema = z.object({
  participantId: ParticipantIdSchema,
  sessionId: ActivitySessionIdSchema.optional(),
});

export type EntitlementResolveQuery = z.infer<typeof EntitlementResolveQuerySchema>;

export const EntitlementEventParamsSchema = z.object({ eventId: EventIdSchema });
export const EntitlementActivityParamsSchema = z.object({
  eventId: EventIdSchema,
  activityId: ActivityIdSchema,
});
export const EntitlementSessionParamsSchema = z.object({
  eventId: EventIdSchema,
  activityId: ActivityIdSchema,
  sessionId: ActivitySessionIdSchema,
});
export const EntitlementActivityParticipantParamsSchema = z.object({
  eventId: EventIdSchema,
  activityId: ActivityIdSchema,
  participantId: ParticipantIdSchema,
});
export const EntitlementSessionParticipantParamsSchema = z.object({
  eventId: EventIdSchema,
  activityId: ActivityIdSchema,
  sessionId: ActivitySessionIdSchema,
  participantId: ParticipantIdSchema,
});
