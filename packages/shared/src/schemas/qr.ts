import { z } from "zod";

import { EventIdSchema } from "./auth";
import { ParticipantIdSchema } from "./participants";
import { QR_ROTATION_REASON_MAX, QR_ROTATION_REASON_MIN } from "../qr";

/**
 * Runtime schemas for QR Identity routes (DESAIN_API.md §5, ADR-0017).
 *
 * The reason is mandatory because a rotation invalidates every printed card for
 * that participant. Trimming happens before the length check so whitespace does
 * not satisfy the minimum.
 */

export const QrIdentityParamsSchema = z.object({
  eventId: EventIdSchema,
  participantId: ParticipantIdSchema,
});

export type QrIdentityParams = z.infer<typeof QrIdentityParamsSchema>;

export const RotateQrRequestSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(
        QR_ROTATION_REASON_MIN,
        `Alasan rotasi minimal ${QR_ROTATION_REASON_MIN} karakter`,
      )
      .max(
        QR_ROTATION_REASON_MAX,
        `Alasan rotasi maksimal ${QR_ROTATION_REASON_MAX} karakter`,
      ),
    /**
     * Optional optimistic guard for retries. The caller echoes the
     * `rotationCount` it last read; a different value returns 409 instead of
     * revoking a token the previous attempt may already have delivered.
     */
    expectedRotationCount: z.number().int().min(0).optional(),
  })
  .strict();

export type RotateQrRequest = z.infer<typeof RotateQrRequestSchema>;
