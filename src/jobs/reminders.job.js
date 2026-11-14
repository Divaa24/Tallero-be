// ==============================================================================
// TALLERO AUTO — REMINDERS BACKGROUND JOB
// Job evaluasi pengingat servis harian pada pukul 08:00 WIB
// Sesuai aturan pekerjaan latar belakang AGENTS.md §1 & §4
// ==============================================================================

import logger from "../config/logger.js";
import { runServiceRemindersCron } from "../services/reminders.service.js";

/**
 * Menjalankan evaluasi pengingat servis berkala
 * @returns {Promise<{remindedCount: number, dueCount: number}>}
 */
export const runRemindersCheck = async () => {
  logger.info("Menjalankan job evaluasi pengingat servis berkala (reminders.job)...");
  try {
    const result = await runServiceRemindersCron();
    return result;
  } catch (err) {
    logger.error({ err }, "Terjadi kegagalan fatal pada background job reminders");
    throw err;
  }
};

export default {
  runRemindersCheck,
};
