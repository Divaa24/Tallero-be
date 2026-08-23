const express = require("express");
const router = express.Router();
const validate = require("../middlewares/validate.middleware");
const { verifyToken } = require("../middlewares/auth.middleware");
const { 
  registerSchema, 
  verifyOtpSchema, 
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema 
} = require("../schemas/auth.schema");
const authController = require("../controllers/auth.controller");

router.post("/register", validate(registerSchema), authController.register);
router.post("/verify-otp", validate(verifyOtpSchema), authController.verifyOtp);
router.post("/login", validate(loginSchema), authController.login);
router.post("/forgot-password", validate(forgotPasswordSchema), authController.forgotPassword);
router.post("/reset-password", validate(resetPasswordSchema), authController.resetPassword);

router.get("/me", verifyToken, authController.getProfile);

module.exports = router;
