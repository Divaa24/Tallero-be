// ==============================================================================
// TALLERO AUTO — ASSISTANT SERVICE (MENU CEPAT, TANPA AI/LLM)
// Mengembalikan respons terstruktur deterministik per-intent (AGENTS.md §8)
// Me-reuse service yang sudah ada tanpa duplikasi logika bisnis
// ==============================================================================

import { DateTime } from "luxon";
import prisma from "../config/prisma.js";
import RULES from "../config/rules.js";
import * as bookingsService from "./bookings.service.js";
import * as outletsService from "./outlets.service.js";
import * as catalogService from "./catalog.service.js";
import { NotFoundError } from "../utils/errors.js";

/**
 * GET /assistant/menu
 * Mengembalikan daftar menu intent cepat yang dapat dipilih oleh pelanggan
 */
export const getMenu = async () => {
  return [
    {
      intent: "CHECK_SLOT",
      label: "Cek Ketersediaan Slot",
      description: "Mengecek ketersediaan jam servis pada outlet dan tanggal tertentu",
      requiredParams: ["outletId", "date"],
      optionalParams: ["serviceIds"],
    },
    {
      intent: "OUTLET_OPEN_STATUS",
      label: "Status Buka Outlet",
      description: "Mengecek jam operasional dan apakah outlet buka hari ini",
      requiredParams: ["outletId"],
    },
    {
      intent: "MY_BOOKING_STATUS",
      label: "Status Booking Saya",
      description: "Melihat status servis aktif, nomor antrian, dan estimasi waktu tunggu",
      requiredParams: [],
    },
    {
      intent: "SERVICE_PRICE_LIST",
      label: "Daftar Harga Layanan",
      description: "Melihat katalog harga layanan servis bengkel",
      optionalParams: ["categoryId", "vehicleType"],
    },
    {
      intent: "MY_NEXT_SERVICE",
      label: "Jadwal Servis Berkala",
      description: "Melihat pengingat servis berkala yang akan datang untuk kendaraan saya",
      optionalParams: ["vehicleId"],
    },
  ];
};

/**
 * POST /assistant/query
 * Memproses query berbasis intent terpilih
 * @param {object} params
 * @param {object} params.actor - User terautentikasi (CUSTOMER)
 * @param {string} params.intent
 * @param {object} params.queryData - Parameter spesifik intent
 * @returns {Promise<{type: string, title: string, message: string, data: any, options?: string[]}>}
 */
export const queryAssistant = async ({ actor, intent, queryData }) => {
  const { params = {} } = queryData;

  // 1. INTENT: CHECK_SLOT
  if (intent === "CHECK_SLOT") {
    const { outletId, date, serviceIds = [] } = params;
    const availability = await bookingsService.getOutletAvailability({
      outletId,
      date,
      serviceIds,
    });

    const availableSlots = (availability.slots || []).filter(
      (s) => s.status === "AVAILABLE" || s.status === "LIMITED"
    );

    let message = "";
    if (availability.isClosure) {
      message = `Outlet sedang libur khusus pada tanggal ${date}: ${availability.closureReason || "Tutup"}.`;
    } else if (!availability.isDayOpen) {
      message = `Outlet libur mingguan pada tanggal ${date}.`;
    } else if (availableSlots.length === 0) {
      message = `Seluruh slot servis pada ${date} sudah penuh terisi.`;
    } else {
      message = `Tersedia ${availableSlots.length} slot servis pada ${date}.`;
    }

    return {
      type: "SLOT_AVAILABILITY",
      title: "Ketersediaan Slot Servis",
      message,
      data: {
        outletId: availability.outletId,
        date: availability.date,
        totalSlots: availability.slots.length,
        availableCount: availableSlots.length,
        slots: availability.slots,
      },
      options: availableSlots.slice(0, 5).map((s) => s.time),
    };
  }

  // 2. INTENT: OUTLET_OPEN_STATUS
  if (intent === "OUTLET_OPEN_STATUS") {
    const { outletId } = params;
    const outlet = await outletsService.getPublicOutletById({ outletId });

    const now = DateTime.now().setZone(RULES.TIMEZONE);
    const dayOfWeek = now.weekday; // 1 (Senin) - 7 (Minggu)
    const currentTimeStr = now.toFormat("HH:mm");

    const isOpenDay = Array.isArray(outlet.openDays) && outlet.openDays.includes(dayOfWeek);

    // Cek libur penutupan hari ini
    const todayDate = now.toISODate();
    const closure = await prisma.outletClosure.findFirst({
      where: {
        outletId: outlet.id,
        date: new Date(todayDate),
      },
    });

    let isOpenNow = false;
    let message = "";

    if (closure) {
      message = `Outlet ${outlet.name} hari ini sedang libur khusus: ${closure.reason}.`;
    } else if (!isOpenDay) {
      message = `Outlet ${outlet.name} hari ini libur rutin mingguan.`;
    } else if (currentTimeStr < outlet.openTime) {
      message = `Outlet ${outlet.name} belum buka hari ini. Buka pukul ${outlet.openTime} WIB.`;
    } else if (currentTimeStr >= outlet.closeTime) {
      message = `Outlet ${outlet.name} sudah tutup hari ini. Jam operasional: ${outlet.openTime} - ${outlet.closeTime} WIB.`;
    } else {
      isOpenNow = true;
      message = `Outlet ${outlet.name} saat ini sedang BUKA (operasional s/d ${outlet.closeTime} WIB).`;
    }

    return {
      type: "OUTLET_STATUS",
      title: "Status Operasional Outlet",
      message,
      data: {
        outlet: {
          id: outlet.id,
          name: outlet.name,
          address: outlet.address,
          phone: outlet.phone,
          openTime: outlet.openTime,
          closeTime: outlet.closeTime,
        },
        isOpenNow,
        currentTime: `${currentTimeStr} WIB`,
      },
    };
  }

  // 3. INTENT: MY_BOOKING_STATUS
  if (intent === "MY_BOOKING_STATUS") {
    // Cari booking aktif customer saat ini
    const activeBooking = await prisma.booking.findFirst({
      where: {
        customerId: actor.id,
        status: { in: [...RULES.ACTIVE_BOOKING_STATUSES] },
      },
      include: {
        outlet: { select: { id: true, name: true, phone: true } },
        vehicle: { select: { id: true, plateNumber: true, brand: true, model: true } },
        mechanic: { select: { id: true, name: true } },
      },
      orderBy: { scheduledAt: "desc" },
    });

    if (!activeBooking) {
      return {
        type: "NO_ACTIVE_BOOKING",
        title: "Status Booking Servis",
        message: "Anda tidak memiliki reservasi servis aktif saat ini.",
        data: null,
      };
    }

    let queueInfo = null;
    if (activeBooking.status === "CHECKED_IN") {
      try {
        queueInfo = await bookingsService.getQueuePosition({
          actor,
          bookingId: activeBooking.id,
        });
      } catch {
        // Best effort
      }
    }

    const statusLabels = {
      PENDING: "Menunggu Kedatangan (Belum Check-In)",
      CHECKED_IN: "Dalam Antrian Bengkel",
      IN_PROGRESS: "Sedang Dikerjakan Mekanik",
      WAITING_APPROVAL: "Menunggu Persetujuan Item Tambahan",
      READY_FOR_PICKUP: "Servis Selesai, Kendaraan Siap Diambil",
    };

    let detailMessage = `Booking ${activeBooking.code} untuk kendaraan ${activeBooking.vehicle.brand} ${activeBooking.vehicle.model} (${activeBooking.vehicle.plateNumber}): Status ${statusLabels[activeBooking.status] || activeBooking.status}.`;
    if (queueInfo) {
      detailMessage += ` Posisi antrian: ${queueInfo.positionInQueue} mobil di depan Anda (perkiraan tunggu ~${queueInfo.estimatedWaitMinutes} menit).`;
    }

    return {
      type: "BOOKING_STATUS",
      title: "Status Servis Aktif Anda",
      message: detailMessage,
      data: {
        bookingId: activeBooking.id,
        code: activeBooking.code,
        status: activeBooking.status,
        statusLabel: statusLabels[activeBooking.status] || activeBooking.status,
        outletName: activeBooking.outlet.name,
        mechanicName: activeBooking.mechanic?.name || "Belum Ditugaskan",
        queueNumber: activeBooking.queueNumber,
        queuePosition: queueInfo?.positionInQueue,
        estimatedWaitMinutes: queueInfo?.estimatedWaitMinutes,
      },
    };
  }

  // 4. INTENT: SERVICE_PRICE_LIST
  if (intent === "SERVICE_PRICE_LIST") {
    const { categoryId, vehicleType } = params;
    const servicesResult = await catalogService.listPublicServices({
      query: { categoryId, vehicleType, limit: 50 },
    });
    const services = servicesResult.items || [];

    return {
      type: "PRICE_LIST",
      title: "Daftar Harga Layanan Servis",
      message: `Menampilkan ${services.length} layanan servis bengkel.`,
      data: {
        services: services.map((s) => ({
          id: s.id,
          name: s.name,
          category: s.category?.name,
          price: s.price,
          formattedPrice: `Rp ${s.price.toLocaleString("id-ID")}`,
          estimatedMinutes: s.estimatedMinutes,
        })),
      },
    };
  }

  // 5. INTENT: MY_NEXT_SERVICE
  if (intent === "MY_NEXT_SERVICE") {
    const { vehicleId } = params;

    const where = {
      userId: actor.id,
      status: { in: ["SCHEDULED", "REMINDED", "DUE"] },
    };
    if (vehicleId) {
      where.vehicleId = vehicleId;
    }

    const reminders = await prisma.serviceReminder.findMany({
      where,
      include: {
        service: { select: { id: true, name: true } },
        vehicle: { select: { id: true, plateNumber: true, brand: true, model: true } },
      },
      orderBy: { dueDate: "asc" },
      take: 5,
    });

    if (reminders.length === 0) {
      return {
        type: "NEXT_SERVICE",
        title: "Jadwal Servis Berkala",
        message: "Tidak ada jadwal servis berkala yang akan datang untuk kendaraan Anda.",
        data: [],
      };
    }

    const formattedReminders = reminders.map((r) => ({
      id: r.id,
      serviceName: r.service.name,
      vehicle: `${r.vehicle.brand} ${r.vehicle.model} (${r.vehicle.plateNumber})`,
      dueDate: DateTime.fromJSDate(r.dueDate).setZone(RULES.TIMEZONE).toFormat("dd LLL yyyy"),
      dueOdometerKm: r.dueOdometerKm,
      status: r.status,
    }));

    const earliest = formattedReminders[0];

    return {
      type: "NEXT_SERVICE",
      title: "Jadwal Servis Berkala Berikutnya",
      message: `Jadwal terdekat: ${earliest.serviceName} untuk ${earliest.vehicle} pada ${earliest.dueDate}.`,
      data: formattedReminders,
    };
  }

  throw new NotFoundError("Intent assistant tidak dikenali", "INTENT_NOT_FOUND");
};

export default {
  getMenu,
  queryAssistant,
};
