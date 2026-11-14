import jwt from "jsonwebtoken";
import env from "../config/env.js";
import RULES from "../config/rules.js";
import { UnauthorizedError } from "./errors.js";

/**
 * Menandatangani JWT access token menggunakan algoritma HS256 yang dipin eksplisit.
 * Payload minimal: sub (userId), role, tokenVersion.
 */
export const signAccessToken = ({ userId, role, tokenVersion }) => {
  return jwt.sign(
    {
      sub: String(userId),
      role,
      tokenVersion,
    },
    env.JWT_SECRET,
    {
      algorithm: "HS256",
      expiresIn: RULES.ACCESS_TTL,
    }
  );
};

/**
 * Memverifikasi JWT access token dengan algoritma HS256 yang dipin eksplisit.
 */
export const verifyAccessToken = (token) => {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ["HS256"],
    });

    const userId = Number(decoded.sub);
    if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(decoded.tokenVersion)) {
      throw new UnauthorizedError("Token autentikasi tidak valid", "INVALID_TOKEN");
    }

    return {
      userId,
      role: decoded.role,
      tokenVersion: decoded.tokenVersion,
    };
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    if (error.name === "TokenExpiredError") {
      throw new UnauthorizedError(
        "Sesi login telah berakhir. Silakan refresh token.",
        "TOKEN_EXPIRED"
      );
    }
    throw new UnauthorizedError("Token autentikasi tidak valid", "INVALID_TOKEN");
  }
};

export default {
  signAccessToken,
  verifyAccessToken,
};
