// ==============================================================================
// TALLERO AUTO — EXPO PUSH NOTIFICATION SERVICE
// Mengirimkan push notification ke aplikasi mobile melalui Expo Push API
// Sesuai AGENTS.md §1 & §4 (kegagalan push tidak boleh menggagalkan request utama)
// ==============================================================================

import { Expo } from "expo-server-sdk";
import prisma from "../config/prisma.js";
import logger from "../config/logger.js";

const expo = new Expo();

/**
 * Mengirimkan push notification ke sekumpulan token Expo
 * Membersihkan token yang sudah tidak aktif (DeviceNotRegistered) secara otomatis
 * @param {object} params
 * @param {string[]} params.tokens - Array expo push token
 * @param {string} params.title
 * @param {string} params.body
 * @param {object} [params.data]
 * @returns {Promise<void>}
 */
export const sendExpoPush = async ({ tokens, title, body, data }) => {
  if (!tokens || tokens.length === 0) {
    return;
  }

  // Filter token valid
  const validTokens = [];
  for (const pushToken of tokens) {
    if (Expo.isExpoPushToken(pushToken)) {
      validTokens.push(pushToken);
    } else {
      logger.warn({ pushToken }, "Push token Expo tidak valid, diabaikan");
    }
  }

  if (validTokens.length === 0) {
    return;
  }

  const messages = validTokens.map((to) => ({
    to,
    sound: "default",
    title,
    body,
    data: data || {},
  }));

  const chunks = expo.chunkPushNotifications(messages);

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);

      // Periksa tiket kegagalan pengiriman
      ticketChunk.forEach(async (ticket, index) => {
        if (ticket.status === "error") {
          logger.warn(
            { error: ticket.message, details: ticket.details, token: chunk[index].to },
            "Gagal mengirimkan notifikasi push Expo"
          );

          // Jika perangkat tidak lagi terdaftar, bersihkan token dari database
          if (ticket.details?.error === "DeviceNotRegistered") {
            const staleToken = chunk[index].to;
            try {
              await prisma.deviceToken.deleteMany({
                where: { expoPushToken: staleToken },
              });
              logger.info({ staleToken }, "Token Expo DeviceNotRegistered berhasil dibersihkan");
            } catch (delErr) {
              logger.warn({ delErr, staleToken }, "Gagal menghapus token kedaluwarsa");
            }
          }
        }
      });
    } catch (err) {
      logger.warn(
        { err: err.message },
        "Terjadi kesalahan saat memanggil Expo Push Notification API (best-effort)"
      );
    }
  }
};

export default {
  sendExpoPush,
};
