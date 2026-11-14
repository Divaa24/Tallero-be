// ==============================================================================
// TALLERO AUTO — PAYMENTS SERVICE
// Mengatur alur Midtrans Snap, Webhook, Kasir Cash, Tips, dan Invoice PDF
// Sesuai aturan keamanan AGENTS.md §4, §6, §8 dan arsitektur §2
// ==============================================================================

import crypto from "node:crypto";
import { DateTime } from "luxon";
import PDFDocument from "pdfkit";
import prisma from "../config/prisma.js";
import logger from "../config/logger.js";
import RULES from "../config/rules.js";
import { emitRealtimeEvent } from "./realtime.service.js";
import midtransService from "./midtrans.service.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  BusinessRuleError,
} from "../utils/errors.js";

/**
 * Prisma select standar untuk Payment (tanpa membocorkan rawNotification ke client)
 */
export const publicPaymentSelect = {
  id: true,
  bookingId: true,
  type: true,
  method: true,
  orderId: true,
  amount: true,
  status: true,
  snapToken: true,
  redirectUrl: true,
  midtransTransactionId: true,
  midtransPaymentType: true,
  expiresAt: true,
  paidAt: true,
  receivedById: true,
  recipientMechanicId: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * Menghasilkan nomor faktur unik dengan format INV-YYYYMM-NNNNNN
 * Dialokasikan saat booking lunas (PAID)
 * @param {object} tx - Prisma transaction client
 * @returns {Promise<string>}
 */
export const generateInvoiceNumber = async (tx) => {
  const yyyymm = DateTime.now().setZone(RULES.TIMEZONE).toFormat("yyyyMM");
  const prefix = `INV-${yyyymm}-`;

  const latest = await tx.booking.findFirst({
    where: {
      invoiceNumber: {
        startsWith: prefix,
      },
    },
    orderBy: {
      invoiceNumber: "desc",
    },
    select: {
      invoiceNumber: true,
    },
  });

  let nextSequence = 1;
  if (latest?.invoiceNumber) {
    const parts = latest.invoiceNumber.split("-");
    const numPart = parseInt(parts[2], 10);
    if (!Number.isNaN(numPart)) {
      nextSequence = numPart + 1;
    }
  }

  return `${prefix}${String(nextSequence).padStart(6, "0")}`;
};

/**
 * POST /bookings/:id/payments/midtrans (INVOICE)
 * Membuat sesi pembayaran Midtrans Snap untuk pelunasan tagihan servis
 */
export const createMidtransInvoicePayment = async ({ actor, bookingId }) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      items: {
        where: { approvalStatus: "APPROVED" },
        select: { id: true, nameSnapshot: true, unitPrice: true, quantity: true, subtotal: true },
      },
    },
  });

  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  // IDOR & otorisasi scope
  if (actor.role === "CUSTOMER" && booking.customerId !== actor.id) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }
  if (actor.role === "MECHANIC") {
    throw new ForbiddenError(
      "Mekanik tidak berwenang menginisiasi pembayaran pelanggan",
      "FORBIDDEN"
    );
  }

  // Guard status booking
  if (booking.status !== "READY_FOR_PICKUP") {
    throw new ConflictError(
      `Pembayaran hanya dapat dilakukan saat kendaraan siap diambil (READY_FOR_PICKUP). Status saat ini: ${booking.status}`,
      "INVALID_BOOKING_STATUS"
    );
  }

  if (booking.paymentStatus === "PAID") {
    throw new ConflictError("Tagihan booking ini sudah lunas (PAID)", "BOOKING_ALREADY_PAID");
  }

  // Hitung total dari snapshot APPROVED
  const calculatedTotal = booking.items.reduce((sum, item) => sum + item.subtotal, 0);
  const finalAmount = calculatedTotal > 0 ? calculatedTotal : booking.total;

  if (finalAmount <= 0) {
    throw new BadRequestError(
      "Total tagihan servis tidak valid (nol atau negatif)",
      "INVALID_TOTAL_AMOUNT"
    );
  }

  // Batalkan percobaan PENDING sebelumnya pada booking ini (best-effort)
  const priorPendingPayments = await prisma.payment.findMany({
    where: {
      bookingId: booking.id,
      type: "INVOICE",
      status: "PENDING",
    },
  });

  for (const prior of priorPendingPayments) {
    await midtransService.cancel(prior.orderId);
    await prisma.payment.update({
      where: { id: prior.id },
      data: { status: "CANCELLED" },
    });
  }

  // Susun nomor order yang unik dan <= 50 karakter
  const invoiceAttemptCount = await prisma.payment.count({
    where: { bookingId: booking.id, type: "INVOICE" },
  });
  const randomSuffix = crypto.randomInt(1000, 9999);
  const orderId = `${booking.code}-INV-${invoiceAttemptCount + 1}-${randomSuffix}`;

  // Susun item_details persis sama dengan total (syarat Midtrans gross_amount === sum(items))
  const itemDetails = booking.items.map((it) => ({
    id: String(it.id).slice(0, 50),
    price: it.unitPrice,
    quantity: it.quantity,
    name: it.nameSnapshot.slice(0, 50),
  }));

  // Customer details
  const nameParts = booking.customer.name.trim().split(" ");
  const firstName = nameParts[0] || "Pelanggan";
  const lastName = nameParts.slice(1).join(" ") || undefined;

  const expiresAt = new Date(Date.now() + RULES.PAYMENT_EXPIRY_MIN * 60 * 1000);

  // Panggil Snap API
  const snapResult = await midtransService.createSnapTransaction({
    orderId,
    amount: finalAmount,
    itemDetails,
    customerDetails: {
      firstName,
      lastName,
      email: booking.customer.email,
      phone: booking.customer.phone || undefined,
    },
    expiryDurationMinutes: RULES.PAYMENT_EXPIRY_MIN,
  });

  // Simpan record Payment baru
  const payment = await prisma.payment.create({
    data: {
      bookingId: booking.id,
      type: "INVOICE",
      method: "MIDTRANS",
      orderId,
      amount: finalAmount,
      status: "PENDING",
      snapToken: snapResult.token,
      redirectUrl: snapResult.redirectUrl,
      expiresAt,
    },
    select: publicPaymentSelect,
  });

  return {
    snapToken: snapResult.token,
    redirectUrl: snapResult.redirectUrl,
    orderId,
    amount: finalAmount,
    expiresAt,
    payment,
  };
};

/**
 * POST /bookings/:id/tips (TIP)
 * Memberikan tip sukarela kepada mekanik penangan via Midtrans Snap
 */
export const createTipPayment = async ({ actor, bookingId, amount }) => {
  if (actor.role !== "CUSTOMER") {
    throw new ForbiddenError(
      "Hanya pelanggan yang dapat memberikan tip untuk mekanik",
      "FORBIDDEN"
    );
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      mechanic: { select: { id: true, name: true } },
    },
  });

  if (!booking || booking.customerId !== actor.id) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  if (!booking.mechanicId) {
    throw new BusinessRuleError(
      "Booking ini belum atau tidak ditugaskan ke mekanik manapun",
      "MECHANIC_NOT_ASSIGNED"
    );
  }

  if (booking.status !== "READY_FOR_PICKUP" && booking.status !== "COMPLETED") {
    throw new ConflictError(
      `Tip hanya dapat diberikan saat kendaraan siap diambil atau selesai diservis. Status saat ini: ${booking.status}`,
      "INVALID_BOOKING_STATUS"
    );
  }

  // Batas jendela waktu pemberian tip (7 hari setelah selesai)
  const referenceTime = booking.completedAt || booking.readyAt || booking.updatedAt;
  const elapsedDays = (Date.now() - new Date(referenceTime).getTime()) / (1000 * 60 * 60 * 24);
  if (elapsedDays > RULES.TIP_WINDOW_DAYS) {
    throw new BusinessRuleError(
      `Batas waktu pemberian tip telah kedaluwarsa (${RULES.TIP_WINDOW_DAYS} hari setelah servis)`,
      "TIP_WINDOW_EXPIRED"
    );
  }

  if (amount < RULES.TIP_MIN || amount > RULES.TIP_MAX_PER_TRANSACTION) {
    throw new BadRequestError(
      `Nominal tip harus berada di antara Rp ${RULES.TIP_MIN.toLocaleString("id-ID")} dan Rp ${RULES.TIP_MAX_PER_TRANSACTION.toLocaleString("id-ID")}`,
      "INVALID_TIP_AMOUNT"
    );
  }

  const tipAttemptCount = await prisma.payment.count({
    where: { bookingId: booking.id, type: "TIP" },
  });
  const randomSuffix = crypto.randomInt(1000, 9999);
  const orderId = `${booking.code}-TIP-${tipAttemptCount + 1}-${randomSuffix}`;

  const itemDetails = [
    {
      id: "TIP",
      price: amount,
      quantity: 1,
      name: `Tip Mekanik - ${booking.mechanic.name}`.slice(0, 50),
    },
  ];

  const nameParts = booking.customer.name.trim().split(" ");
  const snapResult = await midtransService.createSnapTransaction({
    orderId,
    amount,
    itemDetails,
    customerDetails: {
      firstName: nameParts[0] || "Pelanggan",
      lastName: nameParts.slice(1).join(" ") || undefined,
      email: booking.customer.email,
      phone: booking.customer.phone || undefined,
    },
    expiryDurationMinutes: RULES.PAYMENT_EXPIRY_MIN,
  });

  const expiresAt = new Date(Date.now() + RULES.PAYMENT_EXPIRY_MIN * 60 * 1000);

  const payment = await prisma.payment.create({
    data: {
      bookingId: booking.id,
      type: "TIP",
      method: "MIDTRANS",
      orderId,
      amount,
      status: "PENDING",
      snapToken: snapResult.token,
      redirectUrl: snapResult.redirectUrl,
      recipientMechanicId: booking.mechanicId,
      expiresAt,
    },
    select: publicPaymentSelect,
  });

  return {
    snapToken: snapResult.token,
    redirectUrl: snapResult.redirectUrl,
    orderId,
    amount,
    expiresAt,
    payment,
  };
};

/**
 * POST /bookings/:id/payments/cash
 * Kasir/Admin mencatat penerimaan pembayaran tunai untuk booking
 */
export const payCash = async ({ actor, bookingId, ip }) => {
  if (actor.role !== "ADMIN") {
    throw new ForbiddenError(
      "Hanya admin atau kasir yang dapat mencatat pembayaran tunai",
      "FORBIDDEN"
    );
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      items: {
        where: { approvalStatus: "APPROVED" },
        select: { subtotal: true },
      },
    },
  });

  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  if (booking.status !== "READY_FOR_PICKUP") {
    throw new ConflictError(
      `Pembayaran kasir hanya dapat diproses saat kendaraan siap diambil (READY_FOR_PICKUP). Status saat ini: ${booking.status}`,
      "INVALID_BOOKING_STATUS"
    );
  }

  if (booking.paymentStatus === "PAID") {
    throw new ConflictError("Booking ini telah lunas dibayar (PAID)", "BOOKING_ALREADY_PAID");
  }

  // Hitung total resmi
  const calculatedTotal = booking.items.reduce((sum, item) => sum + item.subtotal, 0);
  const finalAmount = calculatedTotal > 0 ? calculatedTotal : booking.total;

  // Batalkan percobaan Snap pending yang pernah dibuat
  const priorPending = await prisma.payment.findMany({
    where: { bookingId: booking.id, type: "INVOICE", status: "PENDING" },
  });

  for (const p of priorPending) {
    await midtransService.cancel(p.orderId);
  }

  const orderId = `${booking.code}-CASH-${Date.now().toString().slice(-6)}`;
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // Batalkan di DB
    await tx.payment.updateMany({
      where: { bookingId: booking.id, type: "INVOICE", status: "PENDING" },
      data: { status: "CANCELLED" },
    });

    const invoiceNumber = booking.invoiceNumber || (await generateInvoiceNumber(tx));

    const payment = await tx.payment.create({
      data: {
        bookingId: booking.id,
        type: "INVOICE",
        method: "CASH",
        orderId,
        amount: finalAmount,
        status: "PAID",
        receivedById: actor.id,
        paidAt: now,
      },
      select: publicPaymentSelect,
    });

    const updatedBooking = await tx.booking.update({
      where: { id: booking.id },
      data: {
        paymentStatus: "PAID",
        invoiceNumber,
        total: finalAmount,
      },
      include: {
        customer: { select: { id: true, name: true, email: true } },
      },
    });

    // Catat AuditLog
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "PAYMENT_CASH_RECEIVED",
        entity: "Booking",
        entityId: String(booking.id),
        after: {
          paymentId: payment.id,
          amount: finalAmount,
          receivedById: actor.id,
          invoiceNumber,
        },
        ip,
      },
    });

    // Notifikasi customer
    await tx.notification.create({
      data: {
        userId: booking.customerId,
        type: "PAYMENT",
        title: "Pembayaran Tunai Diterima",
        body: `Pembayaran tunai tagihan servis booking ${booking.code} sebesar Rp ${finalAmount.toLocaleString("id-ID")} telah diterima oleh kasir.`,
        data: { bookingId: booking.id, paymentId: payment.id, invoiceNumber },
      },
    });

    return { payment, booking: updatedBooking, invoiceNumber };
  });

  emitRealtimeEvent(
    "payment:updated",
    { bookingId: booking.id, paymentId: result.payment.id, status: "PAID" },
    [`user:${booking.customerId}`, `outlet:${booking.outletId}:staff`, "admin"]
  );

  return result;
};

/**
 * Webhook handler notifikasi resmi dari Midtrans
 * Memproses status settlement, idempotency, duplikasi bayar, dan refund manual alert
 * @param {object} payload - Body notifikasi JSON Midtrans
 */
export const handleMidtransNotification = async (payload) => {
  const {
    order_id: orderId,
    status_code: statusCode,
    gross_amount: grossAmount,
    signature_key: signatureKey,
  } = payload || {};

  // 1. Verifikasi signature_key timing-safe
  const isSignatureValid = midtransService.verifySignature({
    orderId,
    statusCode,
    grossAmount,
    signatureKey,
  });

  if (!isSignatureValid) {
    logger.warn({ orderId, statusCode }, "Tanda tangan notifikasi webhook Midtrans tidak valid");
    throw new ForbiddenError("Verifikasi tanda tangan webhook Midtrans gagal", "INVALID_SIGNATURE");
  }

  // 2. Ambil status resmi transaksi dari Status API Midtrans
  const verifiedStatus = await midtransService.getStatus(orderId);

  // 3. Cocokkan order_id di DB dan jumlah gross_amount
  const existingPayment = await prisma.payment.findUnique({
    where: { orderId },
    include: { booking: true },
  });

  if (!existingPayment) {
    logger.warn({ orderId }, "Order ID webhook tidak ditemukan di database");
    throw new NotFoundError("Order ID transaksi tidak ditemukan", "PAYMENT_NOT_FOUND");
  }

  const expectedAmount = existingPayment.amount;
  const actualAmount = Math.round(Number(verifiedStatus.gross_amount));

  if (expectedAmount !== actualAmount) {
    logger.error(
      { expectedAmount, actualAmount, orderId },
      "Jumlah pembayaran notifikasi tidak sesuai dengan tagihan di database"
    );
    throw new BadRequestError(
      "Jumlah pembayaran tidak cocok dengan nominal tercatat",
      "AMOUNT_MISMATCH"
    );
  }

  // 4. Petakan status Midtrans ke enum internal PaymentStatus
  const txStatus = verifiedStatus.transaction_status;
  const fraudStatus = verifiedStatus.fraud_status;

  let mappedStatus = "PENDING";
  if (txStatus === "capture") {
    mappedStatus = fraudStatus === "accept" ? "PAID" : "FAILED";
  } else if (txStatus === "settlement") {
    mappedStatus = "PAID";
  } else if (txStatus === "pending") {
    mappedStatus = "PENDING";
  } else if (txStatus === "deny" || txStatus === "failure") {
    mappedStatus = "FAILED";
  } else if (txStatus === "cancel") {
    mappedStatus = "CANCELLED";
  } else if (txStatus === "expire") {
    mappedStatus = "EXPIRED";
  } else if (txStatus === "refund") {
    mappedStatus = "REFUNDED";
  }

  // 5. Aturan non-downgrade status (urutan terbalik: settlement mendahului pending)
  const terminalStatuses = ["PAID", "DUPLICATE", "REFUNDED"];
  if (terminalStatuses.includes(existingPayment.status) && mappedStatus === "PENDING") {
    logger.info(
      { orderId, current: existingPayment.status, incoming: mappedStatus },
      "Mengabaikan status pending yang datang terlambat setelah pembayaran selesai"
    );
    return { success: true, message: "Ignored pending downgrade", status: existingPayment.status };
  }

  // Idempotency: jika status sama dan sudah PAID
  if (existingPayment.status === mappedStatus && mappedStatus === "PAID") {
    logger.info({ orderId }, "Notifikasi pembayaran ganda/idempotent diabaikan (sudah PAID)");
    return { success: true, message: "Already processed", status: existingPayment.status };
  }

  // 6. Transaksi update status, penanganan duplikasi, dan alokasi invoice
  const result = await prisma.$transaction(async (tx) => {
    const currentPayment = await tx.payment.findUnique({
      where: { id: existingPayment.id },
      include: { booking: true },
    });
    const booking = currentPayment.booking;

    // A. Pembayaran INVOICE
    if (currentPayment.type === "INVOICE") {
      if (mappedStatus === "PAID") {
        // Cek apakah booking sudah dilunasi oleh transaksi lain
        if (booking.paymentStatus === "PAID" && currentPayment.status !== "PAID") {
          // DUPLICATE PAYMENT DETECTED!
          const dupPayment = await tx.payment.update({
            where: { id: currentPayment.id },
            data: {
              status: "DUPLICATE",
              paidAt: new Date(),
              midtransTransactionId: verifiedStatus.transaction_id,
              midtransPaymentType: verifiedStatus.payment_type,
              rawNotification: payload,
            },
          });

          await tx.auditLog.create({
            data: {
              action: "DUPLICATE_PAYMENT_DETECTED",
              entity: "Payment",
              entityId: String(dupPayment.id),
              after: {
                orderId: dupPayment.orderId,
                amount: dupPayment.amount,
                bookingId: booking.id,
                transactionId: verifiedStatus.transaction_id,
              },
            },
          });

          // Notifikasi admin untuk refund manual
          const admins = await tx.user.findMany({
            where: { role: "ADMIN", isActive: true, deletedAt: null },
            select: { id: true },
          });

          for (const admin of admins) {
            await tx.notification.create({
              data: {
                userId: admin.id,
                type: "SYSTEM",
                title: "Duplikat Pembayaran Terdeteksi",
                body: `Terdeteksi pembayaran ganda pada booking ${booking.code} (Order ID: ${dupPayment.orderId}) sebesar Rp ${dupPayment.amount.toLocaleString("id-ID")}. Silakan proses refund manual via Midtrans Portal.`,
                data: {
                  bookingId: booking.id,
                  paymentId: dupPayment.id,
                  orderId: dupPayment.orderId,
                },
              },
            });
          }

          return { payment: dupPayment, isDuplicate: true };
        }

        // Pembayaran invoice normal (pelunasan pertama)
        const invoiceNumber = booking.invoiceNumber || (await generateInvoiceNumber(tx));

        const updatedPayment = await tx.payment.update({
          where: { id: currentPayment.id },
          data: {
            status: "PAID",
            paidAt: new Date(),
            midtransTransactionId: verifiedStatus.transaction_id,
            midtransPaymentType: verifiedStatus.payment_type,
            rawNotification: payload,
          },
        });

        await tx.booking.update({
          where: { id: booking.id },
          data: {
            paymentStatus: "PAID",
            invoiceNumber,
          },
        });

        // Notifikasi customer
        await tx.notification.create({
          data: {
            userId: booking.customerId,
            type: "PAYMENT",
            title: "Pembayaran Berhasil",
            body: `Pembayaran online tagihan servis booking ${booking.code} sebesar Rp ${updatedPayment.amount.toLocaleString("id-ID")} telah berhasil diterima.`,
            data: {
              bookingId: booking.id,
              paymentId: updatedPayment.id,
              invoiceNumber,
            },
          },
        });

        return { payment: updatedPayment, isDuplicate: false, invoiceNumber };
      }

      // Status invoice selain PAID (EXPIRED, CANCELLED, FAILED)
      const updatedPayment = await tx.payment.update({
        where: { id: currentPayment.id },
        data: {
          status: mappedStatus,
          rawNotification: payload,
        },
      });

      return { payment: updatedPayment, isDuplicate: false };
    }

    // B. Pembayaran TIP
    if (currentPayment.type === "TIP") {
      const updateData = {
        status: mappedStatus,
        rawNotification: payload,
      };

      if (mappedStatus === "PAID") {
        updateData.paidAt = new Date();
        updateData.midtransTransactionId = verifiedStatus.transaction_id;
        updateData.midtransPaymentType = verifiedStatus.payment_type;

        if (currentPayment.recipientMechanicId) {
          await tx.notification.create({
            data: {
              userId: currentPayment.recipientMechanicId,
              type: "PAYMENT",
              title: "Tip Diterima",
              body: `Anda menerima tip sebesar Rp ${currentPayment.amount.toLocaleString("id-ID")} dari pelanggan untuk servis ${booking.code}.`,
              data: {
                bookingId: booking.id,
                paymentId: currentPayment.id,
              },
            },
          });
        }
      }

      const updatedPayment = await tx.payment.update({
        where: { id: currentPayment.id },
        data: updateData,
      });

      return { payment: updatedPayment, isDuplicate: false };
    }

    return { payment: currentPayment, isDuplicate: false };
  });

  // Emit event socket setelah commit
  emitRealtimeEvent(
    "payment:updated",
    {
      bookingId: existingPayment.bookingId,
      paymentId: result.payment.id,
      status: result.payment.status,
    },
    [
      `user:${existingPayment.booking.customerId}`,
      `outlet:${existingPayment.booking.outletId}:staff`,
      "admin",
    ]
  );

  return {
    success: true,
    status: result.payment.status,
    duplicate: result.isDuplicate,
  };
};

/**
 * POST /payments/:orderId/sync
 * Menarik status resmi transaksi dari Midtrans secara manual (fallback jika webhook terlambat)
 */
export const syncPaymentStatus = async ({ actor, orderId }) => {
  const payment = await prisma.payment.findUnique({
    where: { orderId },
    include: { booking: true },
  });

  if (!payment) {
    throw new NotFoundError("Data pembayaran tidak ditemukan", "PAYMENT_NOT_FOUND");
  }

  // Otorisasi: pemilik booking atau ADMIN
  if (actor.role === "CUSTOMER" && payment.booking.customerId !== actor.id) {
    throw new NotFoundError("Data pembayaran tidak ditemukan", "PAYMENT_NOT_FOUND");
  }

  // Tarik status dari Midtrans
  const verifiedStatus = await midtransService.getStatus(orderId);

  // Buat payload simulasi webhook resmi dan proses menggunakan handler webhook
  const syntheticPayload = {
    order_id: verifiedStatus.order_id,
    status_code: verifiedStatus.status_code,
    gross_amount: verifiedStatus.gross_amount,
    signature_key: verifiedStatus.signature_key,
  };

  await handleMidtransNotification(syntheticPayload);

  return prisma.payment.findUnique({
    where: { id: payment.id },
    select: publicPaymentSelect,
  });
};

/**
 * GET /bookings/:id/payments
 * Melihat seluruh riwayat transaksi pembayaran pada booking (tanpa membocorkan rawNotification)
 */
export const listBookingPayments = async ({ actor, bookingId }) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, customerId: true, outletId: true },
  });

  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  if (actor.role === "CUSTOMER" && booking.customerId !== actor.id) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  const payments = await prisma.payment.findMany({
    where: { bookingId },
    select: publicPaymentSelect,
    orderBy: { createdAt: "desc" },
  });

  return payments;
};

/**
 * GET /bookings/:id/invoice.pdf
 * Menghasilkan faktur/invoice PDF resmi dengan PDFKit untuk booking yang sudah lunas (PAID)
 */
export const generateInvoicePdf = async ({ actor, bookingId, res }) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      outlet: { select: { id: true, name: true, address: true, phone: true } },
      vehicle: {
        select: {
          id: true,
          plateNumber: true,
          brand: true,
          model: true,
          type: true,
          year: true,
          lastOdometerKm: true,
        },
      },
      items: {
        where: { approvalStatus: "APPROVED" },
        select: {
          id: true,
          type: true,
          nameSnapshot: true,
          unitPrice: true,
          quantity: true,
          subtotal: true,
        },
      },
      payments: {
        where: { type: "INVOICE", status: "PAID" },
        orderBy: { paidAt: "desc" },
        take: 1,
      },
    },
  });

  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  if (actor.role === "CUSTOMER" && booking.customerId !== actor.id) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  // Guard status pelunasan: hanya bila PAID
  if (booking.paymentStatus !== "PAID") {
    throw new ConflictError(
      "Faktur hanya dapat diunduh untuk booking yang telah lunas (PAID)",
      "BOOKING_NOT_PAID"
    );
  }

  const paidPayment = booking.payments[0];
  const paidDate = paidPayment?.paidAt
    ? DateTime.fromJSDate(paidPayment.paidAt)
        .setZone(RULES.TIMEZONE)
        .toFormat("dd LLL yyyy, HH:mm 'WIB'")
    : "-";
  const paymentMethod =
    paidPayment?.method === "CASH"
      ? "Tunai (Kasir)"
      : `Midtrans (${paidPayment?.midtransPaymentType || "Online"})`;

  const invoiceNumber = booking.invoiceNumber || `INV-${booking.code.replace(/^TLR-/, "")}`;

  // Siapkan header response HTTP untuk streaming file PDF
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="invoice-${invoiceNumber}.pdf"`);

  const doc = new PDFDocument({ margin: 40, size: "A4" });
  doc.pipe(res);

  // 1. Header Bengkel
  doc.fontSize(18).font("Helvetica-Bold").text("TALLERO AUTO WORKSHOP", { align: "left" });

  doc
    .fontSize(10)
    .font("Helvetica")
    .text(`Outlet: ${booking.outlet.name}`, { align: "left" })
    .text(`Alamat: ${booking.outlet.address}`, { align: "left" })
    .text(`Telepon: ${booking.outlet.phone || "-"}`, { align: "left" });

  doc.moveDown(0.5);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#cccccc").stroke();
  doc.moveDown(0.8);

  // 2. Info Faktur
  doc.fontSize(14).font("Helvetica-Bold").text("FAKTUR RESMI PEMBAYARAN", { align: "center" });
  doc.moveDown(0.5);

  const startY = doc.y;
  doc.fontSize(9).font("Helvetica");

  // Kolom Kiri: Detail Pelanggan & Kendaraan
  doc.text(`No. Faktur      : ${invoiceNumber}`, 40, startY);
  doc.text(`Kode Booking    : ${booking.code}`, 40, startY + 14);
  doc.text(`Pelanggan       : ${booking.customer.name}`, 40, startY + 28);
  doc.text(`Telepon         : ${booking.customer.phone || "-"}`, 40, startY + 42);
  doc.text(
    `Kendaraan       : ${booking.vehicle.brand} ${booking.vehicle.model} (${booking.vehicle.year})`,
    40,
    startY + 56
  );
  doc.text(`No. Polisi      : ${booking.vehicle.plateNumber}`, 40, startY + 70);

  // Kolom Kanan: Detail Pembayaran
  doc.text(`Status          : LUNAS (PAID)`, 330, startY);
  doc.text(`Metode Bayar    : ${paymentMethod}`, 330, startY + 14);
  doc.text(`Tanggal Bayar   : ${paidDate}`, 330, startY + 28);
  doc.text(
    `Odometer        : ${booking.odometerKm || booking.vehicle.lastOdometerKm || "-"} KM`,
    330,
    startY + 42
  );

  doc.y = startY + 95;

  // 3. Tabel Item Pekerjaan
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#333333").stroke();
  doc.moveDown(0.3);

  const tableTop = doc.y;
  doc.fontSize(9).font("Helvetica-Bold");
  doc.text("No", 45, tableTop);
  doc.text("Deskripsi Layanan / Suku Cadang", 75, tableTop);
  doc.text("Tipe", 310, tableTop);
  doc.text("Qty", 365, tableTop, { width: 30, align: "right" });
  doc.text("Harga Satuan", 405, tableTop, { width: 65, align: "right" });
  doc.text("Subtotal", 475, tableTop, { width: 75, align: "right" });

  doc.moveDown(0.3);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor("#dddddd").stroke();

  let curY = doc.y + 6;
  doc.font("Helvetica").fontSize(9);

  booking.items.forEach((item, index) => {
    const typeLabel = item.type === "SERVICE" ? "Layanan" : "Part";

    doc.text(String(index + 1), 45, curY);
    doc.text(item.nameSnapshot.slice(0, 42), 75, curY, { width: 230 });
    doc.text(typeLabel, 310, curY);
    doc.text(String(item.quantity), 365, curY, { width: 30, align: "right" });
    doc.text(`Rp ${item.unitPrice.toLocaleString("id-ID")}`, 405, curY, {
      width: 65,
      align: "right",
    });
    doc.text(`Rp ${item.subtotal.toLocaleString("id-ID")}`, 475, curY, {
      width: 75,
      align: "right",
    });

    curY += 16;
  });

  doc.moveDown(0.5);
  doc.moveTo(40, curY).lineTo(555, curY).strokeColor("#333333").stroke();
  curY += 8;

  // Grand Total
  doc.font("Helvetica-Bold").fontSize(10);
  doc.text("TOTAL PEMBAYARAN :", 310, curY);
  doc.text(`Rp ${booking.total.toLocaleString("id-ID")}`, 475, curY, {
    width: 75,
    align: "right",
  });

  // Catatan kaki
  curY += 30;
  doc.font("Helvetica-Oblique").fontSize(8).fillColor("#666666");
  doc.text(
    "* Faktur ini merupakan bukti pembayaran yang sah dan dicetak secara otomatis oleh sistem komputer.",
    40,
    curY
  );
  doc.text(
    "* Catatan: Tip sukarela kepada mekanik tidak termasuk dalam faktur resmi bengkel.",
    40,
    curY + 12
  );

  doc.end();
};

export default {
  publicPaymentSelect,
  generateInvoiceNumber,
  createMidtransInvoicePayment,
  createTipPayment,
  payCash,
  handleMidtransNotification,
  syncPaymentStatus,
  listBookingPayments,
  generateInvoicePdf,
};
