import prisma from "../config/prisma.js";
import logger from "../config/logger.js";
import RULES from "../config/rules.js";
import { transition } from "../services/bookingStateMachine.js";
import { emitRealtimeEvent } from "../services/realtime.service.js";

/**
 * Memeriksa seluruh booking berstatus PENDING yang telah melewati waktu slot selesai
 * ditambah batas waktu toleransi (grace period 60 menit).
 * Ditandai sebagai NO_SHOW secara otomatis oleh actor SYSTEM.
 *
 * @param {Date} [now=new Date()]
 * @returns {Promise<{ markedCount: number, bookingIds: number[] }>}
 */
export const runNoShowCheck = async (now = new Date()) => {
  const graceMs = RULES.NO_SHOW_GRACE_MINUTES * 60 * 1000;
  const cutoffTime = new Date(now.getTime() - graceMs);

  // Cari booking PENDING yang slotEndAt-nya sudah lewat dari batas grace period
  const expiredBookings = await prisma.booking.findMany({
    where: {
      status: "PENDING",
      slotEndAt: { lte: cutoffTime },
    },
    select: {
      id: true,
      code: true,
      outletId: true,
      customerId: true,
      slotEndAt: true,
    },
  });

  if (expiredBookings.length === 0) {
    logger.debug("Tidak ada booking PENDING yang melewati batas toleransi no-show");
    return { markedCount: 0, bookingIds: [] };
  }

  const markedIds = [];
  const systemActor = { id: null, role: "SYSTEM" };

  for (const b of expiredBookings) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        return transition(tx, b.id, "NO_SHOW", systemActor, {
          now,
          note: `Otomatis ditandai NO_SHOW oleh sistem (melebihi toleransi ${RULES.NO_SHOW_GRACE_MINUTES} menit setelah slot selesai)`,
        });
      });

      markedIds.push(b.id);

      for (const evt of result.events) {
        emitRealtimeEvent(evt.event, evt.payload, evt.rooms);
      }
      emitRealtimeEvent(
        "queue:updated",
        { outletId: b.outletId, action: "NO_SHOW", bookingId: b.id },
        [`outlet:${b.outletId}:staff`, "admin"]
      );
    } catch (err) {
      logger.error(
        { err, bookingId: b.id, code: b.code },
        "Gagal menandai booking no-show pada cron job"
      );
    }
  }

  logger.info(
    { markedCount: markedIds.length, bookingIds: markedIds },
    "Pemeriksaan no-show otomatis selesai dieksekusi"
  );

  return {
    markedCount: markedIds.length,
    bookingIds: markedIds,
  };
};

export default {
  runNoShowCheck,
};
