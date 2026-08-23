const express = require("express");
const router = express.Router();
const validate = require("../middlewares/validate.middleware");
const { verifyToken, authorizeRoles } = require("../middlewares/auth.middleware");
const upload = require("../middlewares/upload.middleware");
const {
  createBookingSchema,
  updateStatusSchema,
  checkInSchema,
  paymentSchema,
  photoSchema,
  historyLogSchema
} = require("../schemas/booking.schema");
const bookingController = require("../controllers/booking.controller");

router.use(verifyToken);

// Customer Routes
router.post("/", validate(createBookingSchema), bookingController.createBooking);
router.get("/my", bookingController.getMyBookings);
router.get("/:id", bookingController.getBookingById);
router.get("/:id/logs", validate(historyLogSchema), bookingController.getBookingHistoryLogs);

// Admin & Mechanic Shared Routes
router.get("/", authorizeRoles("ADMIN", "MECHANIC"), bookingController.getAllBookings);
router.patch("/:id/status", authorizeRoles("ADMIN", "MECHANIC"), validate(updateStatusSchema), bookingController.updateStatus);
router.post("/:id/photos", authorizeRoles("ADMIN", "MECHANIC"), upload.single("photo"), validate(photoSchema), bookingController.uploadPhoto);

// Admin Exclusive Routes
router.post("/check-in", authorizeRoles("ADMIN"), validate(checkInSchema), bookingController.checkInByQr);
router.post("/:id/payment", authorizeRoles("ADMIN"), validate(paymentSchema), bookingController.completePayment);

module.exports = router;
