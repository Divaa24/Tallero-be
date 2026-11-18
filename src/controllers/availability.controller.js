// ==============================================================================
// TALLERO AUTO — AVAILABILITY CONTROLLER
// Controller tipis untuk endpoint ketersediaan slot (AGENTS.md §2 & §9)
// ==============================================================================

import * as availabilityService from "../services/availability.service.js";
import { sendSuccess } from "../utils/response.js";

/**
 * GET /api/v1/outlets/:id/availability?date=YYYY-MM-DD&serviceIds=1,2
 * Mengambil ketersediaan slot waktu operasional outlet
 */
export const getOutletAvailability = async (req, res) => {
  const data = await availabilityService.getOutletAvailability({
    outletId: req.valid.params.id,
    date: req.valid.query.date,
    serviceIds: req.valid.query.serviceIds,
  });

  return sendSuccess(res, { data });
};

export default {
  getOutletAvailability,
};

