import logger from "../config/logger.js";

let socketIoInstance = null;

/**
 * Menyimpan instance Socket.IO server saat diinisialisasi.
 */
export const setSocketIoInstance = (io) => {
  socketIoInstance = io;
};

/**
 * Mengambil instance Socket.IO yang terpasang jika ada.
 */
export const getSocketIoInstance = () => socketIoInstance;

/**
 * Mengirim event realtime ke room tertentu secara terisolasi.
 * Sesuai AGENTS.md §4.23 & §8: Tanpa io.emit global (dilarang broadcast tanpa room).
 *
 * @param {string} event - Nama event (mis. "booking:status_changed", "queue:updated")
 * @param {object} payload - Data event
 * @param {string|string[]} rooms - Room tujuan (wajib minimal 1 room, mis. `user:${id}`, `outlet:${id}:staff`, `admin`)
 */
export const emitRealtimeEvent = (event, payload, rooms = []) => {
  try {
    const targetRooms = Array.isArray(rooms) ? rooms.filter(Boolean) : rooms ? [String(rooms)] : [];

    if (targetRooms.length === 0) {
      logger.warn(
        { event },
        "Realtime event dibatalkan: tidak ada target room yang ditentukan (broadcast global dilarang)"
      );
      return;
    }

    if (!socketIoInstance) {
      logger.debug(
        { event, targetRooms, payloadSummary: { bookingId: payload?.bookingId } },
        "Realtime event diabaikan (Socket.IO belum diinisialisasi)"
      );
      return;
    }

    // Emit hanya ke room target
    let emitter = socketIoInstance;
    for (const room of targetRooms) {
      emitter = emitter.to(room);
    }
    emitter.emit(event, payload);
  } catch (error) {
    logger.warn({ err: error, event }, "Gagal mengirim event realtime");
  }
};

/**
 * Helper khusus emisi status booking ke user pemilik dan staf outlet terkait
 */
export const emitBookingStatusChanged = (booking, fromStatus, toStatus) => {
  const rooms = [`user:${booking.customerId}`, `outlet:${booking.outletId}:staff`, "admin"];

  emitRealtimeEvent(
    "booking:status_changed",
    {
      bookingId: booking.id,
      code: booking.code,
      fromStatus,
      toStatus,
      outletId: booking.outletId,
      customerId: booking.customerId,
      updatedAt: new Date().toISOString(),
    },
    rooms
  );
};

/**
 * Helper khusus emisi update antrian ke staf outlet dan customer yang antriannya terpengaruh
 */
export const emitQueueUpdated = (outletId, affectedCustomerIds = []) => {
  const rooms = [`outlet:${outletId}:staff`, "admin"];
  for (const cId of affectedCustomerIds) {
    if (cId) rooms.push(`user:${cId}`);
  }

  emitRealtimeEvent(
    "queue:updated",
    {
      outletId,
      timestamp: new Date().toISOString(),
    },
    rooms
  );
};

export default {
  setSocketIoInstance,
  getSocketIoInstance,
  emitRealtimeEvent,
  emitBookingStatusChanged,
  emitQueueUpdated,
};
