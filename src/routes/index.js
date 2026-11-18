import { Router } from "express";
import { sendSuccess, sendError } from "../utils/response.js";
import prisma from "../config/prisma.js";
import authRouter from "./auth.routes.js";
import filesRouter from "./files.routes.js";
import availabilityRouter from "./availability.routes.js";
import adminUsersRouter from "./users.routes.js";
import { adminOutletsRouter, publicOutletsRouter } from "./outlets.routes.js";
import {
  adminCategoriesRouter,
  adminServicesRouter,
  publicCategoriesRouter,
  publicServicesRouter,
} from "./catalog.routes.js";
import { adminSparepartsRouter, sparepartsRouter } from "./spareparts.routes.js";
import vehiclesRouter from "./vehicles.routes.js";
import bookingsRouter from "./bookings.routes.js";
import staffRouter from "./staff.routes.js";
import auditRouter from "./audit.routes.js";
import paymentsRouter from "./payments.routes.js";
import notificationsRouter from "./notifications.routes.js";
import assistantRouter from "./assistant.routes.js";
import adminReviewsRouter from "./reviews.routes.js";
import { adminDashboardRouter, adminReportsRouter } from "./reports.routes.js";

export const router = Router();

/**
 * Liveness probe: Mengecek apakah proses Express hidup
 * GET /api/v1/health
 */
router.get("/health", (req, res) => {
  return sendSuccess(res, {
    data: {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
  });
});

/**
 * Readiness probe: Mengecek apakah database siap menerima koneksi
 * GET /api/v1/ready
 */
router.get("/ready", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1 as ready`;
    return sendSuccess(res, {
      data: {
        status: "ready",
        database: "connected",
      },
    });
  } catch (error) {
    return sendError(res, {
      statusCode: 503,
      code: "SERVICE_UNAVAILABLE",
      message: "Database belum siap atau koneksi terputus",
      details: {
        database: "disconnected",
        reason: error.message,
      },
    });
  }
});

// Feature routers
router.use("/auth", authRouter);
router.use("/files", filesRouter);

// Master data & operations (Fase 3 & Fase 4)
router.use("/outlets", availabilityRouter);
router.use("/outlets", publicOutletsRouter);
router.use("/categories", publicCategoriesRouter);
router.use("/services", publicServicesRouter);
router.use("/spareparts", sparepartsRouter);
router.use("/vehicles", vehiclesRouter);
router.use("/bookings", bookingsRouter);
router.use("/payments", paymentsRouter);
router.use("/notifications", notificationsRouter);
router.use("/assistant", assistantRouter);
router.use("/staff", staffRouter);

// Admin routers
router.use("/admin/users", adminUsersRouter);
router.use("/admin/outlets", adminOutletsRouter);
router.use("/admin/categories", adminCategoriesRouter);
router.use("/admin/services", adminServicesRouter);
router.use("/admin/spareparts", adminSparepartsRouter);
router.use("/admin/reviews", adminReviewsRouter);
router.use("/admin/audit-logs", auditRouter);
router.use("/admin/dashboard", adminDashboardRouter);
router.use("/admin/reports", adminReportsRouter);

export default router;
