// ==============================================================================
// TALLERO AUTO — PAYMENTS CONTROLLER
// Controller tipis untuk routing pembayaran, Snap token, Webhook, dan Invoice
// Sesuai aturan arsitektur AGENTS.md §2 (tanpa logika bisnis, tanpa Prisma langsung)
// ==============================================================================

import paymentsService from "../services/payments.service.js";
import { sendSuccess } from "../utils/response.js";

/**
 * POST /bookings/:id/payments/midtrans
 * Menginisialisasi sesi pembayaran Midtrans Snap untuk tagihan servis
 */
export const createMidtransPayment = async (req, res) => {
  const bookingId = req.valid.params.id;
  const result = await paymentsService.createMidtransInvoicePayment({
    actor: req.user,
    bookingId,
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: "Sesi pembayaran Midtrans Snap berhasil dibuat",
    data: result,
  });
};

/**
 * POST /bookings/:id/tips
 * Memberikan tip sukarela untuk mekanik penangan via Midtrans Snap
 */
export const createTip = async (req, res) => {
  const bookingId = req.valid.params.id;
  const { amount } = req.valid.body;
  const result = await paymentsService.createTipPayment({
    actor: req.user,
    bookingId,
    amount,
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: "Sesi pembayaran tip mekanik berhasil dibuat",
    data: result,
  });
};

/**
 * POST /bookings/:id/payments/cash
 * Kasir/Admin mencatat penerimaan uang tunai
 */
export const payCash = async (req, res) => {
  const bookingId = req.valid.params.id;
  const ip = req.ip || req.headers["x-forwarded-for"];
  const result = await paymentsService.payCash({
    actor: req.user,
    bookingId,
    ip,
  });

  return sendSuccess(res, {
    statusCode: 200,
    message: "Pembayaran tunai berhasil dicatat dan transaksi booking dinyatakan lunas",
    data: result,
  });
};

/**
 * POST /payments/midtrans/notification
 * Webhook notifikasi status dari server Midtrans
 */
export const handleNotification = async (req, res) => {
  const result = await paymentsService.handleMidtransNotification(req.body);

  return sendSuccess(res, {
    statusCode: 200,
    message: "Notifikasi pembayaran Midtrans berhasil diproses",
    data: result,
  });
};

/**
 * POST /payments/:orderId/sync
 * Tarik status resmi transaksi dari Midtrans secara manual
 */
export const syncPayment = async (req, res) => {
  const { orderId } = req.valid.params;
  const result = await paymentsService.syncPaymentStatus({
    actor: req.user,
    orderId,
  });

  return sendSuccess(res, {
    statusCode: 200,
    message: "Status transaksi berhasil disinkronisasi dari Midtrans",
    data: result,
  });
};

/**
 * GET /bookings/:id/payments
 * Melihat riwayat pembayaran pada suatu booking
 */
export const listPayments = async (req, res) => {
  const bookingId = req.valid.params.id;
  const result = await paymentsService.listBookingPayments({
    actor: req.user,
    bookingId,
  });

  return sendSuccess(res, {
    statusCode: 200,
    message: "Riwayat pembayaran booking berhasil diambil",
    data: result,
  });
};

/**
 * GET /bookings/:id/invoice.pdf
 * Mengunduh dokumen faktur resmi dalam format PDF
 */
export const downloadInvoicePdf = async (req, res) => {
  const bookingId = req.valid.params.id;
  await paymentsService.generateInvoicePdf({
    actor: req.user,
    bookingId,
    res,
  });
};

export default {
  createMidtransPayment,
  createTip,
  payCash,
  handleNotification,
  syncPayment,
  listPayments,
  downloadInvoicePdf,
};
