// ==============================================================================
// TALLERO AUTO — PAYMENTS ROUTER
// Sesuai konvensi API AGENTS.md §2 & §9
// ==============================================================================

import { Router } from "express";
import { authenticate } from "../middlewares/authenticate.js";
import { validate } from "../middlewares/validate.js";
import paymentsController from "../controllers/payments.controller.js";
import { syncPaymentParamSchema } from "../validations/payments.validation.js";

export const paymentsRouter = Router();

/**
 * POST /api/v1/payments/midtrans/notification
 * Webhook notifikasi status pembayaran dari Midtrans (Publik, tanpa JWT)
 */
paymentsRouter.post("/midtrans/notification", paymentsController.handleNotification);

/**
 * POST /api/v1/payments/:orderId/sync
 * Sinkronisasi manual status transaksi dengan server Midtrans (Pemilik / Admin)
 */
paymentsRouter.post(
  "/:orderId/sync",
  authenticate,
  validate(syncPaymentParamSchema, "params"),
  paymentsController.syncPayment
);

export default paymentsRouter;
