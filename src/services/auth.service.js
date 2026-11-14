import prisma from "../config/prisma.js";
import env from "../config/env.js";
import RULES from "../config/rules.js";
import logger from "../config/logger.js";
import {
  dummyCompare,
  generateRandomToken,
  hashPassword,
  sha256,
  verifyPassword,
} from "../utils/crypto.js";
import { createSignedUrl } from "../utils/signedUrl.js";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
} from "../utils/errors.js";
import { buildPasswordResetEmail, sendMail } from "./mail.service.js";
import { issueSessionTokens, revokeAllUserSessions } from "./sessionTokens.js";
import { removeAvatarFile, saveProcessedAvatar } from "./files.service.js";

/**
 * Whitelist field user publik yang aman dikembalikan ke client (tanpa secret / internal fields).
 */
export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  address: true,
  avatarKey: true,
  role: true,
  outletId: true,
  isActive: true,
  isVerified: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
};

/**
 * Membentuk objek user aman untuk respons API sambil membangkitkan signed URL avatar jika ada.
 */
export const formatUserDto = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  address: user.address ?? null,
  avatarUrl: user.avatarKey ? createSignedUrl({ kind: "avatar", id: user.avatarKey }).url : null,
  role: user.role,
  outletId: user.outletId ?? null,
  isActive: user.isActive,
  isVerified: user.isVerified,
  mustChangePassword: user.mustChangePassword,
  lastLoginAt: user.lastLoginAt ?? null,
  createdAt: user.createdAt,
});

/**
 * Autentikasi email + password dengan dummyCompare, password-check-first, dan lockout 5 gagal -> 15 menit.
 */
export const login = async ({ email, password, meta = {} }) => {
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      ...publicUserSelect,
      passwordHash: true,
      tokenVersion: true,
      failedLoginCount: true,
      lockedUntil: true,
    },
  });

  if (!user) {
    await dummyCompare(password);
    throw new UnauthorizedError("Email atau password salah", "INVALID_CREDENTIALS");
  }

  // Selalu verifikasi password sebelum membocorkan status akun apa pun (AGENTS.md §4.3)
  const isPasswordValid = await verifyPassword(password, user.passwordHash);

  if (user.lockedUntil && user.lockedUntil > now) {
    throw new TooManyRequestsError(
      "Akun terkunci sementara karena terlalu banyak percobaan gagal. Silakan coba lagi nanti.",
      "ACCOUNT_LOCKED"
    );
  }

  if (!isPasswordValid) {
    const baseFailures = user.lockedUntil && user.lockedUntil <= now ? 0 : user.failedLoginCount;
    const nextFailures = baseFailures + 1;
    const shouldLock = nextFailures >= RULES.LOGIN_MAX_FAILS;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: nextFailures,
        lockedUntil: shouldLock ? new Date(now.getTime() + RULES.LOCK_MINUTES * 60 * 1000) : null,
      },
    });

    throw new UnauthorizedError("Email atau password salah", "INVALID_CREDENTIALS");
  }

  if (!user.isActive) {
    throw new ForbiddenError(
      "Akun Anda telah dinonaktifkan. Silakan hubungi administrator.",
      "ACCOUNT_INACTIVE"
    );
  }

  if (!user.isVerified) {
    throw new ForbiddenError(
      "Akun belum diverifikasi. Silakan verifikasi kode OTP terlebih dahulu.",
      "ACCOUNT_NOT_VERIFIED"
    );
  }

  return prisma.$transaction(async (tx) => {
    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: now,
      },
      select: { ...publicUserSelect, tokenVersion: true },
    });

    const tokens = await issueSessionTokens({ db: tx, user: updatedUser, ...meta });

    return {
      ...tokens,
      user: formatUserDto(updatedUser),
      mustChangePassword: updatedUser.mustChangePassword,
    };
  });
};

/**
 * Mengirim tautan reset password (token acak 32 byte, bukan OTP) dengan respons generik anti-enumerasi.
 */
export const forgotPassword = async ({ email }) => {
  const genericResponse = {
    message: "Jika email terdaftar, tautan reset password telah dikirim ke email Anda.",
  };

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, isActive: true, isVerified: true },
  });

  if (!user || !user.isActive || !user.isVerified) {
    return genericResponse;
  }

  const now = new Date();
  const rawToken = generateRandomToken(32);
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(now.getTime() + RULES.PASSWORD_RESET_TTL_MIN * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    });

    await tx.passwordResetToken.create({
      data: { userId: user.id, tokenHash, expiresAt },
    });
  });

  const resetUrl = `${env.WEB_URL.replace(/\/+$/, "")}/reset-password?token=${rawToken}`;
  const mailPayload = buildPasswordResetEmail({
    name: user.name,
    resetUrl,
    expiresMinutes: RULES.PASSWORD_RESET_TTL_MIN,
  });

  try {
    await sendMail({ to: user.email, ...mailPayload });
  } catch (error) {
    // Jangan bocorkan keberadaan email melalui error 502 pada forgot-password
    logger.error({ err: error, userId: user.id }, "Gagal mengirim email reset password");
  }

  return genericResponse;
};

/**
 * Mereset password dengan token acak sekali pakai, lalu mencabut seluruh sesi & menaikkan tokenVersion.
 */
export const resetPassword = async ({ token, newPassword }) => {
  const now = new Date();
  const tokenHash = sha256(token);

  const resetRecord = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: {
      user: { select: { id: true, isActive: true, deletedAt: true } },
    },
  });

  if (
    !resetRecord ||
    resetRecord.usedAt !== null ||
    resetRecord.expiresAt <= now ||
    !resetRecord.user ||
    resetRecord.user.deletedAt !== null ||
    !resetRecord.user.isActive
  ) {
    throw new BadRequestError(
      "Token reset password tidak valid atau sudah kedaluwarsa",
      "INVALID_RESET_TOKEN"
    );
  }

  const newPasswordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: resetRecord.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });

    if (claimed.count !== 1) {
      throw new BadRequestError(
        "Token reset password tidak valid atau sudah digunakan",
        "INVALID_RESET_TOKEN"
      );
    }

    await tx.user.update({
      where: { id: resetRecord.user.id },
      data: {
        passwordHash: newPasswordHash,
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });

    await revokeAllUserSessions({
      db: tx,
      userId: resetRecord.user.id,
      incrementTokenVersion: true,
    });
  });

  return { message: "Password berhasil direset. Silakan login menggunakan password baru." };
};

/**
 * Mengganti password pengguna terautentikasi dan mencabut seluruh sesi aktif.
 */
export const changePassword = async ({ actor, currentPassword, newPassword }) => {
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { id: true, passwordHash: true },
  });

  if (!user) {
    throw new NotFoundError("Pengguna tidak ditemukan", "USER_NOT_FOUND");
  }

  const isCurrentValid = await verifyPassword(currentPassword, user.passwordHash);
  if (!isCurrentValid) {
    throw new UnauthorizedError("Password saat ini tidak sesuai", "INVALID_CURRENT_PASSWORD");
  }

  const newPasswordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: actor.id },
      data: {
        passwordHash: newPasswordHash,
        mustChangePassword: false,
      },
    });

    await revokeAllUserSessions({
      db: tx,
      userId: actor.id,
      incrementTokenVersion: true,
    });
  });

  return { message: "Password berhasil diubah. Silakan login kembali." };
};

export const getMe = async ({ actor }) => {
  const user = await prisma.user.findUnique({
    where: { id: actor.id },
    select: publicUserSelect,
  });

  if (!user) {
    throw new NotFoundError("Pengguna tidak ditemukan", "USER_NOT_FOUND");
  }

  return formatUserDto(user);
};

export const updateMe = async ({ actor, data }) => {
  const updateData = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.address !== undefined) updateData.address = data.address;

  const updated = await prisma.user.update({
    where: { id: actor.id },
    data: updateData,
    select: publicUserSelect,
  });

  return formatUserDto(updated);
};

export const updateAvatar = async ({ actor, buffer }) => {
  const current = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { id: true, avatarKey: true },
  });

  if (!current) {
    throw new NotFoundError("Pengguna tidak ditemukan", "USER_NOT_FOUND");
  }

  const saved = await saveProcessedAvatar(buffer);

  try {
    const updated = await prisma.user.update({
      where: { id: actor.id },
      data: { avatarKey: saved.avatarKey },
      select: publicUserSelect,
    });

    if (current.avatarKey) {
      await removeAvatarFile(current.avatarKey);
    }

    return formatUserDto(updated);
  } catch (error) {
    await removeAvatarFile(saved.avatarKey);
    throw error;
  }
};

export default {
  publicUserSelect,
  formatUserDto,
  login,
  forgotPassword,
  resetPassword,
  changePassword,
  getMe,
  updateMe,
  updateAvatar,
};
