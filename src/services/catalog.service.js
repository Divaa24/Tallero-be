import prisma, { withDeleted } from "../config/prisma.js";
import RULES from "../config/rules.js";
import { buildPaginationMeta, parsePagination, parseSort } from "../utils/pagination.js";
import { BadRequestError, ConflictError, NotFoundError } from "../utils/errors.js";
import { recordAuditLog } from "./audit.service.js";

const SERVICE_SORT_FIELDS = ["id", "name", "price", "estimatedMinutes", "createdAt"];

export const publicServiceSelect = {
  id: true,
  categoryId: true,
  category: { select: { id: true, name: true } },
  name: true,
  description: true,
  price: true,
  estimatedMinutes: true,
  vehicleType: true,
  reminderIntervalDays: true,
  reminderIntervalKm: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

export const adminServiceSelect = {
  ...publicServiceSelect,
  deletedAt: true,
};

const assertActiveCategory = async (db, categoryId) => {
  const category = await db.category.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });

  if (!category) {
    throw new BadRequestError(
      "Kategori layanan tidak ditemukan atau sudah dihapus",
      "INVALID_CATEGORY"
    );
  }
};

export const listPublicServices = async ({ query }) => {
  const { page, limit, skip } = parsePagination(query);
  const orderBy = parseSort(query.sort, SERVICE_SORT_FIELDS, { name: "asc" });

  const where = {
    isActive: true,
    category: { deletedAt: null },
  };

  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.vehicleType) {
    where.OR = [{ vehicleType: query.vehicleType }, { vehicleType: null }];
  }
  if (query.search) {
    const searchCond = [
      { name: { contains: query.search, mode: "insensitive" } },
      { description: { contains: query.search, mode: "insensitive" } },
    ];
    where.AND = where.OR ? [{ OR: where.OR }, { OR: searchCond }] : [{ OR: searchCond }];
    delete where.OR;
  }

  const [items, total] = await Promise.all([
    prisma.service.findMany({ where, select: publicServiceSelect, orderBy, skip, take: limit }),
    prisma.service.count({ where }),
  ]);

  return { items, meta: buildPaginationMeta({ page, limit, total }) };
};

export const getPublicServiceById = async ({ serviceId }) => {
  const service = await prisma.service.findFirst({
    where: {
      id: serviceId,
      isActive: true,
      category: { deletedAt: null },
    },
    select: publicServiceSelect,
  });

  if (!service) {
    throw new NotFoundError("Layanan tidak ditemukan", "SERVICE_NOT_FOUND");
  }

  return service;
};

export const listAdminServices = async ({ query }) => {
  const { page, limit, skip } = parsePagination(query);
  const orderBy = parseSort(query.sort, SERVICE_SORT_FIELDS, { createdAt: "desc" });
  const client = query.includeDeleted ? withDeleted : prisma;

  const where = {};
  if (query.categoryId) where.categoryId = query.categoryId;
  if (query.vehicleType) where.vehicleType = query.vehicleType;
  if (query.isActive !== undefined) where.isActive = query.isActive;
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { description: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const [items, total] = await Promise.all([
    client.service.findMany({ where, select: adminServiceSelect, orderBy, skip, take: limit }),
    client.service.count({ where }),
  ]);

  return { items, meta: buildPaginationMeta({ page, limit, total }) };
};

export const createService = async ({ actor, data, ip }) => {
  await assertActiveCategory(prisma, data.categoryId);

  return prisma.$transaction(async (tx) => {
    const created = await tx.service.create({
      data: {
        categoryId: data.categoryId,
        name: data.name,
        description: data.description ?? null,
        price: data.price,
        estimatedMinutes: data.estimatedMinutes,
        vehicleType: data.vehicleType ?? null,
        reminderIntervalDays: data.reminderIntervalDays ?? null,
        reminderIntervalKm: data.reminderIntervalKm ?? null,
        isActive: data.isActive ?? true,
      },
      select: adminServiceSelect,
    });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "SERVICE_CREATED",
      entity: "Service",
      entityId: created.id,
      after: created,
      ip,
    });

    return created;
  });
};

export const updateService = async ({ actor, serviceId, data, ip }) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.service.findUnique({
      where: { id: serviceId },
      select: adminServiceSelect,
    });

    if (!existing) {
      throw new NotFoundError("Layanan tidak ditemukan", "SERVICE_NOT_FOUND");
    }

    if (data.categoryId !== undefined) {
      await assertActiveCategory(tx, data.categoryId);
    }

    // Perubahan harga hanya berlaku ke booking baru; BookingItem lama memakai snapshot unitPrice/subtotal
    const updated = await tx.service.update({
      where: { id: serviceId },
      data,
      select: adminServiceSelect,
    });

    const action =
      data.price !== undefined && data.price !== existing.price
        ? "SERVICE_PRICE_UPDATED"
        : "SERVICE_UPDATED";

    await recordAuditLog(tx, {
      actorId: actor.id,
      action,
      entity: "Service",
      entityId: serviceId,
      before: existing,
      after: updated,
      ip,
    });

    return updated;
  });
};

export const softDeleteService = async ({ actor, serviceId, ip }) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.service.findUnique({
      where: { id: serviceId },
      select: adminServiceSelect,
    });

    if (!existing) {
      throw new NotFoundError("Layanan tidak ditemukan", "SERVICE_NOT_FOUND");
    }

    const activeBookingItems = await tx.bookingItem.count({
      where: {
        serviceId,
        booking: { status: { in: RULES.ACTIVE_BOOKING_STATUSES } },
      },
    });

    if (activeBookingItems > 0) {
      throw new ConflictError(
        "Layanan tidak dapat dihapus karena masih digunakan pada booking aktif",
        "ACTIVE_BOOKING_EXISTS"
      );
    }

    await tx.service.update({ where: { id: serviceId }, data: { isActive: false } });
    const deleted = await tx.service.delete({
      where: { id: serviceId },
      select: adminServiceSelect,
    });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "SERVICE_DELETED",
      entity: "Service",
      entityId: serviceId,
      before: existing,
      after: deleted,
      ip,
    });

    return deleted;
  });
};

export const restoreService = async ({ actor, serviceId, ip }) => {
  return withDeleted.$transaction(async (tx) => {
    const existing = await tx.service.findUnique({
      where: { id: serviceId },
      select: adminServiceSelect,
    });

    if (!existing) {
      throw new NotFoundError("Layanan tidak ditemukan", "SERVICE_NOT_FOUND");
    }

    if (existing.deletedAt === null) {
      throw new ConflictError("Layanan tidak dalam status terhapus", "SERVICE_NOT_DELETED");
    }

    const parentCategory = await tx.category.findUnique({
      where: { id: existing.categoryId },
      select: { id: true, deletedAt: true },
    });

    if (!parentCategory || parentCategory.deletedAt !== null) {
      throw new ConflictError(
        "Pulihkan kategori induk terlebih dahulu sebelum memulihkan layanan ini",
        "CATEGORY_DELETED"
      );
    }

    const restored = await tx.service.update({
      where: { id: serviceId },
      data: { deletedAt: null, isActive: true },
      select: adminServiceSelect,
    });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "SERVICE_RESTORED",
      entity: "Service",
      entityId: serviceId,
      before: existing,
      after: restored,
      ip,
    });

    return restored;
  });
};
