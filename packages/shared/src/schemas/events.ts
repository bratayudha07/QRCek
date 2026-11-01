import { z } from "zod";

/**
 * Runtime schemas for event management (DESAIN_API.md §3).
 *
 * The client sends ISO-8601-ish epoch milliseconds; the Worker stores UTC and
 * only the presentation layer converts to the event timezone.
 */

export const EventStatusSchema = z.enum(["draft", "active", "closed", "archived"]);
export type EventStatus = z.infer<typeof EventStatusSchema>;

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const TimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, "Zona waktu tidak dikenal");

const EventNameSchema = z.string().trim().min(1).max(120);
const EventDescriptionSchema = z.string().trim().max(1_000);
const EventTimeSchema = z.number().int().nonnegative().nullable();

export const EventCreateRequestSchema = z
  .object({
    name: EventNameSchema,
    description: EventDescriptionSchema.nullable().optional(),
    timezone: TimeZoneSchema.default("Asia/Jakarta"),
    startsAt: EventTimeSchema.optional(),
    endsAt: EventTimeSchema.optional(),
    allowManual: z.boolean().default(false),
  })
  .strict()
  .refine(
    (value) =>
      value.startsAt == null || value.endsAt == null || value.endsAt >= value.startsAt,
    { message: "Waktu selesai tidak boleh sebelum waktu mulai", path: ["endsAt"] },
  );

export type EventCreateRequest = z.infer<typeof EventCreateRequestSchema>;

export const EventUpdateRequestSchema = z
  .object({
    name: EventNameSchema.optional(),
    description: EventDescriptionSchema.nullable().optional(),
    timezone: TimeZoneSchema.optional(),
    startsAt: EventTimeSchema.optional(),
    endsAt: EventTimeSchema.optional(),
    allowManual: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Tidak ada perubahan yang dikirim",
  });

export type EventUpdateRequest = z.infer<typeof EventUpdateRequestSchema>;

export const EventStatusRequestSchema = z
  .object({ status: EventStatusSchema })
  .strict();

export type EventStatusRequest = z.infer<typeof EventStatusRequestSchema>;
