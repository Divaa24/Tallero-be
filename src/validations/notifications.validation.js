// ==============================================================================
// TALLERO AUTO — NOTIFICATIONS VALIDATION SCHEMAS (ZOD)
// Sesuai konvensi API AGENTS.md §3
// ==============================================================================

import { z } from "zod";

export const notificationIdParamSchema = z
  .object({
    id: z.coerce.number().int().positive("ID notifikasi harus berupa bilangan bulat positif"),
  })
  .strict();

export const listNotificationsSchema = z
  .object({
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().positive().max(100).optional().default(20),
  })
  .strict();

export const registerDeviceTokenSchema = z
  .object({
    expoPushToken: z
      .string()
      .trim()
      .min(1, "Token Expo push notification wajib diisi")
      .max(255, "Token Expo maksimal 255 karakter"),
    platform: z.enum(["ios", "android", "web"], {
      errorMap: () => ({ message: "Platform harus berupa salah satu dari: ios, android, web" }),
    }),
  })
  .strict();

export const unregisterDeviceTokenSchema = z
  .object({
    expoPushToken: z.string().trim().min(1, "Token Expo push notification wajib diisi"),
  })
  .strict();

export default {
  notificationIdParamSchema,
  listNotificationsSchema,
  registerDeviceTokenSchema,
  unregisterDeviceTokenSchema,
};
