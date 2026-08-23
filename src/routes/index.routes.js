const express = require("express");
const router = express.Router();

const authRoutes = require("./auth.routes");
const userRoutes = require("./user.routes");
const dashboardRoutes = require("./dashboard.routes");
const outletRoutes = require("./outlet.routes");
const serviceRoutes = require("./service.routes");
const vehicleRoutes = require("./vehicle.routes");
const bookingRoutes = require("./booking.routes");
const reviewRoutes = require("./review.routes");
const chatRoutes = require("./chat.routes");

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/outlets", outletRoutes);
router.use("/services", serviceRoutes);
router.use("/vehicles", vehicleRoutes);
router.use("/bookings", bookingRoutes);
router.use("/reviews", reviewRoutes);
router.use("/chat", chatRoutes);

module.exports = router;
