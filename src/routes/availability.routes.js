// ==============================================================================
// TALLERO AUTO — AVAILABILITY ROUTER
// Sesuai konvensi API AGENTS.md §2 & §9 (dipasang pada prefix /outlets)
// ==============================================================================

import { Router } from "express";
import authenticate from "../middlewares/authenticate.js";
import validate from "../middlewares/validate.js";
import { availabilityRateLimiter } from "../middlewares/rateLimit.js";
import { outletAvailabilitySchema } from "../validations/availability.validation.js";
import * as availabilityController from "../controllers/availability.controller.js";

export const availabilityRouter = Router();

// GET /api/v1/outlets/:id/availability
availabilityRouter.get(
  "/:id/availability",
  authenticate,
  availabilityRateLimiter,
  validate(outletAvailabilitySchema),
  availabilityController.getOutletAvailability
);

export default availabilityRouter;

