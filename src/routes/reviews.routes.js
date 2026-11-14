// ==============================================================================
// TALLERO AUTO — ADMIN REVIEWS ROUTER
// Sesuai konvensi API AGENTS.md §2 & §9
// ==============================================================================

import { Router } from "express";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validate } from "../middlewares/validate.js";
import reviewsController from "../controllers/reviews.controller.js";
import {
  reviewIdParamSchema,
  updateReviewVisibilitySchema,
} from "../validations/reviews.validation.js";

export const adminReviewsRouter = Router();

adminReviewsRouter.use(authenticate, authorize("ADMIN"));

/**
 * PATCH /api/v1/admin/reviews/:id/visibility
 * Admin menyembunyikan / menampilkan kembali ulasan publik
 */
adminReviewsRouter.patch(
  "/:id/visibility",
  validate(reviewIdParamSchema, "params"),
  validate(updateReviewVisibilitySchema, "body"),
  reviewsController.updateReviewVisibility
);

export default adminReviewsRouter;
