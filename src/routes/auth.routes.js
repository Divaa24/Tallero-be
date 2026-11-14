import { Router } from "express";
import authenticate from "../middlewares/authenticate.js";
import { authorize, authorizePasswordChangeAllowed } from "../middlewares/authorize.js";
import validate from "../middlewares/validate.js";
import uploadSingleImage from "../middlewares/upload.js";
import {
  authEmailRateLimiter,
  authIpRateLimiter,
  loginRateLimiter,
} from "../middlewares/rateLimit.js";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resendOtpSchema,
  resetPasswordSchema,
  updateMeSchema,
  verifyOtpSchema,
} from "../validations/auth.validation.js";
import * as authController from "../controllers/auth.controller.js";

const authRouter = Router();

// Endpoint publik autentikasi (dilindungi rate limiter ketat + Zod .strict())
authRouter.post(
  "/register",
  authIpRateLimiter,
  validate(registerSchema),
  authEmailRateLimiter,
  authController.register
);
authRouter.post(
  "/verify-otp",
  authIpRateLimiter,
  validate(verifyOtpSchema),
  authEmailRateLimiter,
  authController.verifyOtp
);
authRouter.post(
  "/resend-otp",
  authIpRateLimiter,
  validate(resendOtpSchema),
  authEmailRateLimiter,
  authController.resendOtp
);
authRouter.post("/login", validate(loginSchema), loginRateLimiter, authController.login);
authRouter.post("/refresh", authIpRateLimiter, validate(refreshSchema), authController.refresh);
authRouter.post("/logout", validate(logoutSchema), authController.logout);
authRouter.post(
  "/forgot-password",
  authIpRateLimiter,
  validate(forgotPasswordSchema),
  authEmailRateLimiter,
  authController.forgotPassword
);
authRouter.post(
  "/reset-password",
  authIpRateLimiter,
  validate(resetPasswordSchema),
  authController.resetPassword
);

// Endpoint terautentikasi untuk sesi & profil pengguna sendiri
authRouter.post(
  "/logout-all",
  authenticate,
  authorizePasswordChangeAllowed("CUSTOMER", "MECHANIC", "ADMIN"),
  authController.logoutAll
);
authRouter.post(
  "/change-password",
  authenticate,
  authorizePasswordChangeAllowed("CUSTOMER", "MECHANIC", "ADMIN"),
  validate(changePasswordSchema),
  authController.changePassword
);
authRouter.get(
  "/me",
  authenticate,
  authorizePasswordChangeAllowed("CUSTOMER", "MECHANIC", "ADMIN"),
  authController.getMe
);
authRouter.patch(
  "/me",
  authenticate,
  authorize("CUSTOMER", "MECHANIC", "ADMIN"),
  validate(updateMeSchema),
  authController.updateMe
);
authRouter.post(
  "/me/avatar",
  authenticate,
  authorize("CUSTOMER", "MECHANIC", "ADMIN"),
  uploadSingleImage,
  authController.uploadAvatar
);

export default authRouter;
