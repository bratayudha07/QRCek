import { z } from "zod";

/**
 * Runtime schemas for Aktivitas (DESAIN_API.md §6).
 *
 * An Aktivitas belongs to exactly one Tema (`events`) and carries exactly one
 * transaction type. It is the unit that determines whether scans record
 * attendance or consumption (D-009).
 */

export const ActivityStatusSchema = z.enum(["draft", "active", "completed", "archived"]);
export type ActivityStatus = z.infer<typeof ActivityStatusSchema>;

export const TransactionTypeSchema = z.enum(["attendance", "consumption"]);
export type TransactionType = z.infer<typeof TransactionTypeSchema>;

const ActivityNameSchema = z.string().trim().min(1).max(120);
const ActivityDescriptionSchema = z.string().trim().max(500);
const ActivityLocationSchema = z.string().trim().max(200);
const SortOrderSchema = z.number().int().min(0).max(1_000_000);

export const ActivityCreateRequestSchema = z
  .object({
    name: ActivityNameSchema,
    description: ActivityDescriptionSchema.nullable().optional(),
    transactionType: TransactionTypeSchema,
    location: ActivityLocationSchema.nullable().optional(),
    sortOrder: SortOrderSchema.default(0),
  })
  .strict();

export type ActivityCreateRequest = z.infer<typeof ActivityCreateRequestSchema>;

/**
 * `transactionType` is deliberately absent: changing an activity from attendance
 * to consumption after transactions exist would silently reinterpret history.
 * A wrong type is corrected by creating another activity, not by patching it.
 */
export const ActivityUpdateRequestSchema = z
  .object({
    name: ActivityNameSchema.optional(),
    description: ActivityDescriptionSchema.nullable().optional(),
    location: ActivityLocationSchema.nullable().optional(),
    sortOrder: SortOrderSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Tidak ada perubahan yang dikirim",
  });

export type ActivityUpdateRequest = z.infer<typeof ActivityUpdateRequestSchema>;

export const ActivityStatusRequestSchema = z
  .object({ status: ActivityStatusSchema })
  .strict();

export type ActivityStatusRequest = z.infer<typeof ActivityStatusRequestSchema>;

export const ActivityIdSchema = z.string().min(1).max(64);
