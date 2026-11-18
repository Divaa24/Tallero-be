import { Server } from "socket.io";
import { verifyAccessToken } from "../utils/jwt.js";
import env from "./env.js";
import logger from "./logger.js";
import prisma from "./prisma.js";
import { setSocketIoInstance, emitRealtimeEvent } from "../services/realtime.service.js";

export { emitRealtimeEvent };

const extractBearer = (header) => {
  if (!header || typeof header !== "string") return null;
  const parts = header.trim().split(" ");
  if (parts.length === 2 && parts[0].toLowerCase() === "bearer") {
    return parts[1];
  }
  return null;
};

/**
 * Middleware autentikasi JWT pada handshake Socket.IO
 */
export const socketAuthMiddleware = async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token || extractBearer(socket.handshake.headers?.authorization);

    if (!token) {
      const err = new Error("Token autentikasi tidak ditemukan pada handshake");
      err.data = { code: "AUTH_TOKEN_MISSING" };
      return next(err);
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (jwtErr) {
      const err = new Error("Token autentikasi tidak valid atau telah kedaluwarsa");
      err.data = { code: "INVALID_TOKEN", details: jwtErr.message };
      return next(err);
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        outletId: true,
        isActive: true,
        isVerified: true,
        tokenVersion: true,
        deletedAt: true,
      },
    });

    if (!user || user.deletedAt !== null) {
      const err = new Error("Pengguna tidak ditemukan atau telah dihapus");
      err.data = { code: "USER_NOT_FOUND" };
      return next(err);
    }

    if (!user.isActive) {
      const err = new Error("Akun pengguna sedang dinonaktifkan");
      err.data = { code: "ACCOUNT_INACTIVE" };
      return next(err);
    }

    if (!user.isVerified) {
      const err = new Error("Akun pengguna belum diverifikasi");
      err.data = { code: "ACCOUNT_UNVERIFIED" };
      return next(err);
    }

    if (user.tokenVersion !== decoded.tokenVersion) {
      const err = new Error("Sesi token telah kedaluwarsa atau dicabut");
      err.data = { code: "TOKEN_REVOKED" };
      return next(err);
    }

    socket.user = user;
    return next();
  } catch (error) {
    logger.error({ err: error }, "Kesalahan tidak terduga pada socket handshake auth");
    const err = new Error("Autentikasi socket gagal");
    err.data = { code: "INTERNAL_AUTH_ERROR" };
    return next(err);
  }
};

/**
 * Handler koneksi socket terautentikasi: isolasi room per-user dan per-outlet
 */
export const handleSocketConnection = (socket) => {
  const user = socket.user;
  if (!user) return;

  // 1. Join room personal user
  socket.join(`user:${user.id}`);

  // 2. Jika mekanik atau staf dengan outlet tertentu, join room staff outlet
  if (user.role === "MECHANIC" || (user.outletId && user.role === "ADMIN")) {
    socket.join(`outlet:${user.outletId}:staff`);
  }

  // 3. Jika admin, join room admin
  if (user.role === "ADMIN") {
    socket.join("admin");
  }

  logger.debug(
    {
      userId: user.id,
      role: user.role,
      outletId: user.outletId,
      socketId: socket.id,
    },
    "Socket terautentikasi terhubung"
  );

  socket.on("disconnect", (reason) => {
    logger.debug({ userId: user.id, socketId: socket.id, reason }, "Socket terputus");
  });
};

/**
 * Menginisialisasi server Socket.IO dan memasang middleware autentikasi JWT
 * serta isolasi room per-user dan per-outlet sesuai AGENTS.md §4.23 & §8.
 *
 * @param {import("http").Server} httpServer
 * @returns {Server}
 */
export const initSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Izinkan request tanpa origin (mobile native) sesuai AGENTS.md §4.20
        if (!origin) return callback(null, true);
        if (env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        return callback(
          new Error(`Origin ${origin} tidak diizinkan oleh kebijakan CORS Socket.IO`),
          false
        );
      },
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization", "X-Client", "X-Request-Id"],
    },
    serveClient: false,
  });

  io.use(socketAuthMiddleware);
  io.on("connection", handleSocketConnection);

  // Daftarkan instance ke service realtime
  setSocketIoInstance(io);

  return io;
};

export default {
  initSocket,
  socketAuthMiddleware,
  handleSocketConnection,
};
