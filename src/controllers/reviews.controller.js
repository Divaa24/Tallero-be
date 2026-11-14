// ==============================================================================
// TALLERO AUTO — REVIEWS CONTROLLER
// Controller tipis untuk ulasan pelanggan, rating outlet, dan moderasi admin
// Sesuai aturan arsitektur AGENTS.md §2
// ==============================================================================

import reviewsService from "../services/reviews.service.js";
import { sendSuccess } from "../utils/response.js";

export const createBookingReview = async (req, res) => {
  const bookingId = req.valid.params.id;
  const { rating, comment } = req.valid.body;

  const result = await reviewsService.createBookingReview({
    actor: req.user,
    bookingId,
    rating,
    comment,
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: "Ulasan dan rating berhasil dikirim",
    data: result,
  });
};

export const listOutletReviews = async (req, res) => {
  const outletId = req.valid.params.id;
  const result = await reviewsService.listOutletReviews({
    outletId,
    query: req.valid.query,
  });

  return sendSuccess(res, {
    statusCode: 200,
    data: result.data,
    meta: result.meta,
  });
};

export const listMechanicReviews = async (req, res) => {
  const result = await reviewsService.listMechanicReviews({
    actor: req.user,
    query: req.valid.query,
  });

  return sendSuccess(res, {
    statusCode: 200,
    data: result.data,
    meta: result.meta,
  });
};

export const updateReviewVisibility = async (req, res) => {
  const reviewId = req.valid.params.id;
  const { isHidden } = req.valid.body;

  const result = await reviewsService.updateReviewVisibility({
    actor: req.user,
    reviewId,
    isHidden,
  });

  return sendSuccess(res, {
    statusCode: 200,
    message: `Visibilitas ulasan berhasil ${isHidden ? "disembunyikan" : "ditampilkan kembali"}`,
    data: result,
  });
};

export default {
  createBookingReview,
  listOutletReviews,
  listMechanicReviews,
  updateReviewVisibility,
};
