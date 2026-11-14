// ==============================================================================
// TALLERO AUTO — REPORTS & DASHBOARD VALIDATION SCHEMAS (ZOD)
// Sesuai konvensi API AGENTS.md §3 dan aturan batas laporan §8
// ==============================================================================

import { z } from "zod";
import { DateTime } from "luxon";
import RULES from "../config/rules.js";

const validateDateRange = (data, ctx) => {
  const fromDt = DateTime.fromISO(data.from);
  const toDt = DateTime.fromISO(data.to);

  if (!fromDt.isValid || !toDt.isValid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Format tanggal tidak valid (gunakan YYYY-MM-DD)",
      path: ["from"],
    });
    return;
  }

  if (fromDt > toDt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Tanggal mulai (from) tidak boleh lebih besar dari tanggal akhir (to)",
      path: ["from"],
    });
    return;
  }

  const diffDays = Math.ceil(toDt.diff(fromDt, "days").days);
  if (diffDays > RULES.REPORT_MAX_RANGE_DAYS) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Rentang laporan maksimal adalah ${RULES.REPORT_MAX_RANGE_DAYS} hari (1 tahun)`,
      path: ["to"],
    });
  }
};

export const dashboardQuerySchema = z
  .object({
    outletId: z.coerce.number().int().positive().optional(),
    range: z.enum(["today", "week", "month", "year"]).optional().default("today"),
  })
  .strict();

export const reportsSummaryQuerySchema = z
  .object({
    from: z
      .string({ required_error: "Parameter from wajib diisi" })
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Format from harus YYYY-MM-DD"),
    to: z
      .string({ required_error: "Parameter to wajib diisi" })
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Format to harus YYYY-MM-DD"),
    outletId: z.coerce.number().int().positive().optional(),
  })
  .strict()
  .superRefine(validateDateRange);

export const reportsExportQuerySchema = z
  .object({
    type: z.enum(["revenue", "bookings", "mechanics", "services", "stock"], {
      errorMap: () => ({
        message: "Tipe laporan harus berupa: revenue, bookings, mechanics, services, atau stock",
      }),
    }),
    format: z.enum(["csv", "xlsx", "pdf"], {
      errorMap: () => ({
        message: "Format ekspor harus berupa: csv, xlsx, atau pdf",
      }),
    }),
    from: z
      .string({ required_error: "Parameter from wajib diisi" })
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Format from harus YYYY-MM-DD"),
    to: z
      .string({ required_error: "Parameter to wajib diisi" })
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Format to harus YYYY-MM-DD"),
    outletId: z.coerce.number().int().positive().optional(),
  })
  .strict()
  .superRefine(validateDateRange);

export const mechanicTipsQuerySchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Format from harus YYYY-MM-DD")
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Format to harus YYYY-MM-DD")
      .optional(),
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().positive().max(100).optional().default(20),
  })
  .strict();

export default {
  dashboardQuerySchema,
  reportsSummaryQuerySchema,
  reportsExportQuerySchema,
  mechanicTipsQuerySchema,
};

