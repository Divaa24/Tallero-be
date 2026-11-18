import crypto from "node:crypto";
import { DateTime } from "luxon";
import prisma from "../config/prisma.js";
import env from "../config/env.js";
import RULES from "../config/rules.js";
import logger from "../config/logger.js";
import { recordAuditLog } from "./audit.service.js";
import { lockOutlet, lockCustomer, lockBooking } from "../config/prisma.js";
import { hmacSha256, safeCompare } from "../utils/crypto.js";
import { buildPaginationMeta, parsePagination, parseSort } from "../utils/pagination.js";
import { createSignedUrl } from "../utils/signedUrl.js";
import {
  BadRequestError,
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../utils/errors.js";
import { getOutletAvailability, validateAndComputeBookingSlot } from "./availability.service.js";
import { transition } from "./bookingStateMachine.service.js";
import {
  startBookingInternal,
  claimNextBooking,
  getStaffQueue,
  getQueuePosition,
  getStaffMeJobs,
} from "./queue.service.js";
import { emitRealtimeEvent } from "./realtime.service.js";
import { saveProcessedBookingPhoto } from "./files.service.js";
import { sendMail, buildReadyForPickupEmail } from "./mail.service.js";
import { generateInvoiceNumber } from "./payments.service.js";
import { evaluateOdometerReminders } from "./reminders.service.js";

const BOOKING_SORT_FIELDS = ["id", "scheduledAt", "createdAt", "total", "status"];

/**
 * Filter akses data booking langsung di query (IDOR protection per role sesuai AGENTS.md §6)
 */
export const bookingScope = (actor) => {
  if (actor.role === "CUSTOMER") {
    return { customerId: actor.id };
  }
  if (actor.role === "MECHANIC") {
    return { outletId: actor.outletId };
  }
  if (actor.role === "ADMIN") {
    return {};
  }
  return { id: -1 };
};

const customerBookingSelect = {
  id: true,
  code: true,
  customerId: true,
  outletId: true,
  vehicleId: true,
  mechanicId: true,
  scheduledAt: true,
  slotEndAt: true,
  status: true,
  queueDate: true,
  queueNumber: true,
  isLate: true,
  odometerKm: true,
  customerNotes: true,
  total: true,
  paymentStatus: true,
  invoiceNumber: true,
  createdAt: true,
  updatedAt: true,
  outlet: { select: { id: true, name: true, address: true, phone: true } },
  vehicle: { select: { id: true, plateNumber: true, brand: true, model: true, type: true } },
  mechanic: { select: { id: true, name: true } },
  items: {
    select: {
      id: true,
      type: true,
      serviceId: true,
      sparepartId: true,
      nameSnapshot: true,
      unitPrice: true,
      quantity: true,
      subtotal: true,
      source: true,
      approvalStatus: true,
      note: true,
      rejectReason: true,
    },
  },
};

const mechanicBookingSelect = {
  ...customerBookingSelect,
  staffNotes: true,
  customer: { select: { id: true, name: true, phone: true } },
};

const adminBookingSelect = {
  ...mechanicBookingSelect,
  customer: { select: { id: true, name: true, email: true, phone: true } },
  mechanic: { select: { id: true, name: true, email: true, phone: true } },
};

export const getBookingSelectForRole = (role) => {
  if (role === "ADMIN") return adminBookingSelect;
  if (role === "MECHANIC") return mechanicBookingSelect;
  return customerBookingSelect;
};

export const formatBookingForActor = (booking, actor) => {
  if (!booking) return null;
  const clone = { ...booking };

  if (actor.role === "CUSTOMER") {
    if (clone.mechanic) {
      clone.mechanic = {
        id: clone.mechanic.id,
        name: clone.mechanic.name,
      };
    }
  }

  if (actor.role === "MECHANIC") {
    if (clone.customer) {
      const firstName = clone.customer.name.trim().split(" ")[0];
      const isAssigned = clone.mechanicId === actor.id;
      clone.customer = {
        id: clone.customer.id,
        name: firstName,
        phone: isAssigned ? clone.customer.phone : null,
      };
    }
  }

  return clone;
};

export const generateBookingCode = (dateStr) => {
  const cleanDate = dateStr.replace(/-/g, "").slice(0, 8);
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let randomPart = "";
  for (let i = 0; i < 6; i++) {
    randomPart += chars[crypto.randomInt(0, chars.length)];
  }
  return `TLR-${cleanDate}-${randomPart}`;
};

export const generateBookingQrPayload = (code) => {
  const hmac16 = hmacSha256(code, env.JWT_SECRET).slice(0, 16);
  return `${code}.${hmac16}`;
};

export const verifyBookingQrPayload = (payload) => {
  if (!payload || typeof payload !== "string") {
    return { valid: false, reason: "INVALID_QR_FORMAT" };
  }
  const parts = payload.trim().split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "INVALID_QR_FORMAT" };
  }
  const [code, hmac] = parts;
  if (!code || !hmac || hmac.length !== 16) {
    return { valid: false, reason: "INVALID_QR_FORMAT" };
  }

  const expectedHmac = hmacSha256(code, env.JWT_SECRET).slice(0, 16);
  const isValid = safeCompare(hmac, expectedHmac);

  return {
    valid: isValid,
    code,
    reason: isValid ? null : "TAMPERED_QR_PAYLOAD",
  };
};

export { getOutletAvailability };

export const createBooking = async ({ actor, data }) => {
  const created = await prisma.$transaction(
    async (tx) => {
      await lockCustomer(tx, actor.id);
      await lockOutlet(tx, data.outletId);
      const outlet = await tx.outlet.findFirst({
        where: { id: data.outletId, isActive: true },
      });
      const vehicle = await tx.vehicle.findFirst({
        where: { id: data.vehicleId, userId: actor.id },
      });
      const customerActiveBookings = await tx.booking.count({
        where: {
          customerId: actor.id,
          status: { notIn: ["COMPLETED", "CANCELLED", "NO_SHOW"] },
        },
      });
      const vehicleActiveBookings = await tx.booking.count({
        where: {
          vehicleId: data.vehicleId,
          status: { notIn: ["COMPLETED", "CANCELLED", "NO_SHOW"] },
        },
      });

      if (!outlet) {
        throw new NotFoundError("Outlet tidak ditemukan atau tidak aktif", "OUTLET_NOT_FOUND");
      }

      if (!vehicle) {
        throw new NotFoundError(
          "Kendaraan tidak ditemukan atau bukan milik Anda",
          "VEHICLE_NOT_FOUND"
        );
      }

      if (customerActiveBookings >= RULES.MAX_ACTIVE_BOOKINGS_PER_CUSTOMER) {
        throw new ConflictError(
          `Pelanggan telah mencapai batas maksimal ${RULES.MAX_ACTIVE_BOOKINGS_PER_CUSTOMER} booking aktif secara bersamaan`,
          "MAX_ACTIVE_BOOKINGS_EXCEEDED"
        );
      }

      if (vehicleActiveBookings > 0) {
        throw new ConflictError(
          "Kendaraan ini masih memiliki reservasi aktif yang belum selesai",
          "VEHICLE_HAS_ACTIVE_BOOKING"
        );
      }

      const closures = await tx.outletClosure.findMany({
        where: { outletId: outlet.id },
      });

      const { scheduledAt, slotEndAt, startDt } = validateAndComputeBookingSlot({
        outlet,
        scheduledAt: data.scheduledAt,
        now: new Date(),
        closures,
      });

      const serviceItemsInput = data.items.filter((i) => i.type === "SERVICE");
      const sparepartItemsInput = data.items.filter((i) => i.type === "SPAREPART");

      const serviceIds = serviceItemsInput.map((i) => i.serviceId);
      const sparepartIds = sparepartItemsInput.map((i) => i.sparepartId);

      const servicesDb = await (serviceIds.length > 0
        ? tx.service.findMany({
            where: { id: { in: serviceIds }, isActive: true },
          })
        : []);
      const sparepartsDb = await (sparepartIds.length > 0
        ? tx.sparepart.findMany({
            where: { id: { in: sparepartIds }, isActive: true },
          })
        : []);

      if (servicesDb.length !== serviceIds.length) {
        throw new BadRequestError(
          "Satu atau lebih layanan tidak ditemukan atau tidak aktif",
          "INVALID_SERVICE"
        );
      }

      if (sparepartsDb.length !== sparepartIds.length) {
        throw new BadRequestError(
          "Satu atau lebih suku cadang tidak ditemukan atau tidak aktif",
          "INVALID_SPAREPART"
        );
      }

      for (const s of servicesDb) {
        if (s.vehicleType && s.vehicleType !== vehicle.type) {
          throw new BusinessRuleError(
            `Layanan "${s.name}" hanya diperuntukkan bagi kendaraan jenis ${s.vehicleType}`,
            "INCOMPATIBLE_VEHICLE_TYPE"
          );
        }
      }

      for (const partInput of sparepartItemsInput) {
        const partDb = sparepartsDb.find((p) => p.id === partInput.sparepartId);
        if (!partDb || partDb.stock < partInput.quantity) {
          throw new ConflictError(
            `Stok suku cadang "${partDb?.name || partInput.sparepartId}" tidak mencukupi untuk jumlah yang diminta`,
            "SPAREPART_OUT_OF_STOCK"
          );
        }
      }

      const itemsToCreate = [];
      let calculatedTotal = 0;

      for (const sInput of serviceItemsInput) {
        const sDb = servicesDb.find((s) => s.id === sInput.serviceId);
        const subtotal = sDb.price * sInput.quantity;
        calculatedTotal += subtotal;
        itemsToCreate.push({
          type: "SERVICE",
          serviceId: sDb.id,
          nameSnapshot: sDb.name,
          unitPrice: sDb.price,
          quantity: sInput.quantity,
          subtotal,
          source: "CUSTOMER_BOOKING",
          approvalStatus: "APPROVED",
          requestedById: actor.id,
          decidedById: actor.id,
          decidedAt: new Date(),
          stockDeducted: false,
        });
      }

      for (const pInput of sparepartItemsInput) {
        const pDb = sparepartsDb.find((p) => p.id === pInput.sparepartId);
        const subtotal = pDb.price * pInput.quantity;
        calculatedTotal += subtotal;
        itemsToCreate.push({
          type: "SPAREPART",
          sparepartId: pDb.id,
          nameSnapshot: pDb.name,
          unitPrice: pDb.price,
          quantity: pInput.quantity,
          subtotal,
          source: "CUSTOMER_BOOKING",
          approvalStatus: "APPROVED",
          requestedById: actor.id,
          decidedById: actor.id,
          decidedAt: new Date(),
          stockDeducted: false,
        });
      }

      const activeInSlot = await tx.booking.count({
        where: {
          outletId: outlet.id,
          scheduledAt,
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
        },
      });

      if (activeInSlot >= outlet.slotCapacity) {
        throw new ConflictError(
          "Kapasitas slot untuk waktu yang dipilih telah penuh. Silakan pilih slot lain.",
          "SLOT_FULL"
        );
      }

      const dateStr = startDt.toISODate();
      let bookingCode = "";
      let attempts = 0;
      while (attempts < 5) {
        bookingCode = generateBookingCode(dateStr);
        const existing = await tx.booking.findUnique({
          where: { code: bookingCode },
          select: { id: true },
        });
        if (!existing) break;
        attempts++;
      }

      const booking = await tx.booking.create({
        data: {
          code: bookingCode,
          customerId: actor.id,
          outletId: outlet.id,
          vehicleId: vehicle.id,
          scheduledAt,
          slotEndAt,
          status: "PENDING",
          customerNotes: data.customerNotes || null,
          total: calculatedTotal,
          paymentStatus: "UNPAID",
          items: {
            create: itemsToCreate,
          },
        },
        select: customerBookingSelect,
      });

      await tx.bookingLog.create({
        data: {
          bookingId: booking.id,
          actorId: actor.id,
          actorRole: actor.role,
          toStatus: "PENDING",
          note: "Booking dibuat oleh pelanggan",
        },
      });
      return booking;
    },
    { maxWait: 15000, timeout: 20000 }
  );

  emitRealtimeEvent(
    "booking:created",
    {
      bookingId: created.id,
      code: created.code,
      outletId: created.outletId,
      customerId: created.customerId,
    },
    ["admin", `outlet:${created.outletId}:staff`]
  );

  return formatBookingForActor(created, actor);
};

export const listBookings = async ({ actor, query }) => {
  const { page, limit, skip } = parsePagination(query);
  const orderBy = parseSort(query.sort, BOOKING_SORT_FIELDS, { scheduledAt: "desc" });
  const select = getBookingSelectForRole(actor.role);

  const where = {
    ...bookingScope(actor),
  };

  if (query.status) {
    where.status = query.status;
  }

  if (query.outletId && actor.role === "ADMIN") {
    where.outletId = query.outletId;
  }

  if (query.date) {
    const zone = actor.outletId
      ? (
          await prisma.outlet.findUnique({
            where: { id: actor.outletId },
            select: { timezone: true },
          })
        )?.timezone
      : query.outletId
        ? (
            await prisma.outlet.findUnique({
              where: { id: query.outletId },
              select: { timezone: true },
            })
          )?.timezone
        : RULES.TIMEZONE;
    const day = DateTime.fromISO(query.date, { zone: zone || RULES.TIMEZONE });
    const dayStart = day.startOf("day").toUTC().toJSDate();
    const dayEnd = day.endOf("day").toUTC().toJSDate();
    where.scheduledAt = { gte: dayStart, lte: dayEnd };
  }

  if (query.search) {
    where.OR = [
      { code: { contains: query.search, mode: "insensitive" } },
      { vehicle: { plateNumber: { contains: query.search, mode: "insensitive" } } },
      { customer: { name: { contains: query.search, mode: "insensitive" } } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      select,
      skip,
      take: limit,
      orderBy,
    }),
  ]);

  return {
    items: rows.map((r) => formatBookingForActor(r, actor)),
    meta: buildPaginationMeta({ page, limit, total }),
  };
};

export const getBookingById = async ({ actor, bookingId }) => {
  const select = getBookingSelectForRole(actor.role);
  const where = {
    id: bookingId,
    ...bookingScope(actor),
  };

  const booking = await prisma.booking.findFirst({ where, select });
  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  return formatBookingForActor(booking, actor);
};

export const getBookingLogs = async ({ actor, bookingId }) => {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, ...bookingScope(actor) },
    select: { id: true },
  });

  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  const logs = await prisma.bookingLog.findMany({
    where: { bookingId },
    select: {
      id: true,
      bookingId: true,
      actorId: true,
      actorRole: true,
      fromStatus: true,
      toStatus: true,
      note: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return logs;
};

export const getBookingQr = async ({ actor, bookingId }) => {
  if (actor.role !== "CUSTOMER") {
    throw new ForbiddenError(
      "QR check-in hanya dapat diakses oleh customer pemilik booking",
      "FORBIDDEN"
    );
  }

  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, customerId: actor.id },
    select: { id: true, code: true, scheduledAt: true, status: true },
  });

  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  if (booking.status !== "PENDING") {
    throw new ConflictError(
      "QR check-in hanya tersedia untuk booking dengan status PENDING",
      "INVALID_BOOKING_STATUS"
    );
  }

  const qrPayload = generateBookingQrPayload(booking.code);

  return {
    bookingId: booking.id,
    code: booking.code,
    qrPayload,
    scheduledAt: booking.scheduledAt,
  };
};

export const cancelBooking = async ({ actor, bookingId, reason }) => {
  const result = await prisma.$transaction(async (tx) => {
    return transition(tx, bookingId, "CANCELLED", actor, { reason });
  });

  for (const evt of result.events) {
    emitRealtimeEvent(evt.event, evt.payload, evt.rooms);
  }

  return {
    bookingId: result.booking.id,
    code: result.booking.code,
    status: result.booking.status,
    cancelledAt: result.booking.cancelledAt,
    cancelReason: result.booking.cancelReason,
  };
};

/**
 * ==============================================================================
 * FASE 5: CHECK-IN, ANTRIAN, DAN ALUR PENGERJAAN
 * ==============================================================================
 */

/**
 * POST /bookings/check-in
 * Memproses check-in pelanggan dengan validasi HMAC QR, verifikasi jendela waktu (hari-H, batas awal, closeTime),
 * pengecekan staf outlet, dan alokasi queueNumber atomik di bawah baris kunci outlet.
 */
export const checkInBooking = async ({ actor, data }) => {
  const verified = verifyBookingQrPayload(data.qrPayload);
  if (!verified.valid) {
    throw new BadRequestError(
      "QR check-in tidak valid atau telah dimanipulasi",
      "INVALID_QR_PAYLOAD"
    );
  }

  const booking = await prisma.booking.findUnique({
    where: { code: verified.code },
    include: {
      outlet: true,
      vehicle: true,
    },
  });

  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  if (booking.status !== "PENDING") {
    throw new ConflictError(
      "Booking tidak berstatus PENDING untuk proses check-in",
      "INVALID_BOOKING_STATUS"
    );
  }

  if (actor.role === "MECHANIC" && actor.outletId !== booking.outletId) {
    throw new ForbiddenError(
      "Mekanik hanya dapat memproses check-in untuk outlet tempatnya bertugas",
      "FORBIDDEN_OUTLET"
    );
  }

  const outletTz = booking.outlet.timezone || RULES.TIMEZONE;
  const now = data.now instanceof Date ? data.now : data.now ? new Date(data.now) : new Date();
  const nowDt = DateTime.fromJSDate(now).setZone(outletTz);
  const scheduledDt = DateTime.fromJSDate(booking.scheduledAt).setZone(outletTz);

  // 1. Validasi hari-H
  if (nowDt.toISODate() !== scheduledDt.toISODate()) {
    throw new BusinessRuleError(
      "Check-in hanya dapat dilakukan pada tanggal jadwal pengerjaan (hari-H)",
      "CHECKIN_DATE_MISMATCH"
    );
  }

  // 2. Validasi batas awal check-in (maksimal 60 menit sebelum jadwal)
  const earlyLimitDt = scheduledDt.minus({ minutes: RULES.CHECKIN_EARLY_MINUTES });
  if (nowDt < earlyLimitDt) {
    throw new BusinessRuleError(
      `Check-in terlalu awal. Paling cepat dapat dilakukan ${RULES.CHECKIN_EARLY_MINUTES} menit sebelum waktu jadwal`,
      "CHECKIN_TOO_EARLY"
    );
  }

  // 3. Validasi batas akhir: sebelum outlet tutup
  const [closeH, closeM] = booking.outlet.closeTime.split(":").map(Number);
  const closeDt = scheduledDt.set({ hour: closeH, minute: closeM, second: 0, millisecond: 0 });
  if (nowDt >= closeDt) {
    throw new BusinessRuleError(
      "Outlet telah tutup. Tidak dapat memproses check-in untuk jadwal ini",
      "OUTLET_ALREADY_CLOSED"
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await lockOutlet(tx, booking.outletId);

    const queueDateStr = nowDt.toISODate();
    const queueDate = new Date(`${queueDateStr}T00:00:00.000Z`);

    const maxQueue = await tx.booking.aggregate({
      where: {
        outletId: booking.outletId,
        queueDate,
      },
      _max: { queueNumber: true },
    });
    const nextQueueNumber = (maxQueue._max?.queueNumber || 0) + 1;
    const isLate = nowDt > scheduledDt;

    // Perbarui odometer kendaraan jika disertakan
    if (data.odometerKm && data.odometerKm > 0) {
      if (!booking.vehicle.lastOdometerKm || data.odometerKm > booking.vehicle.lastOdometerKm) {
        await tx.vehicle.update({
          where: { id: booking.vehicleId },
          data: { lastOdometerKm: data.odometerKm },
        });
      }
    }

    return transition(tx, booking.id, "CHECKED_IN", actor, {
      queueDate,
      queueNumber: nextQueueNumber,
      isLate,
      odometerKm: data.odometerKm,
      now: nowDt.toJSDate(),
      note: `Check-in berhasil. Nomor antrian: ${nextQueueNumber}${isLate ? " (Terlambat)" : ""}`,
    });
  });

  for (const evt of result.events) {
    emitRealtimeEvent(evt.event, evt.payload, evt.rooms);
  }
  emitRealtimeEvent(
    "queue:updated",
    { outletId: booking.outletId, action: "CHECKED_IN", bookingId: booking.id },
    [`outlet:${booking.outletId}:staff`, "admin"]
  );

  return getBookingById({ actor, bookingId: booking.id });
};

/**
 * POST /bookings/:id/assign
 * Admin menugaskan mekanik ke booking tertentu
 */
export const assignMechanic = async ({ actor, bookingId, mechanicId }) => {
  if (actor.role !== "ADMIN") {
    throw new ForbiddenError("Hanya admin yang berhak menugaskan mekanik ke booking", "FORBIDDEN");
  }

  const [booking, mechanic] = await Promise.all([
    prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, code: true, outletId: true, status: true, mechanicId: true },
    }),
    prisma.user.findFirst({
      where: { id: mechanicId, role: "MECHANIC", isActive: true, deletedAt: null },
      select: { id: true, name: true, outletId: true },
    }),
  ]);

  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  if (!mechanic) {
    throw new BadRequestError("Mekanik tidak ditemukan atau tidak aktif", "INVALID_MECHANIC");
  }

  if (booking.outletId !== mechanic.outletId) {
    throw new BusinessRuleError(
      "Mekanik harus bertugas di outlet yang sama dengan lokasi booking",
      "INVALID_MECHANIC"
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: { mechanicId },
    });

    await tx.bookingLog.create({
      data: {
        bookingId,
        actorId: actor.id,
        actorRole: actor.role,
        fromStatus: booking.status,
        toStatus: booking.status,
        note: `Mekanik ditugaskan oleh admin: ${mechanic.name}`,
      },
    });
  });

  emitRealtimeEvent(
    "queue:updated",
    { outletId: booking.outletId, action: "ASSIGNED", bookingId, mechanicId },
    [`outlet:${booking.outletId}:staff`, "admin"]
  );

  return getBookingById({ actor, bookingId });
};

/**
 * POST /bookings/:id/start
 * Staf memulai pengerjaan booking dengan mematuhi aturan kepala antrian & pemotongan stok atomik
 */
export const startBooking = async ({ actor, bookingId, mechanicId }) => {
  const targetMechanicId = actor.role === "MECHANIC" ? actor.id : mechanicId;

  const initialBooking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, outletId: true, status: true, mechanicId: true },
  });

  if (!initialBooking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  if (initialBooking.status !== "CHECKED_IN") {
    throw new ConflictError(
      "Hanya booking dengan status CHECKED_IN yang dapat dimulai",
      "INVALID_BOOKING_STATUS"
    );
  }

  if (actor.role === "MECHANIC" && actor.outletId !== initialBooking.outletId) {
    throw new ForbiddenError(
      "Mekanik hanya dapat memulai pekerjaan di outlet tempatnya bertugas",
      "FORBIDDEN_OUTLET"
    );
  }

  const finalMechanicId = targetMechanicId || initialBooking.mechanicId;
  if (!finalMechanicId) {
    throw new BadRequestError(
      "Mekanik penangan wajib ditentukan sebelum memulai pekerjaan",
      "MECHANIC_REQUIRED"
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await lockOutlet(tx, initialBooking.outletId);

    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
    });

    return startBookingInternal(tx, booking, finalMechanicId, actor);
  });

  for (const evt of result.events) {
    emitRealtimeEvent(evt.event, evt.payload, evt.rooms);
  }
  emitRealtimeEvent(
    "queue:updated",
    { outletId: initialBooking.outletId, action: "STARTED", bookingId },
    [`outlet:${initialBooking.outletId}:staff`, "admin"]
  );

  return getBookingById({ actor, bookingId });
};

export { claimNextBooking, getStaffQueue, getQueuePosition, getStaffMeJobs };

/**
 * ==============================================================================
 * FASE 6: ITEM TAMBAHAN, PERSETUJUAN, INSPEKSI, FOTO, SIAP DIAMBIL
 * ==============================================================================
 */

/**
 * POST /bookings/:id/items
 * Menambahkan item SERVICE atau SPAREPART tambahan saat IN_PROGRESS oleh mekanik penangan / admin.
 * Status booking otomatis berubah menjadi WAITING_APPROVAL.
 */
export const addBookingItem = async ({ actor, bookingId, data }) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      code: true,
      customerId: true,
      outletId: true,
      mechanicId: true,
      status: true,
    },
  });

  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  if (actor.role === "MECHANIC" && booking.mechanicId !== actor.id) {
    throw new ForbiddenError(
      "Hanya mekanik penangan yang bertugas atau admin yang dapat mengajukan item tambahan",
      "FORBIDDEN"
    );
  }

  if (booking.status !== "IN_PROGRESS") {
    throw new ConflictError(
      "Item tambahan hanya dapat diajukan saat pengerjaan booking sedang berjalan (IN_PROGRESS)",
      "INVALID_BOOKING_STATUS"
    );
  }

  let nameSnapshot = "";
  let unitPrice = 0;

  if (data.type === "SERVICE") {
    const s = await prisma.service.findFirst({
      where: { id: data.serviceId, isActive: true },
    });
    if (!s) {
      throw new BadRequestError("Layanan tidak ditemukan atau tidak aktif", "INVALID_SERVICE");
    }
    nameSnapshot = s.name;
    unitPrice = s.price;
  } else if (data.type === "SPAREPART") {
    const sp = await prisma.sparepart.findFirst({
      where: { id: data.sparepartId, isActive: true },
    });
    if (!sp) {
      throw new BadRequestError(
        "Suku cadang tidak ditemukan atau tidak aktif",
        "INVALID_SPAREPART"
      );
    }
    if (sp.stock < data.quantity) {
      throw new ConflictError(
        `Stok suku cadang "${sp.name}" tidak mencukupi untuk jumlah yang diajukan`,
        "SPAREPART_OUT_OF_STOCK"
      );
    }
    nameSnapshot = sp.name;
    unitPrice = sp.price;
  }

  const subtotal = unitPrice * data.quantity;

  const result = await prisma.$transaction(async (tx) => {
    const createdItem = await tx.bookingItem.create({
      data: {
        bookingId,
        type: data.type,
        serviceId: data.serviceId || null,
        sparepartId: data.sparepartId || null,
        nameSnapshot,
        unitPrice,
        quantity: data.quantity,
        subtotal,
        source: "MECHANIC_ADDED",
        approvalStatus: "PENDING_APPROVAL",
        requestedById: actor.id,
        stockDeducted: false,
        note: data.note,
      },
    });

    const trans = await transition(tx, booking.id, "WAITING_APPROVAL", actor, {
      note: `Pengajuan item tambahan: ${nameSnapshot} (${data.quantity}x)`,
    });

    await tx.notification.create({
      data: {
        userId: booking.customerId,
        type: "APPROVAL_REQUEST",
        title: "Persetujuan Item Tambahan",
        body: `Mekanik mengajukan pekerjaan/suku cadang tambahan "${nameSnapshot}" (${data.quantity}x). Mohon tinjau dan beri persetujuan.`,
        data: { bookingId: booking.id, itemId: createdItem.id },
      },
    });

    return { createdItem, trans };
  });

  for (const evt of result.trans.events) {
    emitRealtimeEvent(evt.event, evt.payload, evt.rooms);
  }
  emitRealtimeEvent(
    "booking:approval_requested",
    {
      bookingId: booking.id,
      itemId: result.createdItem.id,
      name: nameSnapshot,
    },
    [`user:${booking.customerId}`, `outlet:${booking.outletId}:staff`, "admin"]
  );

  return result.createdItem;
};

/**
 * DELETE /bookings/:id/items/:itemId
 * Menghapus/menarik item tambahan berstatus PENDING_APPROVAL oleh mekanik penangan / admin.
 * Jika tidak ada item pending yang tersisa, status otomatis kembali ke IN_PROGRESS.
 */
export const deleteBookingItem = async ({ actor, bookingId, itemId }) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, customerId: true, outletId: true, mechanicId: true, status: true },
  });

  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  if (actor.role === "MECHANIC" && booking.mechanicId !== actor.id) {
    throw new ForbiddenError(
      "Hanya mekanik penangan yang bertugas atau admin yang dapat menghapus item tambahan",
      "FORBIDDEN"
    );
  }

  const item = await prisma.bookingItem.findFirst({
    where: { id: itemId, bookingId },
  });

  if (!item) {
    throw new NotFoundError("Item booking tidak ditemukan", "ITEM_NOT_FOUND");
  }

  if (item.source !== "MECHANIC_ADDED" || item.approvalStatus !== "PENDING_APPROVAL") {
    throw new ConflictError(
      "Hanya item tambahan berstatus PENDING_APPROVAL yang dapat ditarik atau dihapus",
      "INVALID_ITEM_STATUS"
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.bookingItem.delete({
      where: { id: itemId },
    });

    const remainingPending = await tx.bookingItem.count({
      where: {
        bookingId,
        approvalStatus: "PENDING_APPROVAL",
      },
    });

    let transResult = null;
    if (remainingPending === 0 && booking.status === "WAITING_APPROVAL") {
      transResult = await transition(tx, booking.id, "IN_PROGRESS", actor, {
        note: "Seluruh item tambahan telah ditarik, pengerjaan servis dilanjutkan",
      });
    }

    return { transResult };
  });

  if (result.transResult) {
    for (const evt of result.transResult.events) {
      emitRealtimeEvent(evt.event, evt.payload, evt.rooms);
    }
  }

  return { success: true, message: "Item tambahan berhasil dihapus" };
};

/**
 * POST /bookings/:id/approvals
 * Memproses keputusan persetujuan batch (APPROVE / REJECT) atas item tambahan.
 * Seluruh item pending harus diputuskan lengkap tanpa duplikasi.
 */
export const decideBookingApprovals = async ({ actor, bookingId, data }) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, code: true, customerId: true, outletId: true, status: true },
  });

  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  // IDOR rule: customer lain ditolak dengan 404
  if (actor.role === "CUSTOMER" && booking.customerId !== actor.id) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  if (actor.role === "MECHANIC") {
    throw new ForbiddenError(
      "Mekanik tidak memiliki kewenangan untuk memutuskan persetujuan pelanggan",
      "FORBIDDEN"
    );
  }

  // Admin memutuskan atas nama customer wajib mengisi note minimal 10 karakter
  if (actor.role === "ADMIN") {
    if (!data.note || data.note.trim().length < 10) {
      throw new BadRequestError(
        "Catatan alasan atas nama pelanggan wajib diisi minimal 10 karakter oleh admin",
        "APPROVAL_NOTE_REQUIRED"
      );
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    await lockOutlet(tx, booking.outletId);
    await lockBooking(tx, bookingId);
    const pendingItems = await tx.bookingItem.findMany({
      where: {
        bookingId,
        approvalStatus: "PENDING_APPROVAL",
      },
    });

    if (pendingItems.length === 0) {
      throw new ConflictError(
        "Tidak ada item tambahan yang membutuhkan persetujuan pada booking ini",
        "NO_PENDING_ITEMS"
      );
    }

    // Validasi keputusan: tidak boleh ada duplikasi itemId dan harus mencakup seluruh pending item
    const decisionIds = data.decisions.map((d) => d.itemId);
    if (new Set(decisionIds).size !== data.decisions.length) {
      throw new BadRequestError(
        "Terdapat duplikasi ID item dalam daftar keputusan",
        "DUPLICATE_DECISION_ITEMS"
      );
    }

    if (data.decisions.length !== pendingItems.length) {
      throw new BadRequestError(
        "Seluruh item yang menunggu persetujuan wajib diputuskan secara lengkap dalam satu permintaan",
        "INCOMPLETE_APPROVAL_DECISIONS"
      );
    }

    for (const d of data.decisions) {
      const exists = pendingItems.some((p) => p.id === d.itemId);
      if (!exists) {
        throw new BadRequestError(
          `Item ID ${d.itemId} tidak valid atau bukan item pending pada booking ini`,
          "INVALID_DECISION_ITEM"
        );
      }
    }

    const now = new Date();

    for (const d of data.decisions) {
      const item = pendingItems.find((p) => p.id === d.itemId);
      if (d.decision === "APPROVE") {
        if (item.type === "SPAREPART" && item.sparepartId) {
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
              `Stok suku cadang "${item.nameSnapshot}" tidak mencukupi untuk disetujui`,
              "STOCK_INSUFFICIENT"
            );
          }

          await tx.bookingItem.update({
            where: { id: item.id },
            data: {
              approvalStatus: "APPROVED",
              stockDeducted: true,
              decidedById: actor.id,
              decidedAt: now,
            },
          });
        } else {
          await tx.bookingItem.update({
            where: { id: item.id },
            data: {
              approvalStatus: "APPROVED",
              decidedById: actor.id,
              decidedAt: now,
            },
          });
        }
      } else {
        // REJECT
        await tx.bookingItem.update({
          where: { id: item.id },
          data: {
            approvalStatus: "REJECTED",
            rejectReason: d.reason || "Ditolak oleh pelanggan",
            decidedById: actor.id,
            decidedAt: now,
          },
        });
      }
    }

    // Hitung ulang total resmi hanya dari item APPROVED
    const approvedItems = await tx.bookingItem.findMany({
      where: { bookingId, approvalStatus: "APPROVED" },
      select: { subtotal: true },
    });
    const newTotal = approvedItems.reduce((acc, it) => acc + it.subtotal, 0);

    await tx.booking.update({
      where: { id: bookingId },
      data: { total: newTotal },
    });

    const transResult = await transition(tx, booking.id, "IN_PROGRESS", actor, {
      now,
      note: `Keputusan item tambahan: ${data.decisions.filter((d) => d.decision === "APPROVE").length} disetujui, ${data.decisions.filter((d) => d.decision === "REJECT").length} ditolak`,
    });

    if (actor.role === "ADMIN") {
      await recordAuditLog(tx, {
        actorId: actor.id,
        action: "APPROVAL_DECISION_ON_BEHALF",
        entity: "Booking",
        entityId: booking.id,
        after: { note: data.note, decisions: data.decisions },
      });
    }

    await tx.notification.create({
      data: {
        userId: booking.customerId,
        type: "APPROVAL_REQUEST",
        title: "Keputusan Item Tambahan Selesai",
        body: `Persetujuan item tambahan pada booking ${booking.code} telah selesai diproses. Total biaya: Rp ${newTotal.toLocaleString("id-ID")}`,
        data: { bookingId: booking.id },
      },
    });

    return { transResult, newTotal };
  });

  for (const evt of result.transResult.events) {
    emitRealtimeEvent(evt.event, evt.payload, evt.rooms);
  }
  emitRealtimeEvent(
    "queue:updated",
    { outletId: booking.outletId, action: "APPROVAL_DECIDED", bookingId },
    [`outlet:${booking.outletId}:staff`, "admin"]
  );

  return getBookingById({ actor, bookingId });
};

/**
 * POST /bookings/:id/photos
 * Mengunggah foto bukti inspeksi (BEFORE/AFTER) dengan resize WebP, EXIF stripping, dan batas maksimal kuota
 */
export const uploadBookingPhoto = async ({ actor, bookingId, file, data }) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, mechanicId: true, status: true },
  });

  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  if (actor.role === "MECHANIC" && booking.mechanicId !== actor.id) {
    throw new ForbiddenError(
      "Hanya mekanik penangan atau admin yang dapat mengunggah foto inspeksi untuk booking ini",
      "FORBIDDEN"
    );
  }

  if (!["CHECKED_IN", "IN_PROGRESS", "WAITING_APPROVAL"].includes(booking.status)) {
    throw new ConflictError(
      "Foto hanya dapat diunggah saat booking berstatus CHECKED_IN, IN_PROGRESS, atau WAITING_APPROVAL",
      "INVALID_BOOKING_STATUS"
    );
  }

  const photoCount = await prisma.bookingPhoto.count({
    where: {
      bookingId,
      type: data.type,
      deletedAt: null,
    },
  });

  if (photoCount >= RULES.MAX_PHOTOS_PER_TYPE) {
    throw new BusinessRuleError(
      `Maksimal ${RULES.MAX_PHOTOS_PER_TYPE} foto diperbolehkan untuk tipe ${data.type}`,
      "MAX_PHOTOS_EXCEEDED"
    );
  }

  const saved = await saveProcessedBookingPhoto(file.buffer, booking.id);

  const photo = await prisma.bookingPhoto.create({
    data: {
      bookingId,
      type: data.type,
      storageKey: saved.storageKey,
      mimeType: saved.mimeType,
      sizeBytes: saved.sizeBytes,
      caption: data.caption || null,
      uploadedById: actor.id,
    },
    select: {
      id: true,
      bookingId: true,
      type: true,
      storageKey: true,
      sizeBytes: true,
      mimeType: true,
      caption: true,
      uploadedById: true,
      createdAt: true,
    },
  });

  const signed = createSignedUrl({
    kind: "booking-photo",
    id: photo.id,
    ttlSec: RULES.SIGNED_URL_TTL_SEC,
  });

  return {
    ...photo,
    signedUrl: signed.url,
  };
};

/**
 * GET /bookings/:id/photos
 * Menampilkan daftar foto inspeksi dengan signed URL berumur pendek
 */
export const listBookingPhotos = async ({ actor, bookingId }) => {
  const booking = await prisma.booking.findFirst({
    where: {
      id: bookingId,
      ...bookingScope(actor),
    },
    select: { id: true },
  });

  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  const photos = await prisma.bookingPhoto.findMany({
    where: {
      bookingId,
      deletedAt: null,
    },
    select: {
      id: true,
      bookingId: true,
      type: true,
      caption: true,
      sizeBytes: true,
      mimeType: true,
      uploadedById: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return photos.map((p) => {
    const signed = createSignedUrl({
      kind: "booking-photo",
      id: p.id,
      ttlSec: RULES.SIGNED_URL_TTL_SEC,
    });
    return {
      ...p,
      signedUrl: signed.url,
    };
  });
};

/**
 * DELETE /bookings/:id/photos/:photoId
 * Soft delete foto bukti inspeksi oleh uploader atau admin
 */
export const deleteBookingPhoto = async ({ actor, bookingId, photoId }) => {
  const photo = await prisma.bookingPhoto.findFirst({
    where: {
      id: photoId,
      bookingId,
      deletedAt: null,
    },
  });

  if (!photo) {
    throw new NotFoundError("Foto tidak ditemukan", "PHOTO_NOT_FOUND");
  }

  if (actor.role === "MECHANIC" && photo.uploadedById !== actor.id) {
    throw new ForbiddenError(
      "Hanya pengunggah foto atau admin yang dapat menghapus foto",
      "FORBIDDEN"
    );
  }

  await prisma.bookingPhoto.update({
    where: { id: photoId },
    data: { deletedAt: new Date() },
  });

  return { success: true, message: "Foto berhasil dihapus" };
};

/**
 * PATCH /bookings/:id/inspection
 * Memperbarui catatan inspeksi staf dan odometer kendaraan secara aman (tidak boleh turun)
 */
export const updateInspection = async ({ actor, bookingId, data }) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { vehicle: true },
  });

  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  if (actor.role === "MECHANIC" && booking.mechanicId !== actor.id) {
    throw new ForbiddenError(
      "Hanya mekanik penangan atau admin yang dapat memperbarui inspeksi booking ini",
      "FORBIDDEN"
    );
  }

  if (!["CHECKED_IN", "IN_PROGRESS", "WAITING_APPROVAL"].includes(booking.status)) {
    throw new ConflictError(
      "Inspeksi hanya dapat diperbarui saat booking berstatus CHECKED_IN, IN_PROGRESS, atau WAITING_APPROVAL",
      "INVALID_BOOKING_STATUS"
    );
  }

  if (data.odometerKm !== undefined && booking.vehicle.lastOdometerKm) {
    if (data.odometerKm < booking.vehicle.lastOdometerKm) {
      throw new BusinessRuleError(
        `Angka odometer tidak boleh lebih rendah dari angka terakhir tercatat (${booking.vehicle.lastOdometerKm} km)`,
        "INVALID_ODOMETER"
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    const updateData = {};
    if (data.odometerKm !== undefined) updateData.odometerKm = data.odometerKm;
    if (data.staffNotes !== undefined) updateData.staffNotes = data.staffNotes;

    await tx.booking.update({
      where: { id: bookingId },
      data: updateData,
    });

    if (
      data.odometerKm &&
      (!booking.vehicle.lastOdometerKm || data.odometerKm > booking.vehicle.lastOdometerKm)
    ) {
      await tx.vehicle.update({
        where: { id: booking.vehicleId },
        data: { lastOdometerKm: data.odometerKm },
      });
    }
  });

  if (data.odometerKm) {
    try {
      await evaluateOdometerReminders({
        vehicleId: booking.vehicleId,
        newOdometerKm: data.odometerKm,
      });
    } catch {
      // Best-effort evaluation
    }
  }

  return getBookingById({ actor, bookingId });
};

/**
 * POST /bookings/:id/ready
 * Menandai pengerjaan servis selesai dan kendaraan siap diambil (READY_FOR_PICKUP).
 * Menegakkan guard minimal 1 foto BEFORE & 1 foto AFTER, tak ada item pending, dan mengirimkan email notifikasi.
 */
export const markBookingReady = async ({ actor, bookingId }) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      customer: { select: { id: true, name: true, email: true } },
      outlet: { select: { id: true, name: true } },
    },
  });

  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  if (actor.role === "MECHANIC" && booking.mechanicId !== actor.id) {
    throw new ForbiddenError(
      "Hanya mekanik penangan atau admin yang dapat menandai kendaraan siap diambil",
      "FORBIDDEN"
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const trans = await transition(tx, booking.id, "READY_FOR_PICKUP", actor, {
      note: "Pengerjaan servis selesai, kendaraan siap diambil",
    });

    await tx.notification.create({
      data: {
        userId: booking.customerId,
        type: "BOOKING_STATUS",
        title: "Kendaraan Siap Diambil",
        body: `Pengerjaan servis kendaraan Anda (${booking.code}) telah selesai dan siap diambil di outlet ${booking.outlet.name}. Total tagihan: Rp ${trans.booking.total.toLocaleString("id-ID")}`,
        data: { bookingId: booking.id, code: booking.code },
      },
    });

    return trans;
  });

  for (const evt of result.events) {
    emitRealtimeEvent(evt.event, evt.payload, evt.rooms);
  }
  emitRealtimeEvent(
    "queue:updated",
    { outletId: booking.outletId, action: "READY_FOR_PICKUP", bookingId },
    [`outlet:${booking.outletId}:staff`, "admin"]
  );

  // Kirim email notifikasi (kegagalan email tidak boleh menggagalkan request utama)
  try {
    const mailContent = buildReadyForPickupEmail({
      name: booking.customer.name,
      bookingCode: booking.code,
      outletName: booking.outlet.name,
      total: result.booking.total,
    });
    await sendMail({
      to: booking.customer.email,
      subject: mailContent.subject,
      html: mailContent.html,
      text: mailContent.text,
    });
  } catch (mailErr) {
    logger.warn(
      { err: mailErr, bookingId: booking.id, customerEmail: booking.customer.email },
      "Gagal mengirimkan email pemberitahuan kendaraan siap diambil (best-effort)"
    );
  }

  return getBookingById({ actor, bookingId });
};

/**
 * POST /bookings/:id/complete
 * Menyelesaikan transaksi booking setelah invoice lunas (PAID).
 * Menegakkan guard invoice PAID, membuat ServiceReminder, dan menutup order.
 */
export const completeBooking = async ({ actor, bookingId, note }) => {
  if (actor.role !== "ADMIN") {
    throw new ForbiddenError(
      "Hanya admin yang berhak menyelesaikan transaksi booking",
      "FORBIDDEN"
    );
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      items: {
        where: { approvalStatus: "APPROVED" },
        include: { service: true },
      },
      vehicle: true,
      outlet: { select: { id: true, name: true } },
    },
  });

  if (!booking) {
    throw new NotFoundError("Booking tidak ditemukan", "BOOKING_NOT_FOUND");
  }

  if (booking.status !== "READY_FOR_PICKUP") {
    throw new ConflictError(
      `Booking hanya dapat diselesaikan dari status READY_FOR_PICKUP. Status saat ini: ${booking.status}`,
      "INVALID_BOOKING_STATUS"
    );
  }

  if (booking.paymentStatus !== "PAID") {
    throw new ConflictError(
      "Pembayaran booking belum lunas (UNPAID). Tidak dapat diselesaikan.",
      "BOOKING_NOT_PAID"
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await lockBooking(tx, bookingId);
    let invoiceNumber = booking.invoiceNumber;
    if (!invoiceNumber) {
      invoiceNumber = await generateInvoiceNumber(tx);
    }

    const trans = await transition(tx, booking.id, "COMPLETED", actor, {
      note: note || "Transaksi lunas dan kendaraan diserahkan ke pelanggan",
      invoiceNumber,
    });

    // Buat ServiceReminder untuk setiap layanan berkala
    const completedAt = trans.booking.completedAt || new Date();
    for (const item of booking.items) {
      if (item.type === "SERVICE" && item.service) {
        const { reminderIntervalDays, reminderIntervalKm } = item.service;
        if (reminderIntervalDays || reminderIntervalKm) {
          // Tandai reminder lama untuk kendaraan & layanan yang sama sebagai DONE
          await tx.serviceReminder.updateMany({
            where: {
              vehicleId: booking.vehicleId,
              serviceId: item.service.id,
              status: { in: ["SCHEDULED", "REMINDED", "DUE"] },
            },
            data: { status: "DONE" },
          });

          const dueDate = reminderIntervalDays
            ? new Date(completedAt.getTime() + reminderIntervalDays * 24 * 60 * 60 * 1000)
            : new Date(completedAt.getTime() + 180 * 24 * 60 * 60 * 1000);

          const dueOdometerKm = reminderIntervalKm
            ? (booking.odometerKm || booking.vehicle.lastOdometerKm || 0) + reminderIntervalKm
            : null;

          await tx.serviceReminder.create({
            data: {
              vehicleId: booking.vehicleId,
              userId: booking.customerId,
              serviceId: item.service.id,
              sourceBookingId: booking.id,
              dueDate,
              dueOdometerKm,
              status: "SCHEDULED",
            },
          });
        }
      }
    }

    // Notifikasi customer
    await tx.notification.create({
      data: {
        userId: booking.customerId,
        type: "BOOKING_STATUS",
        title: "Servis Selesai & Diserahkan",
        body: `Transaksi booking ${booking.code} telah selesai dan kendaraan Anda telah diserahkan. Terima kasih telah mempercayakan kendaraan Anda pada Tallero Auto!`,
        data: { bookingId: booking.id, code: booking.code },
      },
    });

    return trans;
  });

  for (const evt of result.events) {
    emitRealtimeEvent(evt.event, evt.payload, evt.rooms);
  }
  emitRealtimeEvent(
    "queue:updated",
    { outletId: booking.outletId, action: "COMPLETED", bookingId },
    [`outlet:${booking.outletId}:staff`, "admin"]
  );

  return getBookingById({ actor, bookingId });
};

export default {
  bookingScope,
  getOutletAvailability,
  createBooking,
  listBookings,
  getBookingById,
  getBookingLogs,
  getBookingQr,
  cancelBooking,
  checkInBooking,
  assignMechanic,
  startBooking,
  claimNextBooking,
  getStaffQueue,
  getQueuePosition,
  getStaffMeJobs,
  addBookingItem,
  deleteBookingItem,
  decideBookingApprovals,
  uploadBookingPhoto,
  listBookingPhotos,
  deleteBookingPhoto,
  updateInspection,
  markBookingReady,
  completeBooking,
  generateBookingCode,
  generateBookingQrPayload,
  verifyBookingQrPayload,
  formatBookingForActor,
};
