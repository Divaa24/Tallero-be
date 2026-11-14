// ==============================================================================
// TALLERO AUTO — ASSISTANT ROUTER
// Sesuai konvensi API AGENTS.md §2 & §9
// ==============================================================================

import { Router } from "express";
import { authenticate } from "../middlewares/authenticate.js";
import { authorize } from "../middlewares/authorize.js";
import { validate } from "../middlewares/validate.js";
import { assistantRateLimiter } from "../middlewares/rateLimit.js";
import assistantController from "../controllers/assistant.controller.js";
import { assistantQuerySchema } from "../validations/assistant.validation.js";

export const assistantRouter = Router();

assistantRouter.use(authenticate, authorize("CUSTOMER"));

/**
 * GET /api/v1/assistant/menu
 * Mengambil menu intent cepat yang tersedia
 */
assistantRouter.get("/menu", assistantController.getMenu);

/**
 * POST /api/v1/assistant/query
 * Mengeksekusi query deterministik berbasis intent terpilih
 */
assistantRouter.post(
  "/query",
  assistantRateLimiter,
  validate(assistantQuerySchema, "body"),
  assistantController.queryAssistant
);

export default assistantRouter;
