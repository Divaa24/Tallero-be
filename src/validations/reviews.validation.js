// ==============================================================================
// TALLERO AUTO — REVIEWS VALIDATION SCHEMAS (ZOD)
// Sesuai konvensi API AGENTS.md §3 dan aturan review §8
// ==============================================================================

import { z } from "zod";

export const createReviewSchema = z
  .object({
    rating: z
      .number({
        required_error: "Rating wajib diberikan",
        invalid_type_error: "Rating harus berupa angka",
      })
      .int("Rating harus berupa bilangan bulat antara 1 hingga 5")
      .min(1, "Rating minimal adalah 1 bintang")
      .max(5, "Rating maksimal adalah 5 bintang"),
    comment: z.string().trim().max(1000, "Ulasan maksimal 1000 karakter").optional(),
  })
  .strict();

export const outletIdParamSchema = z
  .object({
    id: z.coerce.number().int().positive("ID outlet harus berupa bilangan bulat positif"),
  })
  .strict();

export const reviewIdParamSchema = z
  .object({
    id: z.coerce.number().int().positive("ID ulasan harus berupa bilangan bulat positif"),
  })
  .strict();

export const listReviewsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().positive().max(100).optional().default(20),
  })
  .strict();

export const updateReviewVisibilitySchema = z
  .object({
    isHidden: z.boolean({
      required_error: "Status visibilitas isHidden wajib disertakan",
      invalid_type_error: "Status visibilitas harus bernilai boolean",
    }),
  })
  .strict();

export default {
  createReviewSchema,
  outletIdParamSchema,
  reviewIdParamSchema,
  listReviewsQuerySchema,
  updateReviewVisibilitySchema,
};
