import prisma from "../config/prisma.js";
import RULES from "../config/rules.js";
import { buildPaginationMeta, parsePagination, parseSort } from "../utils/pagination.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";

const VEHICLE_SORT_FIELDS = ["id", "plateNumber", "brand", "year", "createdAt"];

export const vehicleSelect = {
  id: true,
  userId: true,
  plateNumber: true,
  brand: true,
  model: true,
  type: true,
  year: true,
  color: true,
  lastOdometerKm: true,
  createdAt: true,
  updatedAt: true,
};

const findOwnedVehicleOrThrow = async (db, vehicleId, actorId) => {
  // Kepemilikan di-scope langsung di query untuk mencegah IDOR; milik orang lain -> 404
  const vehicle = await db.vehicle.findFirst({
    where: { id: vehicleId, userId: actorId },
    select: vehicleSelect,
  });

  if (!vehicle) {
    throw new NotFoundError("Kendaraan tidak ditemukan", "VEHICLE_NOT_FOUND");
  }

  return vehicle;
};

export const listMyVehicles = async ({ actor, query }) => {
  const { page, limit, skip } = parsePagination(query);
  const orderBy = parseSort(query.sort, VEHICLE_SORT_FIELDS, { createdAt: "desc" });

  const where = { userId: actor.id };
  if (query.type) where.type = query.type;
  if (query.search) {
    where.OR = [
      { plateNumber: { contains: query.search, mode: "insensitive" } },
      { brand: { contains: query.search, mode: "insensitive" } },
      { model: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.vehicle.findMany({ where, select: vehicleSelect, orderBy, skip, take: limit }),
    prisma.vehicle.count({ where }),
  ]);

  return { items, meta: buildPaginationMeta({ page, limit, total }) };
};

export const getMyVehicleById = async ({ actor, vehicleId }) => {
  return findOwnedVehicleOrThrow(prisma, vehicleId, actor.id);
};

export const createVehicle = async ({ actor, data }) => {
  const duplicate = await prisma.vehicle.findUnique({
    where: { activePlate: data.plateNumber },
    select: { id: true },
  });

  if (duplicate) {
    throw new ConflictError(
      "Nomor polisi kendaraan sudah terdaftar dan aktif",
      "PLATE_ALREADY_EXISTS"
    );
  }

  return prisma.vehicle.create({
    data: {
      userId: actor.id,
      plateNumber: data.plateNumber,
      activePlate: data.plateNumber,
      brand: data.brand,
      model: data.model,
      type: data.type,
      year: data.year,
      color: data.color ?? null,
      lastOdometerKm: data.lastOdometerKm ?? null,
    },
    select: vehicleSelect,
  });
};

export const updateVehicle = async ({ actor, vehicleId, data }) => {
  const existing = await findOwnedVehicleOrThrow(prisma, vehicleId, actor.id);

  if (data.plateNumber && data.plateNumber !== existing.plateNumber) {
    const duplicate = await prisma.vehicle.findUnique({
      where: { activePlate: data.plateNumber },
      select: { id: true },
    });
    if (duplicate && duplicate.id !== vehicleId) {
      throw new ConflictError(
        "Nomor polisi kendaraan sudah terdaftar dan aktif",
        "PLATE_ALREADY_EXISTS"
      );
    }
  }

  return prisma.vehicle.update({
    where: { id: vehicleId },
    data: {
      ...data,
      ...(data.plateNumber !== undefined ? { activePlate: data.plateNumber } : {}),
    },
    select: vehicleSelect,
  });
};

export const deleteVehicle = async ({ actor, vehicleId }) => {
  return prisma.$transaction(async (tx) => {
    await findOwnedVehicleOrThrow(tx, vehicleId, actor.id);

    const activeBookingCount = await tx.booking.count({
      where: {
        vehicleId,
        status: { in: RULES.ACTIVE_BOOKING_STATUSES },
      },
    });

    if (activeBookingCount > 0) {
      throw new ConflictError(
        "Kendaraan tidak dapat dihapus karena masih memiliki booking aktif",
        "ACTIVE_BOOKING_EXISTS"
      );
    }

    // Soft-delete extension mengubah delete() -> deletedAt = now() & activePlate = null
    return tx.vehicle.delete({
      where: { id: vehicleId },
      select: vehicleSelect,
    });
  });
};

export const getVehicleHistory = async ({ actor, vehicleId, query }) => {
  const { page, limit, skip } = parsePagination(query);

  const vehicleWhere =
    actor.role === "CUSTOMER" ? { id: vehicleId, userId: actor.id } : { id: vehicleId };

  const vehicle = await prisma.vehicle.findFirst({
    where: vehicleWhere,
    select: vehicleSelect,
  });

  if (!vehicle) {
    throw new NotFoundError("Kendaraan tidak ditemukan", "VEHICLE_NOT_FOUND");
  }

  const bookingWhere = { vehicleId: vehicle.id, status: "COMPLETED" };
  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where: bookingWhere,
      select: {
        id: true,
        code: true,
        outletId: true,
        outlet: { select: { id: true, name: true, address: true } },
        scheduledAt: true,
        completedAt: true,
        odometerKm: true,
        total: true,
        mechanic: { select: { id: true, name: true } },
        items: {
          select: {
            id: true,
            type: true,
            nameSnapshot: true,
            unitPrice: true,
            quantity: true,
            subtotal: true,
          },
        },
      },
      orderBy: { completedAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.booking.count({ where: bookingWhere }),
  ]);

  return {
    data: { vehicle, items: bookings },
    meta: buildPaginationMeta({ page, limit, total }),
  };
};

export const getVehicleReminders = async ({ actor, vehicleId, query }) => {
  const { page, limit, skip } = parsePagination(query);
  const vehicle = await findOwnedVehicleOrThrow(prisma, vehicleId, actor.id);

  const reminderWhere = { vehicleId: vehicle.id, userId: actor.id };
  const [reminders, total] = await Promise.all([
    prisma.serviceReminder.findMany({
      where: reminderWhere,
      select: {
        id: true,
        serviceId: true,
        service: { select: { id: true, name: true } },
        dueDate: true,
        dueOdometerKm: true,
        status: true,
        remindedAt: true,
        dueNotifiedAt: true,
      },
      orderBy: { dueDate: "asc" },
      skip,
      take: limit,
    }),
    prisma.serviceReminder.count({ where: reminderWhere }),
  ]);

  return {
    data: { vehicle, items: reminders },
    meta: buildPaginationMeta({ page, limit, total }),
  };
};
