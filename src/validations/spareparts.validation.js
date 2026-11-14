import { z } from "zod";

const idParamSchema = z
  .object({
    id: z.coerce.number().int().positive("ID sparepart harus berupa bilangan bulat positif"),
  })
  .strict();

const booleanQueryField = z
  .enum(["true", "false"])
  .transform((val) => val === "true")
  .optional();

const skuField = z
  .string({ required_error: "SKU wajib diisi" })
  .trim()
  .toUpperCase()
  .min(2, "SKU minimal 2 karakter")
  .max(60, "SKU maksimal 60 karakter");

export const sparepartIdParamSchema = {
  params: idParamSchema,
};

export const listSparepartsSchema = {
  query: z
    .object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
      sort: z.string().trim().optional(),
      search: z.string().trim().min(1).max(100).optional(),
      inStock: booleanQueryField,
      isActive: booleanQueryField,
      includeDeleted: booleanQueryField,
    })
    .strict(),
};

export const createSparepartSchema = {
  body: z
    .object({
      sku: skuField,
      name: z.string().trim().min(2, "Nama sparepart minimal 2 karakter").max(150),
      price: z
        .number({ required_error: "Harga wajib diisi" })
        .int("Harga harus bilangan bulat Rupiah")
        .positive("Harga harus lebih dari 0"),
      stock: z
        .number({ required_error: "Stok awal wajib diisi" })
        .int("Stok harus bilangan bulat")
        .min(0, "Stok tidak boleh negatif"),
      unit: z.string().trim().min(1, "Satuan wajib diisi").max(30),
      isActive: z.boolean().optional(),
    })
    .strict(),
};

export const updateSparepartSchema = {
  params: idParamSchema,
  body: z
    .object({
      sku: skuField.optional(),
      name: z.string().trim().min(2).max(150).optional(),
      price: z.number().int("Harga harus bilangan bulat Rupiah").positive().optional(),
      unit: z.string().trim().min(1).max(30).optional(),
      isActive: z.boolean().optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
      message: "Minimal satu field sparepart harus diubah",
    }),
};

export const adjustSparepartStockSchema = {
  params: idParamSchema,
  body: z
    .object({
      delta: z
        .number({ required_error: "Perubahan stok (delta) wajib diisi" })
        .int("Delta stok harus bilangan bulat")
        .refine((val) => val !== 0, "Delta stok tidak boleh nol"),
      reason: z
        .string({ required_error: "Alasan penyesuaian stok wajib diisi" })
        .trim()
        .min(3, "Alasan minimal 3 karakter")
        .max(500, "Alasan maksimal 500 karakter"),
    })
    .strict(),
};
