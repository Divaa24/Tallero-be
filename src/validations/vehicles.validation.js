import { z } from "zod";

const PLATE_REGEX = /^[A-Z]{1,2}\d{1,4}[A-Z]{0,3}$/;
const MAX_VEHICLE_YEAR = new Date().getUTCFullYear() + 1;

/**
 * Menormalisasi plat nomor kendaraan Indonesia: uppercase tanpa spasi atau tanda hubung.
 */
export const normalizePlateNumber = (raw) =>
  String(raw ?? "")
    .trim()
    .replace(/[\s-]+/g, "")
    .toUpperCase();

const plateField = z
  .string({ required_error: "Nomor polisi wajib diisi" })
  .transform(normalizePlateNumber)
  .refine((val) => PLATE_REGEX.test(val), {
    message: "Format plat nomor Indonesia tidak valid (contoh: B1234XYZ)",
  });

const vehicleIdParams = z
  .object({
    id: z.coerce.number().int().positive("ID kendaraan harus berupa bilangan bulat positif"),
  })
  .strict();

export const vehicleIdParamSchema = {
  params: vehicleIdParams,
};

export const listVehiclesSchema = {
  query: z
    .object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
      sort: z.string().trim().optional(),
      search: z.string().trim().min(1).max(50).optional(),
      type: z.enum(["CAR", "MOTORCYCLE"]).optional(),
    })
    .strict(),
};

export const vehicleSubListSchema = {
  params: vehicleIdParams,
  query: z
    .object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    })
    .strict(),
};

export const createVehicleSchema = {
  body: z
    .object({
      plateNumber: plateField,
      brand: z.string({ required_error: "Merek kendaraan wajib diisi" }).trim().min(1).max(50),
      model: z.string({ required_error: "Model kendaraan wajib diisi" }).trim().min(1).max(50),
      type: z.enum(["CAR", "MOTORCYCLE"]),
      year: z
        .number({ required_error: "Tahun kendaraan wajib diisi" })
        .int()
        .min(1950, "Tahun kendaraan minimal 1950")
        .max(MAX_VEHICLE_YEAR, `Tahun kendaraan maksimal ${MAX_VEHICLE_YEAR}`),
      color: z.string().trim().min(1).max(30).nullable().optional(),
      lastOdometerKm: z.number().int().min(0, "Odometer tidak boleh negatif").nullable().optional(),
    })
    .strict(),
};

export const updateVehicleSchema = {
  params: vehicleIdParams,
  body: z
    .object({
      plateNumber: plateField.optional(),
      brand: z.string().trim().min(1).max(50).optional(),
      model: z.string().trim().min(1).max(50).optional(),
      type: z.enum(["CAR", "MOTORCYCLE"]).optional(),
      year: z.number().int().min(1950).max(MAX_VEHICLE_YEAR).optional(),
      color: z.string().trim().min(1).max(30).nullable().optional(),
      lastOdometerKm: z.number().int().min(0).nullable().optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
      message: "Minimal satu field kendaraan harus diubah",
    }),
};
