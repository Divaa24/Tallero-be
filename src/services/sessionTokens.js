import crypto from "node:crypto";
import prisma from "../config/prisma.js";
import RULES from "../config/rules.js";
import logger from "../config/logger.js";
import { generateRandomToken, sha256 } from "../utils/crypto.js";
import { signAccessToken } from "../utils/jwt.js";
import { UnauthorizedError } from "../utils/errors.js";

const REFRESH_BYTE_LENGTH = 48;

const truncateStr = (value, maxLength) => {
  if (!value || typeof value !== "string") return null;
  return value.slice(0, maxLength);
};

const buildRefreshExpiresAt = (nowMs = Date.now()) =>
  new Date(nowMs + RULES.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

/**
 * Menerbitkan pasangan access token (JWT HS256) + refresh token opaque baru dalam family baru.
 */
export const issueSessionTokens = async ({
  db = prisma,
  user,
  userAgent = null,
  ip = null,
  familyId = crypto.randomUUID(),
}) => {
  const rawRefreshToken = generateRandomToken(REFRESH_BYTE_LENGTH);
  const tokenHash = sha256(rawRefreshToken);

  await db.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      familyId,
      expiresAt: buildRefreshExpiresAt(),
      userAgent: truncateStr(userAgent, 255),
      ip: truncateStr(ip, 64),
    },
  });

  const accessToken = signAccessToken({
    userId: user.id,
    role: user.role,
    tokenVersion: user.tokenVersion,
  });

  return {
    accessToken,
    refreshToken: rawRefreshToken,
    expiresIn: RULES.ACCESS_TTL_SEC,
  };
};

/**
 * Merotasi refresh token secara atomik dan mendeteksi reuse token lama (mencabut seluruh family).
 */
export const rotateRefreshToken = async ({ rawRefreshToken, userAgent = null, ip = null }) => {
  if (!rawRefreshToken || typeof rawRefreshToken !== "string") {
    throw new UnauthorizedError("Refresh token tidak ditemukan", "INVALID_REFRESH_TOKEN");
  }

  const tokenHash = sha256(rawRefreshToken);
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: {
          id: true,
          role: true,
          isActive: true,
          isVerified: true,
          mustChangePassword: true,
          tokenVersion: true,
          deletedAt: true,
        },
      },
    },
  });

  if (!existing) {
    throw new UnauthorizedError("Refresh token tidak valid", "INVALID_REFRESH_TOKEN");
  }

  if (existing.revokedAt !== null) {
    await prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    logger.warn(
      { userId: existing.userId, familyId: existing.familyId },
      "Reuse refresh token terdeteksi; seluruh family token dicabut"
    );
    throw new UnauthorizedError(
      "Terdeteksi penggunaan ulang refresh token. Silakan login kembali.",
      "TOKEN_REUSE_DETECTED"
    );
  }

  const now = new Date();
  if (existing.expiresAt <= now) {
    throw new UnauthorizedError(
      "Refresh token telah kedaluwarsa. Silakan login kembali.",
      "REFRESH_TOKEN_EXPIRED"
    );
  }

  const { user } = existing;
  if (!user || user.deletedAt !== null || !user.isActive || !user.isVerified) {
    throw new UnauthorizedError("Sesi tidak valid atau akun telah dinonaktifkan", "UNAUTHORIZED");
  }

  const nextRawRefreshToken = generateRandomToken(REFRESH_BYTE_LENGTH);
  const nextTokenHash = sha256(nextRawRefreshToken);

  const rotationResult = await prisma.$transaction(async (tx) => {
    const nextToken = await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: nextTokenHash,
        familyId: existing.familyId,
        expiresAt: buildRefreshExpiresAt(),
        userAgent: truncateStr(userAgent, 255),
        ip: truncateStr(ip, 64),
      },
    });

    // Claim bersyarat agar dua request refresh paralel pada token sama terdeteksi sebagai reuse
    const claimed = await tx.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: now, replacedById: nextToken.id },
    });

    if (claimed.count !== 1) {
      return { reuseDetected: true, familyId: existing.familyId };
    }

    return { reuseDetected: false, nextRawRefreshToken };
  });

  // Pencabutan family dilakukan di luar transaksi agar tidak ikut ter-rollback saat melempar 401
  if (rotationResult.reuseDetected) {
    await prisma.refreshToken.updateMany({
      where: { familyId: rotationResult.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    logger.warn(
      { userId: user.id, familyId: rotationResult.familyId },
      "Race reuse refresh token terdeteksi; seluruh family token dicabut"
    );
    throw new UnauthorizedError(
      "Terdeteksi penggunaan ulang refresh token. Silakan login kembali.",
      "TOKEN_REUSE_DETECTED"
    );
  }

  const accessToken = signAccessToken({
    userId: user.id,
    role: user.role,
    tokenVersion: user.tokenVersion,
  });

  return {
    accessToken,
    refreshToken: rotationResult.nextRawRefreshToken,
    expiresIn: RULES.ACCESS_TTL_SEC,
  };
};

/**
 * Mencabut satu refresh token saat logout (idempoten).
 */
export const revokeSingleRefreshToken = async ({ rawRefreshToken }) => {
  if (!rawRefreshToken || typeof rawRefreshToken !== "string") {
    return;
  }

  await prisma.refreshToken.updateMany({
    where: {
      tokenHash: sha256(rawRefreshToken),
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
};

/**
 * Mencabut seluruh sesi aktif milik user (digunakan pada logout-all, ganti/reset password).
 */
export const revokeAllUserSessions = async ({
  db = prisma,
  userId,
  incrementTokenVersion = false,
}) => {
  if (incrementTokenVersion) {
    await db.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
  }

  await db.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
};

export default {
  issueSessionTokens,
  rotateRefreshToken,
  revokeSingleRefreshToken,
  revokeAllUserSessions,
};
