const express = require("express");
const router = express.Router();
const validate = require("../middlewares/validate.middleware");
const { verifyToken } = require("../middlewares/auth.middleware");
const { reviewSchema } = require("../schemas/booking.schema");
const reviewController = require("../controllers/review.controller");

router.post("/", verifyToken, validate(reviewSchema), reviewController.addReview);

module.exports = router;
