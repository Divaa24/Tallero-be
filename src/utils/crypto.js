import crypto from "node:crypto";
import bcrypt from "bcrypt";
import RULES from "../config/rules.js";

// Hash cost-12 konstan untuk menyamakan waktu komputasi login saat user tidak ditemukan
const DUMMY_BCRYPT_HASH = "$2b$12$ZgZ.XGjtzYbOu.YhhX550e84nW6mr0J21jC/WDJ7.Z8rBPMa8jJ6C";

/**
 * Meng-hash password plaintext menggunakan bcrypt dengan cost sesuai RULES.BCRYPT_SALT_ROUNDS (12)
 * @param {string} plainPassword
 * @returns {Promise<string>}
 */
export const hashPassword = async (plainPassword) => {
  if (typeof plainPassword !== "string" || plainPassword.length === 0) {
    throw new TypeError("Password harus berupa string tidak kosong");
  }
  return bcrypt.hash(plainPassword, RULES.BCRYPT_SALT_ROUNDS);
};

/**
 * Memverifikasi password plaintext terhadap bcrypt hash tersimpan
 * @param {string} plainPassword
 * @param {string} passwordHash
 * @returns {Promise<boolean>}
 */
export const verifyPassword = async (plainPassword, passwordHash) => {
  if (typeof plainPassword !== "string" || typeof passwordHash !== "string" || !passwordHash) {
    return false;
  }
  return bcrypt.compare(plainPassword, passwordHash);
};

/**
 * Operasi bcrypt compare dummy untuk menyamakan waktu respons ketika user tidak ada
 * @param {string} plainPassword
 * @returns {Promise<false>}
 */
export const dummyCompare = async (plainPassword = "") => {
  const input = typeof plainPassword === "string" ? plainPassword : "";
  await bcrypt.compare(input, DUMMY_BCRYPT_HASH);
  return false;
};

/**
 * Menghasilkan token acak kriptografis (hex) untuk refresh token (48 byte) atau reset token (32 byte)
 * @param {number} byteLength
 * @returns {string}
 */
export const generateRandomToken = (byteLength = 48) => {
  if (!Number.isInteger(byteLength) || byteLength < 16) {
    throw new TypeError("byteLength minimal 16 byte");
  }
  return crypto.randomBytes(byteLength).toString("hex");
};

/**
 * Menghasilkan kode OTP numerik 6 digit (000000 - 999999) dengan zero-padding
 * @returns {string}
 */
export const generateNumericOtp = () => {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
};

/**
 * Menghitung hash SHA-256 dalam format hex
 * @param {string} value
 * @returns {string}
 */
export const sha256 = (value) => {
  if (typeof value !== "string") {
    throw new TypeError("Nilai yang di-hash harus berupa string");
  }
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
};

/**
 * Menghitung HMAC-SHA256 dalam format hex
 * @param {string} value
 * @param {string} secret
 * @returns {string}
 */
export const hmacSha256 = (value, secret) => {
  if (typeof value !== "string") {
    throw new TypeError("Nilai yang di-HMAC harus berupa string");
  }
  if (typeof secret !== "string" || secret.length === 0) {
    throw new TypeError("Secret HMAC wajib diisi");
  }
  return crypto.createHmac("sha256", secret).update(value, "utf8").digest("hex");
};

/**
 * Membandingkan dua string dalam waktu konstan menggunakan crypto.timingSafeEqual
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export const safeCompare = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") {
    return false;
  }

  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
};

export default {
  hashPassword,
  verifyPassword,
  dummyCompare,
  generateRandomToken,
  generateNumericOtp,
  sha256,
  hmacSha256,
  safeCompare,
};
