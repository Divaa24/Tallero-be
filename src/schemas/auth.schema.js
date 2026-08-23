const { z } = require("zod");

const registerSchema = {
  body: z.object({
    name: z.string().min(1, "Name is required").max(100),
    email: z.string().email("Invalid email format").max(100),
    password: z.string().min(6, "Password must be at least 6 characters"),
    phone: z.string().min(1, "Phone number is required"),
    address: z.string().optional(),
  }),
};

const verifyOtpSchema = {
  body: z.object({
    email: z.string().email("Invalid email format"),
    otpCode: z.string().length(6, "OTP must be exactly 6 characters"),
  }),
};

const loginSchema = {
  body: z.object({
    email: z.string().email("Invalid email format"),
    password: z.string().min(1, "Password is required"),
  }),
};

const forgotPasswordSchema = {
  body: z.object({
    email: z.string().email("Invalid email format"),
  }),
};

const resetPasswordSchema = {
  body: z.object({
    email: z.string().email("Invalid email format"),
    otpCode: z.string().length(6, "OTP must be exactly 6 characters"),
    newPassword: z.string().min(6, "Password must be at least 6 characters"),
  }),
};

module.exports = {
  registerSchema,
  verifyOtpSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
};
