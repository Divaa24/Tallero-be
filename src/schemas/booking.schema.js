const { z } = require("zod");

const createBookingSchema = {
  body: z.object({
    outletId: z.number().int("Outlet ID must be an integer"),
    vehicleId: z.number().int("Vehicle ID must be an integer"),
    serviceId: z.number().int("Service ID must be an integer"),
    bookingDate: z.string().datetime("Booking date must be a valid ISO 8601 string"),
    customerNotes: z.string().optional(),
  }),
};

const updateStatusSchema = {
  params: z.object({
    id: z.string().transform((val) => parseInt(val, 10)),
  }),
  body: z.object({
    status: z.enum(["PENDING", "CHECKED_IN", "IN_PROGRESS", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED"]),
    adminNotes: z.string().optional(),
  }),
};

const checkInSchema = {
  body: z.object({
    bookingCode: z.string().min(1, "Booking code is required"),
  }),
};

const paymentSchema = {
  params: z.object({
    id: z.string().transform((val) => parseInt(val, 10)),
  }),
  body: z.object({
    paymentMethod: z.enum(["CASH", "TRANSFER", "QRIS"]),
    serviceFee: z.number().nonnegative("Service fee must be zero or greater").optional(),
    additionalFee: z.number().nonnegative("Additional fee must be zero or greater").optional(),
    totalPrice: z.number().positive("Total price must be greater than 0"),
  }),
};

const photoSchema = {
  params: z.object({
    id: z.string().transform((val) => parseInt(val, 10)),
  }),
  body: z.object({
    type: z.enum(["BEFORE", "AFTER"]),
    caption: z.string().optional(),
  }), // Note: photoPath will come from req.file logic in the controller, so we don't strictly validate it in the body schema (which expects JSON-like strings if sent as multipart form fields). Multer will intercept the file.
};

const reviewSchema = {
  body: z.object({
    bookingId: z.number().int("Booking ID must be an integer"),
    rating: z.number().int().min(1).max(5),
    comment: z.string().optional(),
  }),
};

const historyLogSchema = {
  params: z.object({
    id: z.string().transform((val) => parseInt(val, 10)),
  }),
};

module.exports = {
  createBookingSchema,
  updateStatusSchema,
  checkInSchema,
  paymentSchema,
  photoSchema,
  reviewSchema,
  historyLogSchema,
};
