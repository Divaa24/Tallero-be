import prisma from "../config/prisma.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { UnauthorizedError } from "../utils/errors.js";

/**
 * Middleware autentikasi berbasis JWT access token (HS256) + verifikasi status user di database.
 * Memastikan user belum dihapus (soft delete), aktif, terverifikasi, dan tokenVersion cocok.
 */
export const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new UnauthorizedError("Token autentikasi tidak ditemukan", "UNAUTHORIZED");
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new UnauthorizedError("Token autentikasi tidak valid", "INVALID_TOKEN");
  }

  const payload = verifyAccessToken(token);

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      outletId: true,
      isActive: true,
      isVerified: true,
      mustChangePassword: true,
      tokenVersion: true,
    },
  });

  if (!user || !user.isActive || !user.isVerified || user.tokenVersion !== payload.tokenVersion) {
    throw new UnauthorizedError("Sesi tidak valid atau akun telah dinonaktifkan", "UNAUTHORIZED");
  }

  req.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    outletId: user.outletId,
    mustChangePassword: user.mustChangePassword,
  };

  next();
};

export default authenticate;
