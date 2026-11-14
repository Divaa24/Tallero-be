// ==============================================================================
// TALLERO AUTO — NOTIFICATIONS CONTROLLER
// Controller tipis untuk notifikasi in-app dan registrasi token perangkat
// Sesuai aturan arsitektur AGENTS.md §2
// ==============================================================================

import notificationsService from "../services/notifications.service.js";
import { sendSuccess } from "../utils/response.js";

export const listNotifications = async (req, res) => {
  const result = await notificationsService.listNotifications({
    actor: req.user,
    query: req.valid.query,
  });

  return sendSuccess(res, {
    statusCode: 200,
    data: result.data,
    meta: result.meta,
  });
};

export const getUnreadCount = async (req, res) => {
  const result = await notificationsService.getUnreadCount({
    actor: req.user,
  });

  return sendSuccess(res, {
    statusCode: 200,
    data: result,
  });
};

export const markAsRead = async (req, res) => {
  const result = await notificationsService.markAsRead({
    actor: req.user,
    notificationId: req.valid.params.id,
  });

  return sendSuccess(res, {
    statusCode: 200,
    message: "Notifikasi berhasil ditandai sebagai sudah dibaca",
    data: result,
  });
};

export const markAllAsRead = async (req, res) => {
  const result = await notificationsService.markAllAsRead({
    actor: req.user,
  });

  return sendSuccess(res, {
    statusCode: 200,
    message: "Seluruh notifikasi berhasil ditandai sebagai sudah dibaca",
    data: result,
  });
};

export const registerDeviceToken = async (req, res) => {
  const { expoPushToken, platform } = req.valid.body;
  const result = await notificationsService.registerDeviceToken({
    actor: req.user,
    expoPushToken,
    platform,
  });

  return sendSuccess(res, {
    statusCode: 200,
    message: "Token perangkat berhasil didaftarkan untuk notifikasi push",
    data: result,
  });
};

export const unregisterDeviceToken = async (req, res) => {
  const { expoPushToken } = req.valid.body;
  const result = await notificationsService.unregisterDeviceToken({
    actor: req.user,
    expoPushToken,
  });

  return sendSuccess(res, {
    statusCode: 200,
    message: "Token perangkat berhasil dihapus",
    data: result,
  });
};

export default {
  listNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  registerDeviceToken,
  unregisterDeviceToken,
};
