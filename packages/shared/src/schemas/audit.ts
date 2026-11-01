import { z } from "zod";

export const AuditListQuerySchema = z.object({
  action: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().trim().max(200).optional(),
});

export type AuditListQuery = z.infer<typeof AuditListQuerySchema>;
