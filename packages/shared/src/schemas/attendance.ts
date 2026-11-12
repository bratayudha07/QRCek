import { z } from "zod";

import { ATTENDANCE_STATUSES } from "../attendance";

/** Runtime schemas for scan, transactions, manual entry, and corrections. */

export const AttendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);

export const AttendanceIdSchema = z.string().min(1).max(64);

export const TransactionIdSchema = z.string().min(1).max(64);

const ContextIdSchema = z.string().min(1).max(64);

export const ScanRequestSchema = z
  .object({
    /** Opaque payload from the printed label: `absensi:v1:<43-char token>`. */
    qr: z.string().min(1).max(200),
    /** Explicit Aktivitas context; omitted only when the Tema has one active one. */
    activityId: ContextIdSchema.optional(),
    /** Required when the Aktivitas owns at least one Sesi (FR-185). */
    sessionId: ContextIdSchema.optional(),
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

/** Adjustment fields allowed by ADR-0020; identity and provenance are absent. */
export const AdjustmentRequestSchema = z
  .object({
    occurredAt: z.number().int().positive().optional(),
    note: z.string().trim().max(500).nullable().optional(),
    status: AttendanceStatusSchema.optional(),
    reason: z.string().trim().min(3).max(500),
    expectedUpdatedAt: z.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.occurredAt !== undefined ||
      value.note !== undefined ||
      value.status !== undefined,
    { message: "Tidak ada perubahan yang dikirim" },
  );

export type AdjustmentRequest = z.infer<typeof AdjustmentRequestSchema>;

export const ReversalRequestSchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    expectedUpdatedAt: z.number().int().positive().optional(),
  })
  .strict();

export type ReversalRequest = z.infer<typeof ReversalRequestSchema>;

export const AttendanceManualRequestSchema = z
  .object({
    participantId: ContextIdSchema,
    activityId: ContextIdSchema.optional(),
    sessionId: ContextIdSchema.optional(),
    status: AttendanceStatusSchema.default("present"),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export type AttendanceManualRequest = z.infer<typeof AttendanceManualRequestSchema>;

export const TransactionListQuerySchema = z.object({
  activityId: ContextIdSchema.optional(),
  sessionId: ContextIdSchema.optional(),
  type: z.enum(["attendance", "consumption"]).optional(),
  status: z.enum(["all", ...ATTENDANCE_STATUSES]).default("all"),
  effective: z.enum(["true", "false", "all"]).default("true"),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().max(200).optional(),
});

export type TransactionListQuery = z.infer<typeof TransactionListQuerySchema>;

/** Staff history is scoped to the caller; eventId may narrow it further. */
export const StaffAttendanceQuerySchema = z.object({
  eventId: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().max(200).optional(),
});

export type StaffAttendanceQuery = z.infer<typeof StaffAttendanceQuerySchema>;
