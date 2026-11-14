import { z } from "zod";

export const listAuditLogsSchema = {
  query: z
    .object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
      sort: z.string().trim().optional(),
      entity: z.string().trim().min(1).max(60).optional(),
      entityId: z.string().trim().min(1).max(60).optional(),
      action: z.string().trim().min(1).max(80).optional(),
      actorId: z.coerce.number().int().positive().optional(),
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
    })
    .strict(),
};
