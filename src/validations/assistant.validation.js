// ==============================================================================
// TALLERO AUTO — ASSISTANT VALIDATION SCHEMAS (ZOD)
// Skema diskriminatif per-intent tanpa input teks bebas / tanpa LLM (AGENTS.md §8)
// ==============================================================================

import { z } from "zod";

const checkSlotSchema = z
  .object({
    intent: z.literal("CHECK_SLOT"),
    params: z
      .object({
        outletId: z.coerce.number().int().positive("ID outlet wajib disertakan"),
        date: z
          .string({ required_error: "Tanggal wajib diisi" })
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD"),
        serviceIds: z.array(z.coerce.number().int().positive()).optional().default([]),
      })
      .strict(),
  })
  .strict();

const outletOpenStatusSchema = z
  .object({
    intent: z.literal("OUTLET_OPEN_STATUS"),
    params: z
      .object({
        outletId: z.coerce.number().int().positive("ID outlet wajib disertakan"),
      })
      .strict(),
  })
  .strict();

const myBookingStatusSchema = z
  .object({
    intent: z.literal("MY_BOOKING_STATUS"),
    params: z.object({}).strict().optional(),
  })
  .strict();

const servicePriceListSchema = z
  .object({
    intent: z.literal("SERVICE_PRICE_LIST"),
    params: z
      .object({
        categoryId: z.coerce.number().int().positive().optional(),
        vehicleType: z.enum(["CAR", "MOTORCYCLE"]).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const myNextServiceSchema = z
  .object({
    intent: z.literal("MY_NEXT_SERVICE"),
    params: z
      .object({
        vehicleId: z.coerce.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const assistantQuerySchema = z.discriminatedUnion("intent", [
  checkSlotSchema,
  outletOpenStatusSchema,
  myBookingStatusSchema,
  servicePriceListSchema,
  myNextServiceSchema,
]);

export default {
  assistantQuerySchema,
};
