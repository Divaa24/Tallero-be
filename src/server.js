import http from "node:http";
import app from "./app.js";
import env from "./config/env.js";
import logger from "./config/logger.js";
import { prisma, pool } from "./config/prisma.js";
import { initSocket } from "./config/socket.js";
import { initScheduler, stopScheduler } from "./jobs/scheduler.js";

const server = http.createServer(app);

// Inisialisasi Socket.IO server ter-autentikasi
const io = initSocket(server);

// Inisialisasi background cron scheduler (dijaga oleh ENABLE_JOBS)
initScheduler();

const PORT = env.PORT || 5000;
const HOST = env.HOST || "0.0.0.0";

server.listen(PORT, HOST, () => {
  logger.info(
    {
      host: HOST,
      port: PORT,
      env: env.NODE_ENV,
      pid: process.pid,
    },
    `Server Tallero Auto aktif dan mendengarkan pada http://${HOST}:${PORT}`
  );
});

// ==============================================================================
// GRACEFUL SHUTDOWN (SIGINT / SIGTERM)
// ==============================================================================
let isShuttingDown = false;

const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Menerima sinyal [${signal}]. Memulai graceful shutdown...`);

  // Hentikan background scheduler
  stopScheduler();

  // Tutup koneksi Socket.IO
  if (io) {
    try {
      io.close();
      logger.info("Socket.IO Server berhasil ditutup.");
    } catch (err) {
      logger.warn({ err }, "Peringatan saat menutup Socket.IO server.");
    }
  }

  // Berhenti menerima koneksi HTTP baru
  server.close(async () => {
    logger.info("HTTP Server berhasil ditutup.");

    try {
      // Tutup koneksi database Prisma & pool
      await prisma.$disconnect();
      await pool.end();
      logger.info("Koneksi database PostgreSQL berhasil diputus dengan aman.");

      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Terjadi kesalahan saat memutus koneksi database.");
      process.exit(1);
    }
  });

  // Force shutdown jika melebihi batas waktu 10 detik
  setTimeout(() => {
    logger.error("Batas waktu graceful shutdown terlewati (10 detik). Memaksa keluar.");
    process.exit(1);
  }, 10000).unref();
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("unhandledRejection", (reason, promise) => {
  logger.error({ reason, promise }, "Unhandled Promise Rejection terdeteksi");
});

process.on("uncaughtException", (error) => {
  logger.fatal({ error }, "Uncaught Exception terdeteksi. Server akan keluar.");
  process.exit(1);
});

export default server;
