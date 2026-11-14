import { z } from "zod";

const idParamSchema = z
  .object({
    id: z.coerce.number().int().positive("ID harus berupa bilangan bulat positif"),
  })
  .strict();

const booleanQueryField = z
  .enum(["true", "false"])
  .transform((val) => val === "true")
  .optional();

export const catalogIdParamSchema = {
  params: idParamSchema,
};

export const listCategoriesSchema = {
  query: z
    .object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
      sort: z.string().trim().optional(),
      search: z.string().trim().min(1).max(100).optional(),
      includeDeleted: booleanQueryField,
    })
    .strict(),
};

export const createCategorySchema = {
  body: z
    .object({
      name: z.string().trim().min(2, "Nama kategori minimal 2 karakter").max(100),
    })
    .strict(),
};

export const updateCategorySchema = {
  params: idParamSchema,
  body: z
    .object({
      name: z.string().trim().min(2, "Nama kategori minimal 2 karakter").max(100),
    })
    .strict(),
};

export const listPublicServicesSchema = {
  query: z
    .object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
      sort: z.string().trim().optional(),
      categoryId: z.coerce.number().int().positive().optional(),
      vehicleType: z.enum(["CAR", "MOTORCYCLE"]).optional(),
      search: z.string().trim().min(1).max(100).optional(),
    })
    .strict(),
};

export const listAdminServicesSchema = {
  query: z
    .object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
      sort: z.string().trim().optional(),
      categoryId: z.coerce.number().int().positive().optional(),
      vehicleType: z.enum(["CAR", "MOTORCYCLE"]).optional(),
      isActive: booleanQueryField,
      includeDeleted: booleanQueryField,
      search: z.string().trim().min(1).max(100).optional(),
    })
    .strict(),
};

export const createServiceSchema = {
  body: z
    .object({
      categoryId: z.coerce.number().int().positive(),
      name: z.string().trim().min(2, "Nama layanan minimal 2 karakter").max(100),
      description: z.string().trim().max(1000).nullable().optional(),
      price: z
        .number({ required_error: "Harga wajib diisi" })
        .int("Harga harus bilangan bulat Rupiah")
        .positive("Harga harus lebih dari 0"),
      estimatedMinutes: z
        .number({ required_error: "Estimasi durasi wajib diisi" })
        .int()
        .positive("Estimasi durasi minimal 1 menit")
        .max(1440),
      vehicleType: z.enum(["CAR", "MOTORCYCLE"]).nullable().optional(),
      reminderIntervalDays: z.number().int().positive().max(3650).nullable().optional(),
      reminderIntervalKm: z.number().int().positive().max(500000).nullable().optional(),
      isActive: z.boolean().optional(),
    })
    .strict(),
};

export const updateServiceSchema = {
  params: idParamSchema,
  body: z
    .object({
      categoryId: z.coerce.number().int().positive().optional(),
      name: z.string().trim().min(2).max(100).optional(),
      description: z.string().trim().max(1000).nullable().optional(),
      price: z.number().int("Harga harus bilangan bulat Rupiah").positive().optional(),
      estimatedMinutes: z.number().int().positive().max(1440).optional(),
      vehicleType: z.enum(["CAR", "MOTORCYCLE"]).nullable().optional(),
      reminderIntervalDays: z.number().int().positive().max(3650).nullable().optional(),
      reminderIntervalKm: z.number().int().positive().max(500000).nullable().optional(),
      isActive: z.boolean().optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
      message: "Minimal satu field layanan harus diubah",
    }),
};
