// ==============================================================================
// TALLERO AUTO — REVIEWS SERVICE
// Mengelola ulasan pelanggan, rating publik outlet, dan performa staf mekanik
// Sesuai aturan review AGENTS.md §8 (hanya COMPLETED, 30 hari, anonim publik)
// ==============================================================================

import prisma from "../config/prisma.js";
import RULES from "../config/rules.js";
import { notify } from "./notifications.service.js";
import { parsePagination, buildPaginationMeta } from "../utils/pagination.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  BusinessRuleError,
} from "../utils/errors.js";

/**
 * Format nama pelanggan menjadi nama depan saja untuk menjaga privasi pada ulasan publik
 */
const anonymizeCustomerName = (fullName) => {
  if (!fullName) return "Pelanggan";
  const firstName = fullName.trim().split(" ")[0];
  return firstName;
};

/**
 * POST /bookings/:id/review
 * Memberikan ulasan dan rating pada booking yang telah selesai (COMPLETED)
 */
export const createBookingReview = async ({ actor, bookingId, rating, comment }) => {
  if (actor.role !== "CUSTOMER") {
    throw new ForbiddenError("Hanya pelanggan yang dapat memberikan ulasan servis", "FORBIDDEN");
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      review: true,
      outlet: { select: { id: true, name: true } },
    },
  });

  if (!booking || booking.customerId !== actor.id) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  // Guard status: hanya booking COMPLETED
  if (booking.status !== "COMPLETED") {
    throw new ConflictError(
      `Ulasan hanya dapat diberikan setelah pengerjaan booking selesai (COMPLETED). Status saat ini: ${booking.status}`,
      "INVALID_BOOKING_STATUS"
    );
  }

  // Guard ulasan ganda
  if (booking.review) {
    throw new ConflictError("Booking ini sudah pernah diulas", "REVIEW_ALREADY_EXISTS");
  }

  // Guard batas jendela waktu ulasan (30 hari setelah completedAt)
  const referenceDate = booking.completedAt || booking.readyAt || booking.updatedAt;
  const elapsedDays = (Date.now() - new Date(referenceDate).getTime()) / (1000 * 60 * 60 * 24);
  if (elapsedDays > RULES.REVIEW_WINDOW_DAYS) {
    throw new BusinessRuleError(
      `Batas waktu pemberian ulasan telah kedaluwarsa (${RULES.REVIEW_WINDOW_DAYS} hari setelah servis)`,
      "REVIEW_WINDOW_EXPIRED"
    );
  }

  if (rating < 1 || rating > 5) {
    throw new BadRequestError("Rating harus berada di antara 1 hingga 5 bintang", "INVALID_RATING");
  }

  const review = await prisma.review.create({
    data: {
      bookingId: booking.id,
      customerId: actor.id,
      outletId: booking.outletId,
      mechanicId: booking.mechanicId,
      rating,
      comment: comment || null,
      isHidden: false,
    },
    include: {
      customer: { select: { id: true, name: true } },
    },
  });

  // Notifikasi mekanik penangan jika ada
  if (booking.mechanicId) {
    try {
      await notify(booking.mechanicId, {
        type: "SYSTEM",
        title: "Ulasan Baru Diterima",
        body: `Pelanggan memberikan rating ${rating} bintang untuk servis ${booking.code}.`,
        data: { bookingId: booking.id, reviewId: review.id },
      });
    } catch {
      // Best effort notification
    }
  }

  return {
    ...review,
    customer: {
      id: review.customer.id,
      name: anonymizeCustomerName(review.customer.name),
    },
  };
};

/**
 * GET /outlets/:id/reviews
 * Mengambil ulasan publik untuk suatu outlet (anonim nama depan, tanpa ulasan tersembunyi)
 */
export const listOutletReviews = async ({ outletId, query }) => {
  const { page, limit, skip } = parsePagination(query);

  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { id: true, name: true },
  });

  if (!outlet) {
    throw new NotFoundError("Outlet tidak ditemukan", "OUTLET_NOT_FOUND");
  }

  const where = {
    outletId,
    isHidden: false,
  };

  const [reviews, total, aggregate] = await Promise.all([
    prisma.review.findMany({
      where,
      select: {
        id: true,
        bookingId: true,
        rating: true,
        comment: true,
        createdAt: true,
        customer: { select: { id: true, name: true } },
        mechanic: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.review.count({ where }),
    prisma.review.aggregate({
      where,
      _avg: { rating: true },
    }),
  ]);

  const sanitizedReviews = reviews.map((r) => ({
    id: r.id,
    bookingId: r.bookingId,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt,
    customerName: anonymizeCustomerName(r.customer?.name),
    mechanicName: r.mechanic?.name || null,
  }));

  const rawAvg = aggregate._avg.rating || 0;
  const averageRating = Math.round(rawAvg * 10) / 10;

  return {
    data: sanitizedReviews,
    meta: {
      ...buildPaginationMeta({ page, limit, total }),
      averageRating,
      totalReviews: total,
    },
  };
};

/**
 * GET /staff/me/reviews
 * Mekanik melihat seluruh ulasan dan rating performa dirinya
 */
export const listMechanicReviews = async ({ actor, query }) => {
  if (actor.role !== "MECHANIC") {
    throw new ForbiddenError("Hanya staf mekanik yang dapat mengakses rute ini", "FORBIDDEN");
  }

  const { page, limit, skip } = parsePagination(query);

  const where = {
    mechanicId: actor.id,
    isHidden: false,
  };

  const [reviews, total, aggregate] = await Promise.all([
    prisma.review.findMany({
      where,
      select: {
        id: true,
        bookingId: true,
        rating: true,
        comment: true,
        createdAt: true,
        customer: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.review.count({ where }),
    prisma.review.aggregate({
      where,
      _avg: { rating: true },
    }),
  ]);

  const sanitizedReviews = reviews.map((r) => ({
    id: r.id,
    bookingId: r.bookingId,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.createdAt,
    customerName: anonymizeCustomerName(r.customer?.name),
  }));

  const rawAvg = aggregate._avg.rating || 0;
  const averageRating = Math.round(rawAvg * 10) / 10;

  return {
    data: sanitizedReviews,
    meta: {
      ...buildPaginationMeta({ page, limit, total }),
      averageRating,
      totalReviews: total,
    },
  };
};

/**
 * PATCH /admin/reviews/:id/visibility
 * Admin menyembunyikan atau menampilkan kembali ulasan publik
 */
export const updateReviewVisibility = async ({ actor, reviewId, isHidden }) => {
  if (actor.role !== "ADMIN") {
    throw new ForbiddenError("Hanya admin yang berwenang mengubah visibilitas ulasan", "FORBIDDEN");
  }

  const review = await prisma.review.findUnique({
    where: { id: reviewId },
  });

  if (!review) {
    throw new NotFoundError("Ulasan tidak ditemukan", "REVIEW_NOT_FOUND");
  }

  const updated = await prisma.review.update({
    where: { id: reviewId },
    data: { isHidden },
  });

  return updated;
};

export default {
  createBookingReview,
  listOutletReviews,
  listMechanicReviews,
  updateReviewVisibility,
};
