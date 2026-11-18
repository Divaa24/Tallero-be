import { DateTime } from "luxon";
import prisma from "../config/prisma.js";
import RULES from "../config/rules.js";
import { BadRequestError, BusinessRuleError, NotFoundError } from "../utils/errors.js";

const parseTimeToMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Menghasilkan daftar slot waktu untuk satu tanggal di outlet tertentu sesuai aturan §8.
 * Status slot: AVAILABLE, LIMITED (sisa 1), FULL, CLOSED, PAST.
 */
export const generateOutletSlots = ({
  outlet,
  dateStr,
  date,
  now = DateTime.now().setZone(outlet.timezone || RULES.TIMEZONE),
  existingBookings = [],
  closures = [],
}) => {
  const targetDateStr = dateStr || date;
  const tz = outlet.timezone || RULES.TIMEZONE;
  const nowDt = (now instanceof DateTime ? now : DateTime.fromJSDate(now)).setZone(tz);
  const dateDt = DateTime.fromISO(targetDateStr, { zone: tz }).startOf("day");

  if (!dateDt.isValid) {
    throw new BadRequestError("Format tanggal tidak valid (gunakan YYYY-MM-DD)", "INVALID_DATE");
  }

  const minLeadDt = nowDt.plus({ minutes: RULES.MIN_LEAD_MINUTES });
  const maxAdvanceDt = nowDt.plus({ days: RULES.MAX_ADVANCE_DAYS }).endOf("day");

  const openMin = parseTimeToMinutes(outlet.openTime);
  const closeMin = parseTimeToMinutes(outlet.closeTime);
  const slotMinutes = outlet.slotMinutes;
  const capacity = outlet.slotCapacity;

  // Cek apakah hari ini merupakan hari buka outlet (openDays ISO 1-7)
  const isDayOpen = Array.isArray(outlet.openDays) && outlet.openDays.includes(dateDt.weekday);

  // Cek apakah tanggal ini terdaftar dalam hari libur operasional (closure)
  const closureRecord = closures.find((c) => {
    const cDate =
      c.date instanceof Date ? c.date.toISOString().slice(0, 10) : String(c.date).slice(0, 10);
    return cDate === dateStr;
  });
  const isClosure = Boolean(closureRecord);

  const slots = [];
  let currentMin = openMin;

  while (currentMin + slotMinutes <= closeMin) {
    const startHour = Math.floor(currentMin / 60);
    const startMinute = currentMin % 60;
    const endHour = Math.floor((currentMin + slotMinutes) / 60);
    const endMinute = (currentMin + slotMinutes) % 60;

    const slotStartDt = dateDt.set({ hour: startHour, minute: startMinute, second: 0 });
    const slotEndDt = dateDt.set({ hour: endHour, minute: endMinute, second: 0 });

    const slotStartIso = slotStartDt.toISO();
    const slotEndIso = slotEndDt.toISO();
    const slotTimeStr = slotStartDt.toFormat("HH:mm");

    if (!isDayOpen || isClosure) {
      slots.push({
        start: slotStartIso,
        end: slotEndIso,
        time: slotTimeStr,
        status: "CLOSED",
        capacity,
        booked: 0,
        remaining: 0,
        closureReason: closureRecord ? closureRecord.reason : "Outlet tutup pada hari ini",
      });
      currentMin += slotMinutes;
      continue;
    }

    if (slotStartDt < minLeadDt) {
      slots.push({
        start: slotStartIso,
        end: slotEndIso,
        time: slotTimeStr,
        status: "PAST",
        capacity,
        booked: 0,
        remaining: 0,
      });
      currentMin += slotMinutes;
      continue;
    }

    if (slotStartDt > maxAdvanceDt) {
      slots.push({
        start: slotStartIso,
        end: slotEndIso,
        time: slotTimeStr,
        status: "CLOSED",
        capacity,
        booked: 0,
        remaining: 0,
        closureReason: "Melebihi batas maksimal reservasi di muka (30 hari)",
      });
      currentMin += slotMinutes;
      continue;
    }

    // Hitung booking aktif yang menempati slot ini (bukan CANCELLED / NO_SHOW)
    const slotStartMs = slotStartDt.toMillis();
    const bookedCount = existingBookings.filter((b) => {
      const bTime =
        b.scheduledAt instanceof Date ? b.scheduledAt.getTime() : new Date(b.scheduledAt).getTime();
      return bTime === slotStartMs;
    }).length;

    const remaining = Math.max(0, capacity - bookedCount);
    let status = "AVAILABLE";
    if (remaining === 0) {
      status = "FULL";
    } else if (remaining === 1) {
      status = "LIMITED";
    }

    slots.push({
      start: slotStartIso,
      end: slotEndIso,
      time: slotTimeStr,
      status,
      capacity,
      booked: bookedCount,
      remaining,
    });

    currentMin += slotMinutes;
  }

  return {
    date: dateStr,
    timezone: tz,
    isDayOpen,
    isClosure,
    closureReason: closureRecord ? closureRecord.reason : null,
    slots,
  };
};

/**
 * Memvalidasi apakah waktu booking yang diminta (scheduledAt) legal terhadap grid slot outlet,
 * lead time, jendela reservasi 30 hari, hari buka, dan closure.
 * Mengembalikan objek DateTime dan slotEndAt UTC Date.
 */
export const validateAndComputeBookingSlot = ({
  outlet,
  scheduledAt,
  now = new Date(),
  closures = [],
}) => {
  const tz = outlet.timezone || RULES.TIMEZONE;
  const nowDt = (now instanceof DateTime ? now : DateTime.fromJSDate(now)).setZone(tz);
  const startDt = (
    scheduledAt instanceof DateTime
      ? scheduledAt
      : DateTime.fromISO(String(scheduledAt), { zone: tz })
  ).setZone(tz);

  if (!startDt.isValid) {
    throw new BadRequestError("Format scheduledAt tidak valid", "INVALID_SCHEDULED_AT");
  }

  const dateStr = startDt.toISODate();
  const minLeadDt = nowDt.plus({ minutes: RULES.MIN_LEAD_MINUTES });
  const maxAdvanceDt = nowDt.plus({ days: RULES.MAX_ADVANCE_DAYS }).endOf("day");

  if (startDt < minLeadDt) {
    throw new BusinessRuleError(
      `Waktu booking minimal ${RULES.MIN_LEAD_MINUTES} menit dari waktu sekarang`,
      "SLOT_PAST_LEAD_TIME"
    );
  }

  if (startDt > maxAdvanceDt) {
    throw new BusinessRuleError(
      `Waktu booking maksimal ${RULES.MAX_ADVANCE_DAYS} hari ke depan`,
      "SLOT_EXCEEDS_MAX_ADVANCE"
    );
  }

  const isDayOpen = Array.isArray(outlet.openDays) && outlet.openDays.includes(startDt.weekday);
  if (!isDayOpen) {
    throw new BusinessRuleError("Outlet tutup pada hari tersebut", "OUTLET_CLOSED_ON_DAY");
  }

  const closure = closures.find((c) => {
    const cDate =
      c.date instanceof Date ? c.date.toISOString().slice(0, 10) : String(c.date).slice(0, 10);
    return cDate === dateStr;
  });

  if (closure) {
    throw new BusinessRuleError(
      `Outlet libur pada tanggal tersebut: ${closure.reason}`,
      "OUTLET_CLOSED_ON_DATE"
    );
  }

  const openMin = parseTimeToMinutes(outlet.openTime);
  const closeMin = parseTimeToMinutes(outlet.closeTime);
  const slotMinutes = outlet.slotMinutes;
  const targetMin = startDt.hour * 60 + startDt.minute;
  const cleanStartDt = startDt.set({ millisecond: 0 });

  if (
    targetMin < openMin ||
    targetMin + slotMinutes > closeMin ||
    (targetMin - openMin) % slotMinutes !== 0 ||
    cleanStartDt.second !== 0
  ) {
    throw new BadRequestError(
      "Waktu booking tidak sesuai dengan batas dan grid slot operasional outlet",
      "INVALID_SLOT_TIME"
    );
  }

  const slotEndDt = cleanStartDt.plus({ minutes: slotMinutes });

  return {
    scheduledAt: cleanStartDt.toJSDate(),
    slotEndAt: slotEndDt.toJSDate(),
    startDt: cleanStartDt,
    slotEndDt,
  };
};

/**
 * GET /outlets/:id/availability?date&serviceIds
 * Menghitung ketersediaan slot bengkel secara komprehensif untuk satu hari
 */
export const getOutletAvailability = async ({ outletId, date, dateStr, serviceIds = [] }) => {
  const targetDate = date || dateStr;
  const outlet = await prisma.outlet.findFirst({
    where: { id: outletId, isActive: true, deletedAt: null },
  });

  if (!outlet) {
    throw new NotFoundError("Outlet tidak ditemukan atau tidak aktif", "OUTLET_NOT_FOUND");
  }

  const serviceIdList = Array.isArray(serviceIds)
    ? serviceIds
    : typeof serviceIds === "string"
      ? serviceIds
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : typeof serviceIds === "number"
        ? [serviceIds]
        : [];

  const [closures, existingBookings, selectedServices] = await Promise.all([
    prisma.outletClosure.findMany({
      where: { outletId, date: new Date(`${targetDate}T00:00:00.000Z`) },
    }),
    prisma.booking.findMany({
      where: {
        outletId,
        scheduledAt: {
          gte: DateTime.fromISO(targetDate, { zone: outlet.timezone })
            .startOf("day")
            .toUTC()
            .toJSDate(),
          lte: DateTime.fromISO(targetDate, { zone: outlet.timezone })
            .endOf("day")
            .toUTC()
            .toJSDate(),
        },
        status: { notIn: ["CANCELLED", "NO_SHOW"] },
      },
      select: { scheduledAt: true },
    }),
    serviceIdList.length > 0
      ? prisma.service.findMany({
          where: { id: { in: serviceIdList.map(Number) }, isActive: true },
          select: { estimatedMinutes: true },
        })
      : [],
  ]);

  const totalEstimatedMinutes = selectedServices.reduce(
    (acc, s) => acc + (s.estimatedMinutes || 0),
    0
  );

  const slotResult = generateOutletSlots({
    outlet,
    dateStr: targetDate,
    closures,
    existingBookings,
    serviceIds: serviceIdList,
    now: new Date(),
  });

  return {
    ...slotResult,
    totalEstimatedMinutes,
  };
};

export default {
  generateOutletSlots,
  validateAndComputeBookingSlot,
  getOutletAvailability,
};
