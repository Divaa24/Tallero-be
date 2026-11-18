import { z } from "zod";

export const outletAvailabilitySchema = {
  params: z.object({ id: z.coerce.number().int().positive() }).strict(),
  query: z
    .object({
      date: z.iso.date("Tanggal harus valid dengan format YYYY-MM-DD"),
      serviceIds: z
        .preprocess(
          (value) =>
            typeof value === "string"
              ? value.split(",")
              : typeof value === "number"
                ? [value]
                : value,
          z.array(z.coerce.number().int().positive()).max(100)
        )
        .optional()
        .default([]),
    })
    .strict(),
};

export default { outletAvailabilitySchema };
