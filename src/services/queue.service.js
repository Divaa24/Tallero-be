// ==============================================================================
// TALLERO AUTO — QUEUE SERVICE
// Logika antrian bengkel, alokasi kepala antrian, dan perlindungan anti-menyelak
// Sesuai AGENTS.md §2, §6 & §8
// ==============================================================================

import { DateTime } from "luxon";
import prisma, { lockOutlet } from "../config/prisma.js";
import RULES from "../config/rules.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../utils/errors.js";
import { emitRealtimeEvent } from "./realtime.service.js";
import { transition } from "./bookingStateMachine.service.js";
import {
  formatBookingForActor,
  getBookingById,
  getBookingSelectForRole,
} from "./bookings.service.js";

/**
 * Logika internal transaksional untuk memulai pengerjaan booking
 * Memverifikasi:
 * 1. Mekanik belum melebihi batas pengerjaan aktif (MAX_ACTIVE_JOBS_PER_MECHANIC = 1)
 * 2. Booking harus merupakan kepala antrian untuk mekanik tersebut (anti-menyelak)
 * 3. Pemotongan stok suku cadang APPROVED secara atomik
 * 4. Transisi status CHECKED_IN -> IN_PROGRESS via state machine
 */
export const startBookingInternal = async (
  tx,
  booking,
  targetMechanicId,
  actor,
  now = new Date()
) => {
  const mechanic = await tx.user.findFirst({
    where: {
      id: targetMechanicId,
      role: "MECHANIC",
      isActive: true,
      isVerified: true,
      outletId: booking.outletId,
    },
    select: { id: true },
  });
  if (!mechanic) {
    throw new ConflictError(
      "Mekanik tidak aktif atau tidak bertugas di outlet ini",
      "INVALID_MECHANIC"
    );
  }
  if (
    actor.role === "MECHANIC" &&
    (actor.id !== targetMechanicId || actor.outletId !== booking.outletId)
  ) {
    throw new ForbiddenError(
      "Mekanik hanya dapat memulai pekerjaannya di outlet sendiri",
      "FORBIDDEN"
    );
  }
  if (booking.mechanicId && booking.mechanicId !== targetMechanicId) {
    throw new ConflictError("Booking sudah ditugaskan ke mekanik lain", "BOOKING_ALREADY_ASSIGNED");
  }
  // 1. Cek batas pengerjaan aktif mekanik (maksimal 1)
  const activeJobsCount = await tx.booking.count({
    where: {
      mechanicId: targetMechanicId,
      status: { in: ["IN_PROGRESS", "WAITING_APPROVAL"] },
    },
  });

  if (activeJobsCount >= RULES.MAX_ACTIVE_JOBS_PER_MECHANIC) {
    throw new ConflictError(
      `Mekanik sudah memiliki ${activeJobsCount} pengerjaan aktif (maksimal ${RULES.MAX_ACTIVE_JOBS_PER_MECHANIC})`,
      "MAX_ACTIVE_JOBS_EXCEEDED"
    );
  }

  // 2. Evaluasi kepala antrian: CHECKED_IN dengan queueNumber terkecil di mana mechanicId IS NULL atau = targetMechanicId
  const candidateHeadList = await tx.booking.findMany({
    where: {
      outletId: booking.outletId,
      status: "CHECKED_IN",
      OR: [{ mechanicId: null }, { mechanicId: targetMechanicId }],
    },
    orderBy: { queueNumber: "asc" },
    take: 1,
  });

  if (candidateHeadList.length === 0) {
    throw new ConflictError("Tidak ada booking berstatus CHECKED_IN dalam antrian", "QUEUE_EMPTY");
  }

  const headBooking = candidateHeadList[0];
  if (headBooking.id !== booking.id) {
    throw new ConflictError(
      `Pelanggaran urutan antrian: Booking TLR #${booking.queueNumber} bukan kepala antrian. Antrian berikutnya yang berhak dikerjakan adalah nomor antrian #${headBooking.queueNumber} (${headBooking.code}).`,
      "QUEUE_ORDER_VIOLATION"
    );
  }

  // 3. Potong stok suku cadang yang disetujui (APPROVED)
  const approvedItems = await tx.bookingItem.findMany({
    where: {
      bookingId: booking.id,
      type: "SPAREPART",
      approvalStatus: "APPROVED",
      stockDeducted: false,
    },
  });

  for (const item of approvedItems) {
    if (!item.sparepartId) continue;

    const deduction = await tx.sparepart.updateMany({
      where: {
        id: item.sparepartId,
        stock: { gte: item.quantity },
      },
      data: {
        stock: { decrement: item.quantity },
      },
    });

    if (deduction.count !== 1) {
      throw new ConflictError(
        `Stok suku cadang "${item.nameSnapshot}" tidak mencukupi untuk memulai pengerjaan`,
        "STOCK_INSUFFICIENT"
      );
    }

    await tx.bookingItem.update({
      where: { id: item.id },
      data: { stockDeducted: true },
    });
  }

  // 4. Ubah status via bookingStateMachine
  const transitionResult = await transition(tx, booking.id, "IN_PROGRESS", actor, {
    now,
    mechanicId: targetMechanicId,
    note: `Pengerjaan diservis oleh mekanik ID ${targetMechanicId}`,
  });

  return transitionResult;
};

/**
 * POST /staff/queue/claim-next
 * Mekanik mengambil pekerjaan berikutnya langsung dari kepala antrian yang tersedia
 */
export const claimNextBooking = async ({ actor }) => {
  if (actor.role !== "MECHANIC") {
    throw new ForbiddenError("Hanya mekanik yang dapat melakukan claim-next antrian", "FORBIDDEN");
  }

  const result = await prisma.$transaction(async (tx) => {
    await lockOutlet(tx, actor.outletId);

    // Cari kepala antrian untuk mekanik ini
    const candidateList = await tx.booking.findMany({
      where: {
        outletId: actor.outletId,
        status: "CHECKED_IN",
        OR: [{ mechanicId: null }, { mechanicId: actor.id }],
      },
      orderBy: { queueNumber: "asc" },
      take: 1,
    });

    if (candidateList.length === 0) {
      throw new NotFoundError(
        "Tidak ada booking yang menunggu dalam antrian saat ini",
        "NO_WAITING_BOOKINGS"
      );
    }

    const bookingToClaim = candidateList[0];
    return startBookingInternal(tx, bookingToClaim, actor.id, actor);
  });

  for (const evt of result.events) {
    emitRealtimeEvent(evt.event, evt.payload, evt.rooms);
  }
  emitRealtimeEvent(
    "queue:updated",
    { outletId: actor.outletId, action: "CLAIMED", bookingId: result.booking.id },
    [`outlet:${actor.outletId}:staff`, "admin"]
  );

  return getBookingById({ actor, bookingId: result.booking.id });
};

/**
 * GET /staff/queue
 * Menampilkan ringkasan antrian 5 bagian (waiting, inProgress, waitingApproval, readyForPickup, expectedToday)
 * dengan penyembunyian/masking data customer sesuai AGENTS.md §6.
 */
export const getStaffQueue = async ({ actor, outletId }) => {
  let targetOutletId = actor.role === "MECHANIC" ? actor.outletId : outletId;

  if (!targetOutletId) {
    const firstActiveOutlet = await prisma.outlet.findFirst({
      where: { isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!firstActiveOutlet) {
      return {
        outletId: null,
        waiting: [],
        inProgress: [],
        waitingApproval: [],
        readyForPickup: [],
        expectedToday: [],
      };
    }
    targetOutletId = firstActiveOutlet.id;
  }

  const outlet = await prisma.outlet.findFirst({
    where: { id: targetOutletId, isActive: true, deletedAt: null },
  });

  if (!outlet) {
    throw new NotFoundError("Outlet tidak ditemukan atau tidak aktif", "OUTLET_NOT_FOUND");
  }

  const tz = outlet.timezone || RULES.TIMEZONE;
  const todayStr = DateTime.now().setZone(tz).toISODate();
  const dayStart = new Date(`${todayStr}T00:00:00.000Z`);
  const dayEnd = new Date(`${todayStr}T23:59:59.999Z`);

  const select = getBookingSelectForRole(actor.role);

  const [waitingRaw, inProgressRaw, waitingApprovalRaw, readyForPickupRaw, expectedTodayRaw] =
    await Promise.all([
      prisma.booking.findMany({
        where: { outletId: targetOutletId, status: "CHECKED_IN" },
        select,
        orderBy: { queueNumber: "asc" },
      }),
      prisma.booking.findMany({
        where: { outletId: targetOutletId, status: "IN_PROGRESS" },
        select,
        orderBy: { startedAt: "asc" },
      }),
      prisma.booking.findMany({
        where: { outletId: targetOutletId, status: "WAITING_APPROVAL" },
        select,
        orderBy: { updatedAt: "asc" },
      }),
      prisma.booking.findMany({
        where: { outletId: targetOutletId, status: "READY_FOR_PICKUP" },
        select,
        orderBy: { readyAt: "asc" },
      }),
      prisma.booking.findMany({
        where: {
          outletId: targetOutletId,
          status: "PENDING",
          scheduledAt: { gte: dayStart, lte: dayEnd },
        },
        select,
        orderBy: { scheduledAt: "asc" },
      }),
    ]);

  const waiting = waitingRaw.map((row, idx) => ({
    ...formatBookingForActor(row, actor),
    isNext: idx === 0,
  }));

  const inProgress = inProgressRaw.map((r) => formatBookingForActor(r, actor));
  const waitingApproval = waitingApprovalRaw.map((r) => formatBookingForActor(r, actor));
  const readyForPickup = readyForPickupRaw.map((r) => formatBookingForActor(r, actor));
  const expectedToday = expectedTodayRaw.map((r) => formatBookingForActor(r, actor));

  return {
    outletId: targetOutletId,
    outletName: outlet.name,
    date: todayStr,
    waiting,
    inProgress,
    waitingApproval,
    readyForPickup,
    expectedToday,
  };
};

/**
 * GET /bookings/:id/queue-position
 * Customer pemilik booking melihat posisi nomor antrian, antrian di depan, dan estimasi waktu tunggu
 */
export const getQueuePosition = async ({ actor, bookingId }) => {
  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      customerId: actor.id,
    },
    select: {
      id: true,
      code: true,
      outletId: true,
      status: true,
      queueNumber: true,
      queueDate: true,
    },
  });

  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  if (booking.status !== "CHECKED_IN") {
    return {
      bookingId: booking.id,
      code: booking.code,
      status: booking.status,
      queueNumber: booking.queueNumber,
      aheadCount: 0,
      estimatedWaitMinutes: 0,
      activeMechanicCount: 0,
    };
  }

  const [aheadBookings, activeMechanicCount] = await Promise.all([
    prisma.booking.findMany({
      where: {
        outletId: booking.outletId,
        status: "CHECKED_IN",
        queueNumber: { lt: booking.queueNumber },
      },
      select: {
        id: true,
        items: {
          select: {
            service: { select: { estimatedMinutes: true } },
          },
        },
      },
    }),
    prisma.user.count({
      where: {
        outletId: booking.outletId,
        role: "MECHANIC",
        isActive: true,
        deletedAt: null,
      },
    }),
  ]);

  const aheadCount = aheadBookings.length;
  const divider = Math.max(1, activeMechanicCount);

  // Estimasi durasi booking di depan (rata-rata 30 menit jika tidak didefinisikan)
  const totalAheadMinutes = aheadBookings.reduce((sum, b) => {
    const serviceMinutes = b.items.reduce(
      (acc, it) => acc + (it.service?.estimatedMinutes || 30),
      0
    );
    return sum + (serviceMinutes > 0 ? serviceMinutes : 30);
  }, 0);

  const estimatedWaitMinutes =
    aheadCount === 0 ? 0 : Math.max(5, Math.ceil(totalAheadMinutes / divider));

  return {
    bookingId: booking.id,
    code: booking.code,
    status: booking.status,
    queueNumber: booking.queueNumber,
    aheadCount,
    estimatedWaitMinutes,
    activeMechanicCount,
  };
};

/**
 * GET /staff/me/jobs
 * Mekanik melihat daftar pekerjaan yang ditugaskan kepada dirinya
 */
export const getStaffMeJobs = async ({ actor }) => {
  if (actor.role !== "MECHANIC") {
    throw new ForbiddenError(
      "Endpoint ini hanya dapat diakses oleh pengguna dengan role MECHANIC",
      "FORBIDDEN"
    );
  }

  const select = getBookingSelectForRole("MECHANIC");

  const [activeJobRaw, assignedUpcomingRaw, completedTodayRaw] = await Promise.all([
    prisma.booking.findFirst({
      where: {
        mechanicId: actor.id,
        status: { in: ["IN_PROGRESS", "WAITING_APPROVAL"] },
      },
      select,
    }),
    prisma.booking.findMany({
      where: {
        mechanicId: actor.id,
        status: "CHECKED_IN",
      },
      select,
      orderBy: { queueNumber: "asc" },
    }),
    prisma.booking.findMany({
      where: {
        mechanicId: actor.id,
        status: "COMPLETED",
        completedAt: {
          gte: DateTime.now().setZone(RULES.TIMEZONE).startOf("day").toJSDate(),
        },
      },
      select,
      orderBy: { completedAt: "desc" },
    }),
  ]);

  return {
    activeJob: activeJobRaw ? formatBookingForActor(activeJobRaw, actor) : null,
    assignedUpcoming: assignedUpcomingRaw.map((r) => formatBookingForActor(r, actor)),
    completedToday: completedTodayRaw.map((r) => formatBookingForActor(r, actor)),
  };
};

export default {
  startBookingInternal,
  claimNextBooking,
  getStaffQueue,
  getQueuePosition,
  getStaffMeJobs,
};
