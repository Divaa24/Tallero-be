import { z } from "zod";

const idParamSchema = z
  .object({
    id: z.coerce.number().int().positive("ID harus berupa bilangan bulat positif"),
  })
  .strict();

export const bookingIdParamSchema = {
  params: idParamSchema,
};

const bookingItemSchema = z
  .object({
    type: z.enum(["SERVICE", "SPAREPART"], {
      required_error: "Tipe item wajib diisi (SERVICE atau SPAREPART)",
    }),
    serviceId: z.coerce.number().int().positive().optional(),
    sparepartId: z.coerce.number().int().positive().optional(),
    quantity: z.coerce
      .number({ required_error: "Kuantitas wajib diisi" })
      .int("Kuantitas harus bilangan bulat")
      .positive("Kuantitas minimal 1")
      .default(1),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.type === "SERVICE") {
      if (!data.serviceId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "serviceId wajib diisi untuk item tipe SERVICE",
          path: ["serviceId"],
        });
      }
      if (data.sparepartId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "sparepartId tidak boleh diisi untuk item tipe SERVICE",
          path: ["sparepartId"],
        });
      }
    }

    if (data.type === "SPAREPART") {
      if (!data.sparepartId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "sparepartId wajib diisi untuk item tipe SPAREPART",
          path: ["sparepartId"],
        });
      }
      if (data.serviceId !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "serviceId tidak boleh diisi untuk item tipe SPAREPART",
          path: ["serviceId"],
        });
      }
    }
  });

export const createBookingSchema = {
  body: z
    .object({
      outletId: z.coerce
        .number({ required_error: "outletId wajib diisi" })
        .int()
        .positive("outletId harus berupa ID valid"),
      vehicleId: z.coerce
        .number({ required_error: "vehicleId wajib diisi" })
        .int()
        .positive("vehicleId harus berupa ID valid"),
      scheduledAt: z
        .string({ required_error: "scheduledAt wajib diisi (ISO 8601)" })
        .trim()
        .datetime({ offset: true, message: "Format scheduledAt harus berupa ISO 8601 valid" }),
      customerNotes: z
        .string()
        .trim()
        .max(500, "Catatan pelanggan maksimal 500 karakter")
        .optional()
        .nullable(),
      items: z
        .array(bookingItemSchema, { required_error: "Daftar items minimal 1 item" })
        .min(1, "Booking minimal harus memilih 1 layanan atau suku cadang")
        .refine(
          (items) => items.some((i) => i.type === "SERVICE"),
          "Minimal satu layanan wajib dipilih"
        ),
    })
    .strict(),
};

export const listBookingsSchema = {
  query: z
    .object({
      page: z.coerce.number().int().positive().optional().default(1),
      limit: z.coerce.number().int().positive().max(100).optional().default(20),
      sort: z.string().trim().optional(),
      status: z
        .enum([
          "PENDING",
          "CHECKED_IN",
          "IN_PROGRESS",
          "WAITING_APPROVAL",
          "READY_FOR_PICKUP",
          "COMPLETED",
          "CANCELLED",
          "NO_SHOW",
        ])
        .optional(),
      date: z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Format filter tanggal harus YYYY-MM-DD")
        .optional(),
      outletId: z.coerce.number().int().positive().optional(),
      search: z.string().trim().min(1).max(100).optional(),
    })
    .strict(),
};

export const cancelBookingSchema = {
  params: idParamSchema,
  body: z
    .object({
      reason: z.string().trim().max(500, "Alasan pembatalan maksimal 500 karakter").optional(),
    })
    .strict()
    .default({}),
};

export const outletAvailabilitySchema = {
  params: idParamSchema,
  query: z
    .object({
      date: z
        .string({ required_error: "Parameter query date wajib diisi (YYYY-MM-DD)" })
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD"),
      serviceIds: z
        .union([
          z.string().transform((str) =>
            str
              .split(",")
              .map((s) => Number(s.trim()))
              .filter((n) => Number.isInteger(n) && n > 0)
          ),
          z.array(z.coerce.number().int().positive()),
        ])
        .optional()
        .default([]),
    })
    .strict(),
};

export const checkInBookingSchema = {
  body: z
    .object({
      qrPayload: z
        .string({ required_error: "qrPayload wajib diisi" })
        .trim()
        .min(1, "qrPayload tidak boleh kosong"),
      odometerKm: z.coerce.number().int().nonnegative("Odometer tidak boleh negatif").optional(),
    })
    .strict(),
};

export const assignMechanicSchema = {
  params: idParamSchema,
  body: z
    .object({
      mechanicId: z.coerce
        .number({ required_error: "mechanicId wajib diisi" })
        .int()
        .positive("mechanicId harus berupa ID valid"),
    })
    .strict(),
};

export const startBookingSchema = {
  params: idParamSchema,
  body: z
    .object({
      mechanicId: z.coerce.number().int().positive().optional(),
    })
    .strict()
    .default({}),
};

export const staffQueueQuerySchema = {
  query: z
    .object({
      outletId: z.coerce.number().int().positive().optional(),
    })
    .strict(),
};

export const addBookingItemSchema = {
  params: idParamSchema,
  body: z
    .object({
      type: z.enum(["SERVICE", "SPAREPART"], {
        required_error: "Tipe item tambahan wajib diisi (SERVICE atau SPAREPART)",
      }),
      serviceId: z.coerce.number().int().positive().optional(),
      sparepartId: z.coerce.number().int().positive().optional(),
      quantity: z.coerce
        .number({ required_error: "Kuantitas wajib diisi" })
        .int("Kuantitas harus bilangan bulat")
        .min(1, "Kuantitas minimal 1")
        .max(99, "Kuantitas maksimal 99")
        .default(1),
      note: z
        .string({ required_error: "Catatan alasan penambahan item wajib diisi" })
        .trim()
        .min(3, "Catatan alasan minimal 3 karakter")
        .max(500, "Catatan alasan maksimal 500 karakter"),
    })
    .strict()
    .superRefine((data, ctx) => {
      if (data.type === "SERVICE") {
        if (!data.serviceId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "serviceId wajib diisi untuk item SERVICE",
            path: ["serviceId"],
          });
        }
        if (data.sparepartId !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "sparepartId tidak boleh diisi untuk item SERVICE",
            path: ["sparepartId"],
          });
        }
      }
      if (data.type === "SPAREPART") {
        if (!data.sparepartId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "sparepartId wajib diisi untuk item SPAREPART",
            path: ["sparepartId"],
          });
        }
        if (data.serviceId !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "serviceId tidak boleh diisi untuk item SPAREPART",
            path: ["serviceId"],
          });
        }
      }
    }),
};

export const deleteBookingItemSchema = {
  params: z
    .object({
      id: z.coerce.number().int().positive(),
      itemId: z.coerce.number().int().positive(),
    })
    .strict(),
};

export const bookingApprovalSchema = {
  params: idParamSchema,
  body: z
    .object({
      decisions: z
        .array(
          z
            .object({
              itemId: z.coerce.number().int().positive(),
              decision: z.enum(["APPROVE", "REJECT"], {
                required_error: "Keputusan harus APPROVE atau REJECT",
              }),
              reason: z.string().trim().max(500).optional(),
            })
            .strict()
        )
        .min(1, "Daftar keputusan minimal 1 item"),
      note: z.string().trim().max(500).optional(),
    })
    .strict(),
};

export const bookingPhotoUploadSchema = {
  params: idParamSchema,
  body: z
    .object({
      type: z.enum(["BEFORE", "AFTER"], {
        required_error: "Tipe foto wajib diisi (BEFORE atau AFTER)",
      }),
      caption: z.string().trim().max(255, "Keterangan foto maksimal 255 karakter").optional(),
    })
    .strict(),
};

export const deleteBookingPhotoSchema = {
  params: z
    .object({
      id: z.coerce.number().int().positive(),
      photoId: z.coerce.number().int().positive(),
    })
    .strict(),
};

export const bookingInspectionSchema = {
  params: idParamSchema,
  body: z
    .object({
      odometerKm: z.coerce.number().int().positive("Odometer harus positif").optional(),
      staffNotes: z
        .string()
        .trim()
        .max(1000, "Catatan inspeksi staf maksimal 1000 karakter")
        .optional(),
    })
    .strict(),
};

export default {
  bookingIdParamSchema,
  createBookingSchema,
  listBookingsSchema,
  cancelBookingSchema,
  outletAvailabilitySchema,
  checkInBookingSchema,
  assignMechanicSchema,
  startBookingSchema,
  staffQueueQuerySchema,
  addBookingItemSchema,
  deleteBookingItemSchema,
  bookingApprovalSchema,
  bookingPhotoUploadSchema,
  deleteBookingPhotoSchema,
  bookingInspectionSchema,
};
