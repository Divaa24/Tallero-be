import prisma from "../config/prisma.js";
import logger from "../config/logger.js";

const REVOKED_RETENTION_DAYS = 7;

/**
 * Membersihkan OTP, token reset password, dan refresh token yang sudah kedaluwarsa
 * atau sudah dipakai/dicabut melewati masa retensi audit/reuse-detection.
 */
export const runTokenCleanup = async (now = new Date()) => {
  const retentionCutoff = new Date(now.getTime() - REVOKED_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const [otps, resets, refreshes] = await Promise.all([
    prisma.registrationOtp.deleteMany({
      where: {
        OR: [{ expiresAt: { lte: now } }, { consumedAt: { lte: retentionCutoff } }],
      },
    }),
    prisma.passwordResetToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lte: now } }, { usedAt: { lte: retentionCutoff } }],
      },
    }),
    prisma.refreshToken.deleteMany({
      where: {
        OR: [{ expiresAt: { lte: now } }, { revokedAt: { lte: retentionCutoff } }],
      },
    }),
  ]);

  const summary = {
    deletedOtps: otps.count,
    deletedResetTokens: resets.count,
    deletedRefreshTokens: refreshes.count,
  };

  logger.info({ cleanup: summary }, "Pembersihan token autentikasi kedaluwarsa selesai");
  return summary;
};

export default {
  runTokenCleanup,
};
