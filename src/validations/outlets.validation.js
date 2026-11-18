import { DateTime } from "luxon";
import { z } from "zod";
import { BadRequestError } from "../utils/errors.js";

const TIME_HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_YYYYMMDD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const parseTimeToMinutes = (hhmm) => {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return hours * 60 + minutes;
};

/**
 * Memastikan openTime < closeTime dan slotMinutes membagi habis rentang jam buka outlet.
 */
export const assertValidOutletSchedule = ({ openTime, closeTime, slotMinutes }) => {
  const openMin = parseTimeToMinutes(openTime);
  const closeMin = parseTimeToMinutes(closeTime);

  if (openMin >= closeMin) {
    throw new BadRequestError(
      "Jam buka (openTime) harus lebih awal daripada jam tutup (closeTime)",
      "INVALID_OUTLET_SCHEDULE"
    );
  }

  const totalOpenMinutes = closeMin - openMin;
  if (totalOpenMinutes < slotMinutes || totalOpenMinutes % slotMinutes !== 0) {
    throw new BadRequestError(
      "slotMinutes harus membagi habis rentang jam operasional (closeTime - openTime)",
      "INVALID_OUTLET_SCHEDULE"
    );
  }
};

const outletIdParams = z
  .object({
    id: z.coerce.number().int().positive("ID outlet harus berupa bilangan bulat positif"),
  })
  .strict();

const booleanQueryField = z
  .enum(["true", "false"])
  .transform((val) => val === "true")
  .optional();

const timeField = z.string().trim().regex(TIME_HHMM_REGEX, "Format jam harus HH:mm (24 jam)");

const openDaysField = z
  .array(z.number().int().min(1, "Hari ISO 1-7").max(7, "Hari ISO 1-7"))
  .min(1, "Minimal 1 hari buka harus dipilih")
  .refine((days) => new Set(days).size === days.length, {
    message: "Hari buka tidak boleh duplikat",
  });

export const listPublicOutletsSchema = {
  query: z
    .object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
      sort: z.string().trim().optional(),
      search: z.string().trim().min(1).max(100).optional(),
    })
    .strict(),
};

export const listAdminOutletsSchema = {
  query: z
    .object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
      sort: z.string().trim().optional(),
      search: z.string().trim().min(1).max(100).optional(),
      isActive: booleanQueryField,
      includeDeleted: booleanQueryField,
    })
    .strict(),
};

export const outletIdParamSchema = {
  params: outletIdParams,
};

export const createOutletSchema = {
  body: z
    .object({
      name: z.string().trim().min(2, "Nama outlet minimal 2 karakter").max(100),
      address: z.string().trim().min(5, "Alamat outlet minimal 5 karakter").max(500),
      phone: z.string().trim().min(6).max(30).nullable().optional(),
      managerName: z.string().trim().min(2).max(100).nullable().optional(),
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      openDays: openDaysField,
      openTime: timeField,
      closeTime: timeField,
      slotMinutes: z.number().int().min(15, "Durasi slot minimal 15 menit").max(480),
      slotCapacity: z.number().int().min(1, "Kapasitas slot minimal 1").max(100),
      timezone: z.string().trim().min(3).max(50).optional(),
      isActive: z.boolean().optional(),
    })
    .strict(),
};

export const updateOutletSchema = {
  params: outletIdParams,
  body: z
    .object({
      name: z.string().trim().min(2).max(100).optional(),
      address: z.string().trim().min(5).max(500).optional(),
      phone: z.string().trim().min(6).max(30).nullable().optional(),
      managerName: z.string().trim().min(2).max(100).nullable().optional(),
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
      openDays: openDaysField.optional(),
      openTime: timeField.optional(),
      closeTime: timeField.optional(),
      slotMinutes: z.number().int().min(15).max(480).optional(),
      slotCapacity: z.number().int().min(1).max(100).optional(),
      timezone: z.string().trim().min(3).max(50).optional(),
      isActive: z.boolean().optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
      message: "Minimal satu field outlet harus diubah",
    }),
};

export const createOutletClosureSchema = {
  params: outletIdParams,
  body: z
    .object({
      date: z
        .string()
        .trim()
        .regex(DATE_YYYYMMDD_REGEX, "Format tanggal libur harus YYYY-MM-DD")
        .refine((val) => DateTime.fromISO(val, { zone: "utc" }).isValid, {
          message: "Tanggal kalender tidak valid",
        }),
      reason: z.string().trim().min(3, "Alasan libur minimal 3 karakter").max(255),
    })
    .strict(),
};

export const deleteOutletClosureSchema = {
  params: z
    .object({
      id: z.coerce.number().int().positive(),
      closureId: z.coerce.number().int().positive(),
    })
    .strict(),
};
