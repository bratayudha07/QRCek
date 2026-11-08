import { z } from "zod";

/**
 * Runtime schemas for Sesi (DESAIN_API.md §6).
 *
 * Sesi is a sub-scope inside an Aktivitas. Its status is never inferred from
 * `startsAt`/`endsAt`: every change goes through an explicit endpoint (FR-187).
 * Archive is `archivedAt`, not a status value (FR-206, BR-078).
 */

export const SessionStatusSchema = z.enum([
  "scheduled",
  "in_progress",
  "completed",
  "disabled",
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

const SessionNameSchema = z.string().trim().min(1).max(120);
const SessionLocationSchema = z.string().trim().max(200);
const SessionTimeSchema = z.number().int().positive().nullable();

function endsNotBeforeStart(value: {
  startsAt?: number | null;
  endsAt?: number | null;
}): boolean {
  return value.startsAt == null || value.endsAt == null || value.endsAt >= value.startsAt;
}

const timeOrderMessage = {
  message: "Waktu selesai tidak boleh sebelum waktu mulai",
  path: ["endsAt"],
};

export const ActivitySessionCreateRequestSchema = z
  .object({
    name: SessionNameSchema,
    location: SessionLocationSchema.nullable().optional(),
    startsAt: SessionTimeSchema.optional(),
    endsAt: SessionTimeSchema.optional(),
  })
  .strict()
  .refine(endsNotBeforeStart, timeOrderMessage);

export type ActivitySessionCreateRequest = z.infer<
  typeof ActivitySessionCreateRequestSchema
>;

export const ActivitySessionUpdateRequestSchema = z
  .object({
    name: SessionNameSchema.optional(),
    location: SessionLocationSchema.nullable().optional(),
    startsAt: SessionTimeSchema.optional(),
    endsAt: SessionTimeSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Tidak ada perubahan yang dikirim",
  })
  .refine(endsNotBeforeStart, timeOrderMessage);

export type ActivitySessionUpdateRequest = z.infer<
  typeof ActivitySessionUpdateRequestSchema
>;

export const ActivitySessionStatusRequestSchema = z
  .object({ status: SessionStatusSchema })
  .strict();

export type ActivitySessionStatusRequest = z.infer<
  typeof ActivitySessionStatusRequestSchema
>;

export const ActivitySessionIdSchema = z.string().min(1).max(64);
