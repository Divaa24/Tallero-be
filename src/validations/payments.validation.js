// ==============================================================================
// TALLERO AUTO — PAYMENTS VALIDATION SCHEMAS (ZOD)
// Sesuai konvensi API AGENTS.md §3 dan aturan bisnis §8
// ==============================================================================

import { z } from "zod";
import RULES from "../config/rules.js";

/**
 * Validasi parameter ID booking
 */
export const bookingIdParamSchema = z
  .object({
    id: z.coerce.number().int().positive("ID booking harus berupa bilangan bulat positif"),
  })
  .strict();

/**
 * Validasi pembuatan tip sukarela untuk mekanik
 * POST /bookings/:id/tips
 */
export const createTipSchema = z
  .object({
    amount: z
      .number({
        required_error: "Nominal tip wajib diisi",
        invalid_type_error: "Nominal tip harus berupa angka",
      })
      .int("Nominal tip harus berupa bilangan bulat (Rupiah)")
      .min(RULES.TIP_MIN, `Minimal tip adalah Rp ${RULES.TIP_MIN.toLocaleString("id-ID")}`)
      .max(
        RULES.TIP_MAX_PER_TRANSACTION,
        `Maksimal tip per transaksi adalah Rp ${RULES.TIP_MAX_PER_TRANSACTION.toLocaleString("id-ID")}`
      ),
  })
  .strict();

/**
 * Validasi sinkronisasi status pembayaran dari Midtrans
 * POST /payments/:orderId/sync
 */
export const syncPaymentParamSchema = z
  .object({
    orderId: z
      .string()
      .trim()
      .min(1, "Order ID tidak boleh kosong")
      .max(60, "Order ID maksimal 60 karakter"),
  })
  .strict();

/**
 * Validasi penyelesaian transaksi booking oleh Admin
 * POST /bookings/:id/complete
 */
export const completeBookingSchema = z
  .object({
    note: z.string().trim().max(500, "Catatan penyelesaian maksimal 500 karakter").optional(),
  })
  .strict();

export default {
  bookingIdParamSchema,
  createTipSchema,
  syncPaymentParamSchema,
  completeBookingSchema,
};
