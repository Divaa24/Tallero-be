// ==============================================================================
// TALLERO AUTO — SERVICE REMINDERS SERVICE
// Mengelola pengingat servis berkala berbasis waktu dan jarak tempuh (KM)
// Sesuai aturan reminder AGENTS.md §8 (H-7 SCHEDULED -> REMINDED, Hari-H DUE)
// ==============================================================================

import { DateTime } from "luxon";
import prisma from "../config/prisma.js";
import logger from "../config/logger.js";
import RULES from "../config/rules.js";
import { notify } from "./notifications.service.js";

/**
 * Mengevaluasi pengingat servis berbasis odometer saat KM kendaraan diperbarui
 * @param {object} params
 * @param {number} params.vehicleId
 * @param {number} params.newOdometerKm
 * @returns {Promise<number>} Jumlah reminder yang dipicu menjadi DUE
 */
export const evaluateOdometerReminders = async ({ vehicleId, newOdometerKm }) => {
  if (!newOdometerKm || newOdometerKm <= 0) {
    return 0;
  }

  const triggeredReminders = await prisma.serviceReminder.findMany({
    where: {
      vehicleId,
      status: { in: ["SCHEDULED", "REMINDED"] },
      dueOdometerKm: { not: null, lte: newOdometerKm },
    },
    include: {
      service: { select: { id: true, name: true } },
    },
  });

  if (triggeredReminders.length === 0) {
    return 0;
  }

  const now = new Date();
  let count = 0;

  for (const reminder of triggeredReminders) {
    try {
      await prisma.serviceReminder.update({
        where: { id: reminder.id },
        data: {
          status: "DUE",
          dueNotifiedAt: now,
        },
      });

      await notify(reminder.userId, {
        type: "SERVICE_REMINDER",
        title: "Waktunya Servis Berkala",
        body: `Odometer kendaraan Anda telah mencapai ${newOdometerKm.toLocaleString("id-ID")} KM (melewati jadwal ${reminder.dueOdometerKm?.toLocaleString("id-ID")} KM) untuk layanan ${reminder.service.name}. Segera jadwalkan booking di Tallero Auto.`,
        data: {
          vehicleId: reminder.vehicleId,
          serviceId: reminder.serviceId,
          reminderId: reminder.id,
          deepLink: "tallero://reminders",
        },
      });

      count++;
    } catch (err) {
      logger.warn({ err, reminderId: reminder.id }, "Gagal memperbarui reminder odometer");
    }
  }

  return count;
};

/**
 * Menjalankan evaluasi cron pengingat servis harian (H-7 dan Hari-H)
 * Sifat: Idempotent (aman dijalankan ganda pada hari yang sama tanpa spam notifikasi)
 * @returns {Promise<{remindedCount: number, dueCount: number}>}
 */
export const runServiceRemindersCron = async () => {
  const now = new Date();
  const leadMs = RULES.REMINDER_LEAD_DAYS * 24 * 60 * 60 * 1000;
  const leadThreshold = new Date(now.getTime() + leadMs);

  logger.info("Memulai cron evaluasi jadwal servis berkala harian...");

  // 1. Evaluasi reminder yang sudah jatuh tempo hari ini atau lewat (DUE)
  const dueCandidates = await prisma.serviceReminder.findMany({
    where: {
      status: { in: ["SCHEDULED", "REMINDED"] },
      dueDate: { lte: now },
      dueNotifiedAt: null,
    },
    include: {
      service: { select: { id: true, name: true } },
    },
  });

  let dueCount = 0;
  for (const reminder of dueCandidates) {
    try {
      await prisma.serviceReminder.update({
        where: { id: reminder.id },
        data: {
          status: "DUE",
          dueNotifiedAt: now,
        },
      });

      await notify(reminder.userId, {
        type: "SERVICE_REMINDER",
        title: "Waktunya Servis Berkala",
        body: `Hari ini adalah jadwal jatuh tempo servis berkala untuk layanan ${reminder.service.name}. Segera booking jadwal di Tallero Auto.`,
        data: {
          vehicleId: reminder.vehicleId,
          serviceId: reminder.serviceId,
          reminderId: reminder.id,
          deepLink: "tallero://reminders",
        },
      });

      dueCount++;
    } catch (err) {
      logger.warn({ err, reminderId: reminder.id }, "Gagal memproses reminder DUE harian");
    }
  }

  // 2. Evaluasi reminder H-7 (REMINDED)
  const leadCandidates = await prisma.serviceReminder.findMany({
    where: {
      status: "SCHEDULED",
      dueDate: { gt: now, lte: leadThreshold },
      remindedAt: null,
    },
    include: {
      service: { select: { id: true, name: true } },
    },
  });

  let remindedCount = 0;
  for (const reminder of leadCandidates) {
    try {
      await prisma.serviceReminder.update({
        where: { id: reminder.id },
        data: {
          status: "REMINDED",
          remindedAt: now,
        },
      });

      const formattedDate = DateTime.fromJSDate(reminder.dueDate)
        .setZone(RULES.TIMEZONE)
        .toFormat("dd LLL yyyy");

      await notify(reminder.userId, {
        type: "SERVICE_REMINDER",
        title: "Pengingat Servis Berkala",
        body: `Servis berkala (${reminder.service.name}) kendaraan Anda jatuh tempo dalam ${RULES.REMINDER_LEAD_DAYS} hari (${formattedDate}). Rencanakan perawatan kendaraan Anda.`,
        data: {
          vehicleId: reminder.vehicleId,
          serviceId: reminder.serviceId,
          reminderId: reminder.id,
          deepLink: "tallero://reminders",
        },
      });

      remindedCount++;
    } catch (err) {
      logger.warn({ err, reminderId: reminder.id }, "Gagal memproses reminder REMINDED H-7");
    }
  }

  logger.info({ remindedCount, dueCount }, "Selesai menjalankan evaluasi pengingat servis harian");

  return { remindedCount, dueCount };
};

export default {
  evaluateOdometerReminders,
  runServiceRemindersCron,
};
