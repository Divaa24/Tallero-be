// ==============================================================================
// TALLERO AUTO — REPORTS & DASHBOARD CONTROLLER
// Sesuai AGENTS.md §2 (Controller tipis, delegasikan ke service)
// ==============================================================================

import { sendSuccess } from "../utils/response.js";
import * as reportsService from "../services/reports.service.js";

/**
 * GET /api/v1/admin/dashboard
 */
export const getDashboard = async (req, res) => {
  const data = await reportsService.getDashboardMetrics({
    outletId: req.valid.query.outletId,
    range: req.valid.query.range,
  });
  return sendSuccess(res, { data });
};

/**
 * GET /api/v1/admin/reports/summary
 */
export const getSummary = async (req, res) => {
  const data = await reportsService.getReportsSummary({
    from: req.valid.query.from,
    to: req.valid.query.to,
    outletId: req.valid.query.outletId,
  });
  return sendSuccess(res, { data });
};

/**
 * GET /api/v1/admin/reports/export
 */
export const exportData = async (req, res) => {
  return reportsService.exportReport({
    type: req.valid.query.type,
    format: req.valid.query.format,
    from: req.valid.query.from,
    to: req.valid.query.to,
    outletId: req.valid.query.outletId,
    res,
    actor: req.user,
    ip: req.ip,
  });
};

export default {
  getDashboard,
  getSummary,
  exportData,
};

