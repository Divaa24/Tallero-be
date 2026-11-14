// ==============================================================================
// TALLERO AUTO — MIDTRANS HTTP SERVICE (DIRECT INTEGRATION, NO LEGACY SDK)
// Sesuai arsitektur AGENTS.md §1 & §4 (Basic Auth, timeout & error terukur)
// ==============================================================================

import crypto from "node:crypto";
import env from "../config/env.js";
import logger from "../config/logger.js";
import RULES from "../config/rules.js";
import { AppError } from "../utils/errors.js";

const SNAP_BASE_URL = env.MIDTRANS_IS_PRODUCTION
  ? "https://app.midtrans.com/snap/v1"
  : "https://app.sandbox.midtrans.com/snap/v1";

const CORE_BASE_URL = env.MIDTRANS_IS_PRODUCTION
  ? "https://api.midtrans.com/v2"
  : "https://api.sandbox.midtrans.com/v2";

/**
 * Menghasilkan header Authorization Basic Auth Midtrans
 */
const getAuthHeader = () => {
  const token = Buffer.from(`${env.MIDTRANS_SERVER_KEY}:`).toString("base64");
  return `Basic ${token}`;
};

/**
 * Membuat transaksi Midtrans Snap token dan URL pembayaran
 * @param {object} params
 * @param {string} params.orderId
 * @param {number} params.amount
 * @param {Array<{id: string, price: number, quantity: number, name: string}>} [params.itemDetails]
 * @param {object} [params.customerDetails]
 * @param {number} [params.expiryDurationMinutes]
 * @returns {Promise<{token: string, redirectUrl: string}>}
 */
export const createSnapTransaction = async ({
  orderId,
  amount,
  itemDetails,
  customerDetails,
  expiryDurationMinutes = RULES.PAYMENT_EXPIRY_MIN,
}) => {
  const url = `${SNAP_BASE_URL}/transactions`;

  const payload = {
    transaction_details: {
      order_id: orderId,
      gross_amount: amount,
    },
    expiry: {
      unit: "minute",
      duration: expiryDurationMinutes,
    },
  };

  if (itemDetails && itemDetails.length > 0) {
    payload.item_details = itemDetails.map((item) => ({
      id: String(item.id).slice(0, 50),
      price: item.price,
      quantity: item.quantity,
      name: String(item.name).slice(0, 50),
    }));
  }

  if (customerDetails) {
    payload.customer_details = {
      first_name: customerDetails.firstName || "Pelanggan",
      last_name: customerDetails.lastName || undefined,
      email: customerDetails.email || undefined,
      phone: customerDetails.phone || undefined,
    };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: getAuthHeader(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      logger.error(
        { status: res.status, body, orderId, amount },
        "Midtrans Snap API mengembalikan status error"
      );
      throw new AppError(
        body.error_messages?.[0] || "Gagal membuat sesi pembayaran Midtrans Snap",
        502,
        "MIDTRANS_GATEWAY_ERROR",
        body
      );
    }

    return {
      token: body.token,
      redirectUrl: body.redirect_url,
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error(
      { err, orderId },
      "Koneksi ke Midtrans Snap API gagal atau batas waktu terlampaui"
    );
    throw new AppError(
      "Gagal menghubungi gateway pembayaran Midtrans (timeout/koneksi)",
      502,
      "MIDTRANS_GATEWAY_ERROR"
    );
  }
};

/**
 * Mengambil status resmi transaksi langsung dari Core Status API Midtrans
 * @param {string} orderId
 * @returns {Promise<object>}
 */
export const getStatus = async (orderId) => {
  const url = `${CORE_BASE_URL}/${encodeURIComponent(orderId)}/status`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: getAuthHeader(),
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      logger.warn(
        { status: res.status, body, orderId },
        "Gagal mendapatkan status transaksi dari Midtrans Core API"
      );
      throw new AppError(
        body.status_message || "Transaksi tidak ditemukan di sistem Midtrans",
        res.status === 404 ? 404 : 502,
        res.status === 404 ? "PAYMENT_NOT_FOUND" : "MIDTRANS_GATEWAY_ERROR",
        body
      );
    }

    return body;
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error({ err, orderId }, "Gagal menghubungi Midtrans Status API");
    throw new AppError(
      "Gagal menghubungi server status pembayaran Midtrans",
      502,
      "MIDTRANS_GATEWAY_ERROR"
    );
  }
};

/**
 * Membatalkan transaksi pending di Midtrans (best-effort)
 * @param {string} orderId
 * @returns {Promise<object|null>}
 */
export const cancel = async (orderId) => {
  const url = `${CORE_BASE_URL}/${encodeURIComponent(orderId)}/cancel`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: getAuthHeader(),
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      logger.info(
        { status: res.status, orderId, body },
        "Pembatalan Midtrans mengembalikan status non-200 (mungkin sudah expired/settled/belum dibuat)"
      );
      return null;
    }

    return body;
  } catch (err) {
    logger.warn({ err, orderId }, "Permintaan pembatalan Midtrans gagal (best-effort diabaikan)");
    return null;
  }
};

/**
 * Memverifikasi tanda tangan webhook SHA-512 dari Midtrans secara timing-safe
 * signature_key = SHA512(order_id + status_code + gross_amount + ServerKey)
 * @param {object} params
 * @param {string} params.orderId
 * @param {string} params.statusCode
 * @param {string|number} params.grossAmount
 * @param {string} params.signatureKey
 * @returns {boolean}
 */
export const verifySignature = ({ orderId, statusCode, grossAmount, signatureKey }) => {
  if (!orderId || !statusCode || grossAmount === undefined || !signatureKey) {
    return false;
  }

  // Midtrans gross_amount bisa berupa format "150000.00" atau integer
  const rawPayload = `${orderId}${statusCode}${grossAmount}${env.MIDTRANS_SERVER_KEY}`;
  const computedHash = crypto.createHash("sha512").update(rawPayload).digest("hex");

  if (computedHash.length !== signatureKey.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computedHash, "utf-8"),
      Buffer.from(signatureKey, "utf-8")
    );
  } catch {
    return false;
  }
};

export default {
  createSnapTransaction,
  getStatus,
  cancel,
  verifySignature,
};
