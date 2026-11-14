// ==============================================================================
// TALLERO AUTO — REPORTS & DASHBOARD ROUTES
// Sesuai AGENTS.md §2, §6, §9 (Admin only)
// ==============================================================================

import { Router } from "express";
import authenticate from "../middlewares/authenticate.js";
import authorize from "../middlewares/authorize.js";
import validate from "../middlewares/validate.js";
import {
  dashboardQuerySchema,
  reportsSummaryQuerySchema,
  reportsExportQuerySchema,
} from "../validations/reports.validation.js";
import * as reportsController from "../controllers/reports.controller.js";

export const adminDashboardRouter = Router();
export const adminReportsRouter = Router();

// Semua rute dashboard dan laporan wajib terautentikasi dan hanya dapat diakses ADMIN
adminDashboardRouter.use(authenticate, authorize("ADMIN"));
adminReportsRouter.use(authenticate, authorize("ADMIN"));

// GET /api/v1/admin/dashboard
adminDashboardRouter.get(
  "/",
  validate(dashboardQuerySchema, "query"),
  reportsController.getDashboard
);

// GET /api/v1/admin/reports/summary
adminReportsRouter.get(
  "/summary",
  validate(reportsSummaryQuerySchema, "query"),
  reportsController.getSummary
);

// GET /api/v1/admin/reports/export
adminReportsRouter.get(
  "/export",
  validate(reportsExportQuerySchema, "query"),
  reportsController.exportData
);

export default {
  adminDashboardRouter,
  adminReportsRouter,
};

