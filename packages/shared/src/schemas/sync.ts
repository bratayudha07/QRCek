import { z } from "zod";

/** Runtime schemas for the Sheets sync admin surface (DESAIN_API.md §8). */

/**
 * A spreadsheet id is the opaque value between `/d/` and `/edit` in a Sheets
 * URL. Tab names are user-visible and may contain spaces.
 */
export const SyncConfigRequestSchema = z
  .object({
    spreadsheetId: z
      .string()
      .trim()
      .min(10)
      .max(200)
      .regex(/^[A-Za-z0-9_-]+$/, "ID spreadsheet tidak valid"),
    sheetTab: z.string().trim().min(1).max(100),
    syncEnabled: z.boolean().default(true),
  })
  .strict();

export type SyncConfigRequest = z.infer<typeof SyncConfigRequestSchema>;

export const SyncRunRequestSchema = z
  .object({ limit: z.number().int().min(1).max(50).default(5) })
  .strict()
  .default({ limit: 5 });

export const OutboxListQuerySchema = z.object({
  status: z.enum(["all", "pending", "inflight", "done", "failed", "dead"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type OutboxListQuery = z.infer<typeof OutboxListQuerySchema>;
