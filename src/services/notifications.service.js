// ==============================================================================
// TALLERO AUTO — NOTIFICATIONS SERVICE
// Sentralisasi notifikasi in-app, realtime Socket.IO, dan Push Expo
// Sesuai aturan keamanan AGENTS.md §4 & §6
// ==============================================================================

import { Expo } from "expo-server-sdk";
import prisma from "../config/prisma.js";
import logger from "../config/logger.js";
import { emitRealtimeEvent } from "./realtime.service.js";
import { sendExpoPush } from "./push.service.js";
import { parsePagination, buildPaginationMeta } from "../utils/pagination.js";
import { BadRequestError, NotFoundError } from "../utils/errors.js";

/**
 * Mengirimkan notifikasi terpusat ke pengguna
 * 1. Menyimpan ke database (in-app notification)
 * 2. Mengirimkan event realtime Socket.IO ke room pengguna
 * 3. Mengirimkan push notification ke seluruh perangkat terdaftar pengguna
 * @param {number} userId
 * @param {object} payload
 * @param {string} payload.type - Enum NotificationType (BOOKING_STATUS, APPROVAL_REQUEST, PAYMENT, SERVICE_REMINDER, SYSTEM)
 * @param {string} payload.title
 * @param {string} payload.body
 * @param {object} [payload.data]
 * @returns {Promise<object>}
 */
export const notify = async (userId, { type, title, body, data }) => {
  // 1. Simpan ke database
  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      title,
      body,
      data: data || undefined,
    },
  });

  // 2. Realtime Socket.IO emit
  try {
    emitRealtimeEvent("notification:new", notification, [`user:${userId}`]);
  } catch (socketErr) {
    logger.warn({ socketErr, userId }, "Gagal mengirim realtime socket notification (diabaikan)");
  }

  // 3. Push notification ke perangkat pengguna (non-blocking / best-effort)
  try {
    const devices = await prisma.deviceToken.findMany({
      where: { userId },
      select: { expoPushToken: true },
    });

    if (devices.length > 0) {
      const tokens = devices.map((d) => d.expoPushToken);
      // Jalankan tanpa await agar tidak memperlambat alur request utama
      sendExpoPush({ tokens, title, body, data }).catch((pushErr) => {
        logger.warn({ pushErr, userId }, "Pengiriman push notification Expo gagal");
      });
    }
  } catch (deviceErr) {
    logger.warn({ deviceErr, userId }, "Gagal mengambil daftar token perangkat");
  }

  return notification;
};

/**
 * GET /notifications
 * Mengambil daftar notifikasi pengguna terautentikasi secara terpaginasi
 */
export const listNotifications = async ({ actor, query }) => {
  const { page, limit, skip } = parsePagination(query);

  const where = { userId: actor.id };

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where }),
  ]);

  return {
    data: notifications,
    meta: buildPaginationMeta({ page, limit, total }),
  };
};

/**
 * GET /notifications/unread-count
 * Mengambil jumlah notifikasi yang belum dibaca
 */
export const getUnreadCount = async ({ actor }) => {
  const unreadCount = await prisma.notification.count({
    where: {
      userId: actor.id,
      readAt: null,
    },
  });

  return { unreadCount };
};

/**
 * PATCH /notifications/:id/read
 * Menandai satu notifikasi sebagai sudah dibaca (IDOR protection: milik user sendiri)
 */
export const markAsRead = async ({ actor, notificationId }) => {
  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      userId: actor.id,
    },
  });

  if (!notification) {
    throw new NotFoundError("Notifikasi tidak ditemukan", "NOTIFICATION_NOT_FOUND");
  }

  const updated = await prisma.notification.update({
    where: { id: notification.id },
    data: { readAt: new Date() },
  });

  return updated;
};

/**
 * POST /notifications/read-all
 * Menandai seluruh notifikasi yang belum dibaca milik pengguna sebagai sudah dibaca
 */
export const markAllAsRead = async ({ actor }) => {
  const result = await prisma.notification.updateMany({
    where: {
      userId: actor.id,
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  });

  return { updatedCount: result.count };
};

/**
 * POST /notifications/devices
 * Mendaftarkan atau memperbarui token perangkat Expo untuk push notification
 */
export const registerDeviceToken = async ({ actor, expoPushToken, platform }) => {
  if (!Expo.isExpoPushToken(expoPushToken)) {
    throw new BadRequestError(
      "Format token Expo push notification tidak valid",
      "INVALID_EXPO_TOKEN"
    );
  }

  const now = new Date();

  const device = await prisma.deviceToken.upsert({
    where: { expoPushToken },
    create: {
      userId: actor.id,
      expoPushToken,
      platform,
      lastSeenAt: now,
    },
    update: {
      userId: actor.id,
      platform,
      lastSeenAt: now,
    },
  });

  return device;
};

/**
 * DELETE /notifications/devices
 * Menghapus token perangkat saat pengguna logout dari aplikasi
 */
export const unregisterDeviceToken = async ({ actor, expoPushToken }) => {
  const result = await prisma.deviceToken.deleteMany({
    where: {
      userId: actor.id,
      expoPushToken,
    },
  });

  return { success: true, deletedCount: result.count };
};

export default {
  notify,
  listNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  registerDeviceToken,
  unregisterDeviceToken,
};
