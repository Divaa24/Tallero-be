import cron from "node-cron";
import env from "../config/env.js";
import logger from "../config/logger.js";
import RULES from "../config/rules.js";
import { runNoShowCheck } from "./noShow.job.js";
import { runTokenCleanup } from "./cleanup.job.js";
import { runPaymentSync } from "./paymentSync.job.js";
import { runRemindersCheck } from "./reminders.job.js";

const scheduledTasks = [];

/**
 * Menginisialisasi scheduler pekerjaan latar belakang (cron jobs)
 * Menggunakan timezone Asia/Jakarta dan dijaga oleh guard ENABLE_JOBS di .env
 */
export const initScheduler = () => {
  if (!env.ENABLE_JOBS) {
    logger.info("Scheduler cron dinonaktifkan (ENABLE_JOBS=false)");
    return { active: false, tasks: [] };
  }

  logger.info("Memulai inisialisasi scheduler background jobs (Asia/Jakarta)...");

  // 1. Job No-Show: dijalankan setiap 10 menit
  const noShowTask = cron.schedule(
    "*/10 * * * *",
    async () => {
      logger.info("Menjalankan cron noShow otomatis (setiap 10 menit)...");
      try {
        await runNoShowCheck();
      } catch (err) {
        logger.error({ err }, "Terjadi kegagalan pada background job noShow");
      }
    },
    {
      scheduled: true,
      timezone: RULES.TIMEZONE,
    }
  );
  scheduledTasks.push({ name: "noShow", task: noShowTask });

  // 2. Job Cleanup Token: dijalankan setiap hari pada pukul 03:00 WIB
  const cleanupTask = cron.schedule(
    "0 3 * * *",
    async () => {
      logger.info("Menjalankan pembersihan token autentikasi harian...");
      try {
        await runTokenCleanup();
      } catch (err) {
        logger.error({ err }, "Terjadi kegagalan pada background job cleanup");
      }
    },
    {
      scheduled: true,
      timezone: RULES.TIMEZONE,
    }
  );
  scheduledTasks.push({ name: "cleanup", task: cleanupTask });

  // 3. Job Payment Sync: dijalankan setiap 5 menit
  const paymentSyncTask = cron.schedule(
    "*/5 * * * *",
    async () => {
      logger.info("Menjalankan sinkronisasi pembayaran pending otomatis...");
      try {
        await runPaymentSync();
      } catch (err) {
        logger.error({ err }, "Terjadi kegagalan pada background job paymentSync");
      }
    },
    {
      scheduled: true,
      timezone: RULES.TIMEZONE,
    }
  );
  scheduledTasks.push({ name: "paymentSync", task: paymentSyncTask });

  // 4. Job Reminders: dijalankan setiap hari pada pukul 08:00 WIB
  const remindersTask = cron.schedule(
    "0 8 * * *",
    async () => {
      logger.info("Menjalankan evaluasi pengingat servis harian (08:00 WIB)...");
      try {
        await runRemindersCheck();
      } catch (err) {
        logger.error({ err }, "Terjadi kegagalan pada background job reminders");
      }
    },
    {
      scheduled: true,
      timezone: RULES.TIMEZONE,
    }
  );
  scheduledTasks.push({ name: "reminders", task: remindersTask });

  logger.info(
    { totalJobs: scheduledTasks.length },
    "Scheduler cron aktif dan berjalan sesuai jadwal"
  );

  return { active: true, tasks: scheduledTasks };
};

/**
 * Menghentikan seluruh background cron jobs saat graceful shutdown
 */
export const stopScheduler = () => {
  for (const { name, task } of scheduledTasks) {
    try {
      task.stop();
      logger.debug({ job: name }, "Background job cron dihentikan");
    } catch (err) {
      logger.warn({ err, job: name }, "Gagal menghentikan job cron");
    }
  }
  scheduledTasks.length = 0;
};

export default {
  initScheduler,
  stopScheduler,
};
