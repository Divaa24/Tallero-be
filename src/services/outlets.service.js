import prisma, { withDeleted } from "../config/prisma.js";
import RULES from "../config/rules.js";
import { buildPaginationMeta, parsePagination, parseSort } from "../utils/pagination.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { assertValidOutletSchedule } from "../validations/outlets.validation.js";
import { recordAuditLog } from "./audit.service.js";

const OUTLET_SORT_FIELDS = ["id", "name", "createdAt"];

export const publicOutletSelect = {
  id: true,
  name: true,
  address: true,
  phone: true,
  latitude: true,
  longitude: true,
  openDays: true,
  openTime: true,
  closeTime: true,
  slotMinutes: true,
  slotCapacity: true,
  timezone: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

export const adminOutletSelect = {
  ...publicOutletSelect,
  deletedAt: true,
};

const closureSelect = {
  id: true,
  outletId: true,
  date: true,
  reason: true,
  createdAt: true,
};

export const listPublicOutlets = async ({ query }) => {
  const { page, limit, skip } = parsePagination(query);
  const orderBy = parseSort(query.sort, OUTLET_SORT_FIELDS, { name: "asc" });

  const where = { isActive: true };
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { address: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.outlet.findMany({ where, select: publicOutletSelect, orderBy, skip, take: limit }),
    prisma.outlet.count({ where }),
  ]);

  return { items, meta: buildPaginationMeta({ page, limit, total }) };
};

export const getPublicOutletById = async ({ outletId }) => {
  const outlet = await prisma.outlet.findFirst({
    where: { id: outletId, isActive: true },
    select: {
      ...publicOutletSelect,
      closures: {
        where: { date: { gte: new Date(new Date().toISOString().slice(0, 10)) } },
        select: closureSelect,
        orderBy: { date: "asc" },
      },
    },
  });

  if (!outlet) {
    throw new NotFoundError("Outlet tidak ditemukan", "OUTLET_NOT_FOUND");
  }

  return outlet;
};

export const listAdminOutlets = async ({ query }) => {
  const { page, limit, skip } = parsePagination(query);
  const orderBy = parseSort(query.sort, OUTLET_SORT_FIELDS, { createdAt: "desc" });
  const client = query.includeDeleted ? withDeleted : prisma;

  const where = {};
  if (query.isActive !== undefined) where.isActive = query.isActive;
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { address: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    client.outlet.findMany({ where, select: adminOutletSelect, orderBy, skip, take: limit }),
    client.outlet.count({ where }),
  ]);

  return { items, meta: buildPaginationMeta({ page, limit, total }) };
};

export const createOutlet = async ({ actor, data, ip }) => {
  assertValidOutletSchedule({
    openTime: data.openTime,
    closeTime: data.closeTime,
    slotMinutes: data.slotMinutes,
  });

  return prisma.$transaction(async (tx) => {
    const created = await tx.outlet.create({
      data: {
        name: data.name,
        address: data.address,
        phone: data.phone ?? null,
        latitude: data.latitude,
        longitude: data.longitude,
        openDays: data.openDays,
        openTime: data.openTime,
        closeTime: data.closeTime,
        slotMinutes: data.slotMinutes,
        slotCapacity: data.slotCapacity,
        timezone: data.timezone || RULES.TIMEZONE,
        isActive: data.isActive ?? true,
      },
      select: adminOutletSelect,
    });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "OUTLET_CREATED",
      entity: "Outlet",
      entityId: created.id,
      after: created,
      ip,
    });

    return created;
  });
};

export const updateOutlet = async ({ actor, outletId, data, ip }) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.outlet.findUnique({
      where: { id: outletId },
      select: adminOutletSelect,
    });

    if (!existing) {
      throw new NotFoundError("Outlet tidak ditemukan", "OUTLET_NOT_FOUND");
    }

    assertValidOutletSchedule({
      openTime: data.openTime ?? existing.openTime,
      closeTime: data.closeTime ?? existing.closeTime,
      slotMinutes: data.slotMinutes ?? existing.slotMinutes,
    });

    const updated = await tx.outlet.update({
      where: { id: outletId },
      data,
      select: adminOutletSelect,
    });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "OUTLET_UPDATED",
      entity: "Outlet",
      entityId: outletId,
      before: existing,
      after: updated,
      ip,
    });

    return updated;
  });
};

export const softDeleteOutlet = async ({ actor, outletId, ip }) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.outlet.findUnique({
      where: { id: outletId },
      select: adminOutletSelect,
    });

    if (!existing) {
      throw new NotFoundError("Outlet tidak ditemukan", "OUTLET_NOT_FOUND");
    }

    const [activeBookingCount, activeMechanicCount] = await Promise.all([
      tx.booking.count({
        where: { outletId, status: { in: RULES.ACTIVE_BOOKING_STATUSES } },
      }),
      tx.user.count({
        where: { outletId, role: "MECHANIC", isActive: true },
      }),
    ]);

    if (activeBookingCount > 0) {
      throw new ConflictError(
        "Outlet tidak dapat dihapus karena masih memiliki booking aktif",
        "ACTIVE_BOOKING_EXISTS"
      );
    }

    if (activeMechanicCount > 0) {
      throw new ConflictError(
        "Outlet tidak dapat dihapus karena masih memiliki mekanik aktif",
        "ACTIVE_MECHANIC_EXISTS"
      );
    }

    await tx.outlet.update({ where: { id: outletId }, data: { isActive: false } });
    const deleted = await tx.outlet.delete({ where: { id: outletId }, select: adminOutletSelect });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "OUTLET_DELETED",
      entity: "Outlet",
      entityId: outletId,
      before: existing,
      after: deleted,
      ip,
    });

    return deleted;
  });
};

export const restoreOutlet = async ({ actor, outletId, ip }) => {
  return withDeleted.$transaction(async (tx) => {
    const existing = await tx.outlet.findUnique({
      where: { id: outletId },
      select: adminOutletSelect,
    });

    if (!existing) {
      throw new NotFoundError("Outlet tidak ditemukan", "OUTLET_NOT_FOUND");
    }

    if (existing.deletedAt === null) {
      throw new ConflictError("Outlet tidak dalam status terhapus", "OUTLET_NOT_DELETED");
    }

    const restored = await tx.outlet.update({
      where: { id: outletId },
      data: { deletedAt: null, isActive: true },
      select: adminOutletSelect,
    });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "OUTLET_RESTORED",
      entity: "Outlet",
      entityId: outletId,
      before: existing,
      after: restored,
      ip,
    });

    return restored;
  });
};

export const addOutletClosure = async ({ actor, outletId, date, reason, ip }) => {
  const outlet = await prisma.outlet.findUnique({
    where: { id: outletId },
    select: { id: true },
  });

  if (!outlet) {
    throw new NotFoundError("Outlet tidak ditemukan", "OUTLET_NOT_FOUND");
  }

  const closureDate = new Date(`${date}T00:00:00.000Z`);

  return prisma.$transaction(async (tx) => {
    const created = await tx.outletClosure.create({
      data: { outletId, date: closureDate, reason },
      select: closureSelect,
    });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "OUTLET_CLOSURE_ADDED",
      entity: "OutletClosure",
      entityId: created.id,
      after: { outletId, date, reason },
      ip,
    });

    return created;
  });
};

export const removeOutletClosure = async ({ actor, outletId, closureId, ip }) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.outletClosure.findFirst({
      where: { id: closureId, outletId },
      select: closureSelect,
    });

    if (!existing) {
      throw new NotFoundError("Jadwal libur outlet tidak ditemukan", "CLOSURE_NOT_FOUND");
    }

    await tx.outletClosure.delete({ where: { id: closureId } });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "OUTLET_CLOSURE_REMOVED",
      entity: "OutletClosure",
      entityId: closureId,
      before: existing,
      ip,
    });

    return { deleted: true, id: closureId };
  });
};
