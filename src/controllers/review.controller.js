const prisma = require("../config/prisma.config");
const AppError = require("../utils/appError.util");

const addReview = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { bookingId, rating, comment } = req.body;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
    });

    if (!booking) {
      return next(new AppError("Booking not found.", 404));
    }

    if (booking.userId !== userId) {
      return next(new AppError("You can only review your own bookings.", 403));
    }

    if (booking.status !== "COMPLETED") {
      return next(new AppError("You can only review completed bookings.", 400));
    }

    const existingReview = await prisma.review.findUnique({
      where: { bookingId },
    });

    if (existingReview) {
      return next(new AppError("You have already reviewed this booking.", 400));
    }

    const review = await prisma.review.create({
      data: {
        bookingId,
        userId,
        rating,
        comment: comment || null,
      },
    });

    res.status(201).json({
      status: "success",
      data: { review },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addReview,
};
