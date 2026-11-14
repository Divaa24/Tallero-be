// ==============================================================================
// TALLERO AUTO — NOTIFICATIONS ROUTER
// Sesuai konvensi API AGENTS.md §2 & §9
// ==============================================================================

import { Router } from "express";
import { authenticate } from "../middlewares/authenticate.js";
import { validate } from "../middlewares/validate.js";
import notificationsController from "../controllers/notifications.controller.js";
import {
  listNotificationsSchema,
  notificationIdParamSchema,
  registerDeviceTokenSchema,
  unregisterDeviceTokenSchema,
} from "../validations/notifications.validation.js";

export const notificationsRouter = Router();

notificationsRouter.use(authenticate);

// 1. Ambil jumlah notifikasi belum dibaca (ditempatkan sebelum /:id)
notificationsRouter.get("/unread-count", notificationsController.getUnreadCount);

// 2. Tandai seluruh notifikasi sebagai sudah dibaca (ditempatkan sebelum /:id)
notificationsRouter.post("/read-all", notificationsController.markAllAsRead);

// 3. Registrasi token perangkat Expo untuk push notification
notificationsRouter.post(
  "/devices",
  validate(registerDeviceTokenSchema, "body"),
  notificationsController.registerDeviceToken
);

// 4. Hapus token perangkat Expo
notificationsRouter.delete(
  "/devices",
  validate(unregisterDeviceTokenSchema, "body"),
  notificationsController.unregisterDeviceToken
);

// 5. Daftar notifikasi pengguna
notificationsRouter.get(
  "/",
  validate(listNotificationsSchema, "query"),
  notificationsController.listNotifications
);

// 6. Tandai satu notifikasi sebagai sudah dibaca
notificationsRouter.patch(
  "/:id/read",
  validate(notificationIdParamSchema, "params"),
  notificationsController.markAsRead
);

export default notificationsRouter;
