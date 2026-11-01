import { z } from "zod";

import { ATTENDANCE_STATUSES } from "../attendance";

/** Runtime schemas for scan, attendance, and corrections (DESAIN_API.md §6). */

export const AttendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);

export const AttendanceIdSchema = z.string().min(1).max(64);

export const ScanRequestSchema = z
  .object({
    /** Opaque payload from the printed label: `absensi:v1:<43-char token>`. */
    qr: z.string().min(1).max(200),
    /** Recorded for clock-skew analysis only; never used for the decision. */
    deviceTs: z.number().int().nonnegative().optional(),
  })
  .strict();

export type ScanRequest = z.infer<typeof ScanRequestSchema>;

export const AttendanceListQuerySchema = z.object({
  query: z.string().trim().max(80).optional(),
  status: z.enum(["all", ...ATTENDANCE_STATUSES]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().max(200).optional(),
});

export type AttendanceListQuery = z.infer<typeof AttendanceListQuerySchema>;

export const AttendanceCorrectionRequestSchema = z
  .object({
    status: AttendanceStatusSchema,
    reason: z.string().trim().min(10).max(500),
    expectedUpdatedAt: z.number().int().positive().optional(),
  })
  .strict();

export type AttendanceCorrectionRequest = z.infer<
  typeof AttendanceCorrectionRequestSchema
>;

export const AttendanceManualRequestSchema = z
  .object({
    participantId: z.string().min(1).max(64),
    status: AttendanceStatusSchema.default("present"),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export type AttendanceManualRequest = z.infer<typeof AttendanceManualRequestSchema>;

/** Staff history is scoped to the caller; eventId may narrow it further. */
export const StaffAttendanceQuerySchema = z.object({
  eventId: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().max(200).optional(),
});

export type StaffAttendanceQuery = z.infer<typeof StaffAttendanceQuerySchema>;
