import { z } from "zod";

import { ActivityIdSchema } from "./activities";
import { ActivitySessionIdSchema } from "./activity-sessions";
import { EventIdSchema } from "./auth";
import { CategoryIdSchema } from "./categories";
import { ParticipantIdSchema } from "./participants";

/**
 * Runtime schemas for consumption quota configuration and Manual Entry (Q7).
 *
 * The batch limit matches the entitlement endpoints: every rule needs an upsert
 * and an audit row, and the endpoint also reads existing rows. 15 rules keeps a
 * whole invocation far below D1's 50-statement ceiling.
 */

/** A quota is a non-negative integer; `0` is a valid "never allowed" value. */
export const ConsumptionQuotaValueSchema = z.number().int().min(0).max(100_000);

export const ConsumptionQuotaDefaultRequestSchema = z
  .object({ quota: ConsumptionQuotaValueSchema })
  .strict();

export type ConsumptionQuotaDefaultRequest = z.infer<
  typeof ConsumptionQuotaDefaultRequestSchema
>;

/**
 * `quota: null` removes the override for that cell. Without it an override could
 * never be undone from the API, because the bulk endpoints only upsert.
 */
const CategoryQuotaRuleSchema = z
  .object({
    categoryId: CategoryIdSchema,
    quota: ConsumptionQuotaValueSchema.nullable(),
  })
  .strict();

export const ConsumptionCategoryQuotaRulesRequestSchema = z
  .object({
    rules: z
      .array(CategoryQuotaRuleSchema)
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

export type ConsumptionCategoryQuotaRulesRequest = z.infer<
  typeof ConsumptionCategoryQuotaRulesRequestSchema
>;

const ParticipantQuotaRuleSchema = z
  .object({
    participantId: ParticipantIdSchema,
    quota: ConsumptionQuotaValueSchema.nullable(),
  })
  .strict();

export const ConsumptionParticipantQuotaRulesRequestSchema = z
  .object({
    rules: z
      .array(ParticipantQuotaRuleSchema)
      .min(1, "Minimal satu aturan")
      .max(15, "Maksimal 15 aturan per permintaan")
      .superRefine((rules, ctx) => {
        const seen = new Set<string>();
        rules.forEach((rule, index) => {
          if (seen.has(rule.participantId)) {
            ctx.addIssue({
              code: "custom",
              path: [index, "participantId"],
              message: "Peserta yang sama dikirim lebih dari sekali",
            });
          }
          seen.add(rule.participantId);
        });
      }),
  })
  .strict();

export type ConsumptionParticipantQuotaRulesRequest = z.infer<
  typeof ConsumptionParticipantQuotaRulesRequestSchema
>;

/**
 * Manual Entry for Consumption (A5). No `status`: a Consumption transaction has
 * none, and the database rejects one. `activityId` is optional at the schema
 * level so the route can answer a missing Aktivitas with a business rule
 * (`context_mismatch`) instead of a generic validation error; it never guesses
 * one, because guessing would spend a quota on the wrong Aktivitas.
 */
export const ConsumptionManualRequestSchema = z
  .object({
    participantId: ParticipantIdSchema,
    activityId: ActivityIdSchema.optional(),
    sessionId: ActivitySessionIdSchema.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export type ConsumptionManualRequest = z.infer<typeof ConsumptionManualRequestSchema>;

export const ConsumptionEventParamsSchema = z.object({ eventId: EventIdSchema });

export const ConsumptionActivityParamsSchema = z.object({
  eventId: EventIdSchema,
  activityId: ActivityIdSchema,
});
