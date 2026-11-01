import { z } from "zod";

/**
 * Runtime schemas for participant management and CSV import
 * (DESAIN_API.md §5).
 */

export const ParticipantIdSchema = z.string().min(1).max(64);

export const ParticipantStatusSchema = z.enum(["active", "inactive"]);
export type ParticipantStatus = z.infer<typeof ParticipantStatusSchema>;

const OptionalText = (max: number) => z.string().trim().max(max);

export const ParticipantCreateRequestSchema = z
  .object({
    externalRef: OptionalText(64).optional(),
    fullName: z.string().trim().min(1).max(120),
    phone: OptionalText(32).optional(),
    email: OptionalText(254).optional(),
    category: OptionalText(60).optional(),
    note: OptionalText(500).optional(),
  })
  .strict();

export type ParticipantCreateRequest = z.infer<typeof ParticipantCreateRequestSchema>;

export const ParticipantUpdateRequestSchema = z
  .object({
    externalRef: OptionalText(64).nullable().optional(),
    fullName: z.string().trim().min(1).max(120).optional(),
    phone: OptionalText(32).nullable().optional(),
    email: OptionalText(254).nullable().optional(),
    category: OptionalText(60).nullable().optional(),
    note: OptionalText(500).nullable().optional(),
    status: ParticipantStatusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Tidak ada perubahan yang dikirim",
  });

export type ParticipantUpdateRequest = z.infer<typeof ParticipantUpdateRequestSchema>;

export const ParticipantDeleteRequestSchema = z.object({ confirm: z.literal(true) }).strict();

export const ParticipantListQuerySchema = z.object({
  query: z.string().trim().max(80).optional(),
  status: z.enum(["active", "inactive", "all"]).default("active"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().max(200).optional(),
});

export type ParticipantListQuery = z.infer<typeof ParticipantListQuerySchema>;

/** Export and template are text/csv, so they only share the filters. */
export const ParticipantExportQuerySchema = z.object({
  query: z.string().trim().max(80).optional(),
  status: z.enum(["active", "inactive", "all"]).default("active"),
});

/**
 * `dry_run` defaults to `true`: an accidental import request can never write
 * rows. The UI must explicitly confirm with `dry_run=false` after previewing.
 */
export const ParticipantImportQuerySchema = z.object({
  dry_run: z.enum(["true", "false", "1", "0"]).default("true"),
});

export type ParticipantImportQuery = z.infer<typeof ParticipantImportQuerySchema>;

export const ParticipantImportJsonRequestSchema = z
  .object({ csv: z.string().min(1).max(2_000_000) })
  .strict();

export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
/** Free-tier CPU budget: 1,000 rows is the value carried over from Fase 0. */
export const IMPORT_MAX_ROWS = 1_000;
