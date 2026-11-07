import { z } from "zod";

/**
 * Runtime schemas for participant categories (DESAIN_API.md §5, ADR-0014).
 *
 * A category belongs to one Tema. It is archive-only: no endpoint deletes one,
 * because participants keep pointing at it for history (AC-008).
 */

export const CategoryIdSchema = z.string().min(1).max(64);

export const CategoryStatusSchema = z.enum(["active", "archived"]);
export type CategoryStatus = z.infer<typeof CategoryStatusSchema>;

const CategoryNameSchema = z.string().trim().min(1).max(60);
const CategoryDescriptionSchema = z.string().trim().max(200);
const SortOrderSchema = z.number().int().min(0).max(1_000_000);

export const CategoryCreateRequestSchema = z
  .object({
    name: CategoryNameSchema,
    description: CategoryDescriptionSchema.nullable().optional(),
    sortOrder: SortOrderSchema.default(0),
  })
  .strict();

export type CategoryCreateRequest = z.infer<typeof CategoryCreateRequestSchema>;

export const CategoryUpdateRequestSchema = z
  .object({
    name: CategoryNameSchema.optional(),
    description: CategoryDescriptionSchema.nullable().optional(),
    sortOrder: SortOrderSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Tidak ada perubahan yang dikirim",
  });

export type CategoryUpdateRequest = z.infer<typeof CategoryUpdateRequestSchema>;

export const CategoryStatusRequestSchema = z
  .object({ status: CategoryStatusSchema })
  .strict();

export type CategoryStatusRequest = z.infer<typeof CategoryStatusRequestSchema>;

export const CategoryListQuerySchema = z.object({
  status: z.enum(["active", "archived", "all"]).default("active"),
});

export type CategoryListQuery = z.infer<typeof CategoryListQuerySchema>;
