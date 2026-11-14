import prisma, { withDeleted } from "../config/prisma.js";
import env from "../config/env.js";
import RULES from "../config/rules.js";
import { generateNumericOtp, hashPassword, hmacSha256, safeCompare } from "../utils/crypto.js";
import { BadRequestError, TooManyRequestsError } from "../utils/errors.js";
import { buildRegistrationOtpEmail, sendMail } from "./mail.service.js";
import { issueSessionTokens } from "./sessionTokens.js";
import { formatUserDto, publicUserSelect } from "./auth.service.js";

const REGISTER_GENERIC_MESSAGE =
  "Jika email valid dan belum terdaftar, kode OTP verifikasi telah dikirim ke email Anda.";

const assertOtpQuotaAndCooldown = async (userId, now = new Date()) => {
  const latestOtp = await prisma.registrationOtp.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  if (latestOtp) {
    const cooldownMs = RULES.OTP_RESEND_COOLDOWN_SEC * 1000;
    const elapsedMs = now.getTime() - latestOtp.createdAt.getTime();
    if (elapsedMs < cooldownMs) {
      const waitSec = Math.ceil((cooldownMs - elapsedMs) / 1000);
      throw new TooManyRequestsError(
        `Silakan tunggu ${waitSec} detik sebelum meminta kode OTP baru`,
        "OTP_COOLDOWN"
      );
    }
  }

  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const recentCount = await prisma.registrationOtp.count({
    where: { userId, createdAt: { gte: oneHourAgo } },
  });

  if (recentCount >= RULES.OTP_MAX_SENDS_PER_HOUR) {
    throw new TooManyRequestsError(
      "Batas pengiriman OTP per jam telah tercapai. Silakan coba lagi nanti.",
      "OTP_RATE_LIMIT_EXCEEDED"
    );
  }
};

const createAndSendRegistrationOtp = async ({ userId, email, name, now = new Date() }) => {
  const otpCode = generateNumericOtp();
  const codeHash = hmacSha256(otpCode, env.OTP_HMAC_SECRET);
  const expiresAt = new Date(now.getTime() + RULES.OTP_TTL_MIN * 60 * 1000);

  const otpRecord = await prisma.$transaction(async (tx) => {
    await tx.registrationOtp.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: now },
    });

    return tx.registrationOtp.create({
      data: { userId, codeHash, expiresAt },
      select: { id: true },
    });
  });

  const emailContent = buildRegistrationOtpEmail({
    name,
    code: otpCode,
    expiresMinutes: RULES.OTP_TTL_MIN,
  });

  try {
    await sendMail({ to: email, ...emailContent });
  } catch (error) {
    // Hapus OTP yang gagal terkirim agar user tetap dapat resend tanpa terhalang cooldown
    await prisma.registrationOtp.deleteMany({ where: { id: otpRecord.id } });
    throw error;
  }
};

/**
 * Mendaftarkan customer baru atau memperbarui data customer yang belum terverifikasi.
 * Mengembalikan pesan generik yang sama untuk mencegah user enumeration.
 */
export const register = async ({ name, email, password, phone, address }) => {
  const now = new Date();
  const existing = await withDeleted.user.findUnique({
    where: { email },
    select: { id: true, isVerified: true, deletedAt: true },
  });

  const passwordHash = await hashPassword(password);

  if (existing && (existing.deletedAt !== null || existing.isVerified)) {
    return { message: REGISTER_GENERIC_MESSAGE };
  }

  let targetUserId;
  if (existing && !existing.isVerified) {
    await assertOtpQuotaAndCooldown(existing.id, now);
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        name,
        passwordHash,
        phone,
        address: address ?? null,
        role: "CUSTOMER",
        isActive: true,
        isVerified: false,
      },
    });
    targetUserId = existing.id;
  } else {
    const created = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        phone,
        address: address ?? null,
        role: "CUSTOMER",
        isActive: true,
        isVerified: false,
      },
      select: { id: true },
    });
    targetUserId = created.id;
  }

  await createAndSendRegistrationOtp({ userId: targetUserId, email, name, now });
  return { message: REGISTER_GENERIC_MESSAGE };
};

/**
 * Memverifikasi OTP pendaftaran 6 digit (HMAC-SHA256 + timingSafeEqual), mengaktifkan akun, dan menerbitkan sesi.
 */
export const verifyOtp = async ({ email, code, meta = {} }) => {
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, isActive: true, isVerified: true },
  });

  if (!user || !user.isActive || user.isVerified) {
    throw new BadRequestError("Kode OTP tidak valid atau sudah kedaluwarsa", "INVALID_OTP");
  }

  const otpRecord = await prisma.registrationOtp.findFirst({
    where: { userId: user.id, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!otpRecord) {
    throw new BadRequestError("Kode OTP tidak valid atau sudah kedaluwarsa", "INVALID_OTP");
  }

  if (otpRecord.expiresAt <= now || otpRecord.attempts >= RULES.OTP_MAX_ATTEMPTS) {
    await prisma.registrationOtp.updateMany({
      where: { id: otpRecord.id, consumedAt: null },
      data: { consumedAt: now },
    });
    throw new BadRequestError(
      "Kode OTP telah kedaluwarsa atau melebihi batas percobaan. Silakan kirim ulang OTP.",
      "OTP_EXPIRED"
    );
  }

  const submittedHash = hmacSha256(code, env.OTP_HMAC_SECRET);
  if (!safeCompare(submittedHash, otpRecord.codeHash)) {
    const nextAttempts = otpRecord.attempts + 1;
    await prisma.registrationOtp.update({
      where: { id: otpRecord.id },
      data: {
        attempts: nextAttempts,
        ...(nextAttempts >= RULES.OTP_MAX_ATTEMPTS ? { consumedAt: now } : {}),
      },
    });
    throw new BadRequestError("Kode OTP tidak valid atau sudah kedaluwarsa", "INVALID_OTP");
  }

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.registrationOtp.updateMany({
      where: {
        id: otpRecord.id,
        consumedAt: null,
        attempts: { lt: RULES.OTP_MAX_ATTEMPTS },
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });

    if (claimed.count !== 1) {
      throw new BadRequestError("Kode OTP tidak valid atau sudah digunakan", "INVALID_OTP");
    }

    await tx.registrationOtp.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: now },
    });

    const verifiedUser = await tx.user.update({
      where: { id: user.id },
      data: { isVerified: true, lastLoginAt: now },
      select: { ...publicUserSelect, tokenVersion: true },
    });

    const tokens = await issueSessionTokens({ db: tx, user: verifiedUser, ...meta });

    return {
      ...tokens,
      user: formatUserDto(verifiedUser),
      mustChangePassword: verifiedUser.mustChangePassword,
    };
  });
};

/**
 * Mengirim ulang kode OTP pendaftaran dengan menghormati cooldown 60 detik & kuota 5/jam.
 */
export const resendOtp = async ({ email }) => {
  const now = new Date();
  const genericResponse = {
    message: "Jika akun belum terverifikasi, kode OTP baru telah dikirim ke email Anda.",
  };

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, isActive: true, isVerified: true },
  });

  if (!user || !user.isActive || user.isVerified) {
    return genericResponse;
  }

  await assertOtpQuotaAndCooldown(user.id, now);
  await createAndSendRegistrationOtp({ userId: user.id, email: user.email, name: user.name, now });
  return genericResponse;
};

export default {
  register,
  verifyOtp,
  resendOtp,
};
