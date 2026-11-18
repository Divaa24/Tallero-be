// ==============================================================================
// TALLERO AUTO — PAYMENT SYNC BACKGROUND JOB
// Menyinkronkan status pembayaran Midtrans berstatus PENDING setiap 5 menit
// Sesuai aturan pekerjaan latar belakang AGENTS.md §1 & §4
// ==============================================================================

import prisma from "../config/prisma.js";
import logger from "../config/logger.js";
import midtransService from "../services/midtrans.service.js";
import paymentsService from "../services/payments.service.js";

/**
 * Menjalankan sinkronisasi pembayaran aktif berstatus PENDING dari server Midtrans
 * @returns {Promise<{processed: number, updated: number}>}
 */
export const runPaymentSync = async () => {
  const now = new Date();

  // Ambil pembayaran Midtrans PENDING yang belum kedaluwarsa (expiresAt > now atau created dalam 24 jam terakhir)
  const pendingPayments = await prisma.payment.findMany({
    where: {
      method: "MIDTRANS",
      status: "PENDING",
      createdAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
    },
    take: 50,
    orderBy: { createdAt: "asc" },
  });

  if (pendingPayments.length === 0) {
    logger.debug("Tidak ada pembayaran Midtrans PENDING yang memerlukan sinkronisasi");
    return { processed: 0, updated: 0 };
  }

  logger.info(
    { count: pendingPayments.length },
    "Memulai sinkronisasi pembayaran PENDING dari Midtrans..."
  );

  let updatedCount = 0;

  for (const payment of pendingPayments) {
    try {
      const statusRes = await midtransService.getStatus(payment.orderId);

      // Jika status di Midtrans bukan lagi 'pending', lakukan pembaruan via handler
      if (statusRes.transaction_status && statusRes.transaction_status !== "pending") {
        await paymentsService.handleMidtransNotification({
          order_id: statusRes.order_id,
          status_code: statusRes.status_code,
          gross_amount: statusRes.gross_amount,
          signature_key: statusRes.signature_key,
        });
        updatedCount++;
      }
    } catch (err) {
      logger.warn(
        { err: err.message, orderId: payment.orderId, paymentId: payment.id },
        "Gagal menyinkronkan status pembayaran dari Midtrans (diabaikan)"
      );
    }
  }

  logger.info(
    { processed: pendingPayments.length, updated: updatedCount },
    "Sinkronisasi pembayaran Midtrans selesai"
  );

  return { processed: pendingPayments.length, updated: updatedCount };
};

export default {
  runPaymentSync,
};
