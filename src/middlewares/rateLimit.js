import rateLimit from "express-rate-limit";
import env from "../config/env.js";
import { TooManyRequestsError } from "../utils/errors.js";

const extractNormalizedEmail = (req) => {
  const email = req.body?.email;
  return typeof email === "string" ? email.trim().toLowerCase() : "";
};

/**
 * Factory rate limiter standar dengan response TooManyRequestsError (429) konsisten.
 */
export const createRateLimiter = ({
  windowMs,
  max,
  keyGenerator,
  message = "Terlalu banyak permintaan. Silakan coba kembali beberapa saat lagi.",
  code = "TOO_MANY_REQUESTS",
}) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (req, res, next) => {
      next(new TooManyRequestsError(message, code));
    },
  });

/**
 * Global rate limiter untuk mencegah brute-force dan DoS
 * Batas: 300 request per 15 menit per IP untuk API umum
 */
export const globalRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === "test" ? 1000 : 300,
  message: "Terlalu banyak permintaan dari IP Anda. Silakan coba kembali dalam 15 menit.",
});

/**
 * Rate limiter khusus login (per kombinasi IP + email ternormalisasi)
 */
export const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === "test" ? 100 : 15,
  keyGenerator: (req) => {
    const email = extractNormalizedEmail(req);
    return email ? `${req.ip}:${email}` : req.ip;
  },
  message: "Terlalu banyak percobaan login. Silakan tunggu beberapa saat lagi.",
  code: "LOGIN_RATE_LIMITED",
});

/**
 * Rate limiter per IP untuk endpoint sensitif (register, OTP, forgot/reset password)
 */
export const authIpRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === "test" ? 200 : 30,
  message: "Terlalu banyak permintaan autentikasi dari IP Anda. Silakan coba lagi nanti.",
  code: "AUTH_RATE_LIMITED",
});

/**
 * Rate limiter per email untuk endpoint OTP dan lupa password
 */
export const authEmailRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === "test" ? 100 : 10,
  keyGenerator: (req) => extractNormalizedEmail(req) || req.ip,
  message: "Terlalu banyak permintaan untuk email ini. Silakan coba kembali nanti.",
  code: "AUTH_EMAIL_RATE_LIMITED",
});

/**
 * Rate limiter khusus pengecekan ketersediaan slot (availability)
 */
export const availabilityRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: env.NODE_ENV === "test" ? 500 : 60,
  message: "Terlalu banyak permintaan pengecekan ketersediaan slot. Silakan tunggu beberapa saat.",
  code: "AVAILABILITY_RATE_LIMITED",
});

/**
 * Rate limiter khusus fitur Assistant query
 */
export const assistantRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: env.NODE_ENV === "test" ? 500 : 60,
  message: "Terlalu banyak permintaan ke assistant. Silakan tunggu beberapa saat.",
  code: "ASSISTANT_RATE_LIMITED",
});

export default globalRateLimiter;
