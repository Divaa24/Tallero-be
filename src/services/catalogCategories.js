import prisma, { withDeleted } from "../config/prisma.js";
import RULES from "../config/rules.js";
import { buildPaginationMeta, parsePagination, parseSort } from "../utils/pagination.js";
import { ConflictError, NotFoundError } from "../utils/errors.js";
import { recordAuditLog } from "./audit.service.js";

const CATEGORY_SORT_FIELDS = ["id", "name", "createdAt"];

export const categorySelect = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
};

export const adminCategorySelect = {
  ...categorySelect,
  deletedAt: true,
};

export const listCategories = async ({ query, admin = false }) => {
  const { page, limit, skip } = parsePagination(query);
  const orderBy = parseSort(query.sort, CATEGORY_SORT_FIELDS, { name: "asc" });
  const useDeleted = admin && query.includeDeleted;
  const client = useDeleted ? withDeleted : prisma;

  const where = {};
  if (query.search) {
    where.name = { contains: query.search, mode: "insensitive" };
  }

  const select = admin ? adminCategorySelect : categorySelect;
  const [items, total] = await Promise.all([
    client.category.findMany({ where, select, orderBy, skip, take: limit }),
    client.category.count({ where }),
  ]);

  return { items, meta: buildPaginationMeta({ page, limit, total }) };
};

export const createCategory = async ({ actor, data, ip }) => {
  return prisma.$transaction(async (tx) => {
    const created = await tx.category.create({
      data: { name: data.name },
      select: adminCategorySelect,
    });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "CATEGORY_CREATED",
      entity: "Category",
      entityId: created.id,
      after: created,
      ip,
    });

    return created;
  });
};

export const updateCategory = async ({ actor, categoryId, data, ip }) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.category.findUnique({
      where: { id: categoryId },
      select: adminCategorySelect,
    });

    if (!existing) {
      throw new NotFoundError("Kategori tidak ditemukan", "CATEGORY_NOT_FOUND");
    }

    const updated = await tx.category.update({
      where: { id: categoryId },
      data: { name: data.name },
      select: adminCategorySelect,
    });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "CATEGORY_UPDATED",
      entity: "Category",
      entityId: categoryId,
      before: existing,
      after: updated,
      ip,
    });

    return updated;
  });
};

export const softDeleteCategory = async ({ actor, categoryId, ip }) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.category.findUnique({
      where: { id: categoryId },
      select: adminCategorySelect,
    });

    if (!existing) {
      throw new NotFoundError("Kategori tidak ditemukan", "CATEGORY_NOT_FOUND");
    }

    const activeBookingItems = await tx.bookingItem.count({
      where: {
        service: { categoryId },
        booking: { status: { in: RULES.ACTIVE_BOOKING_STATUSES } },
      },
    });

    if (activeBookingItems > 0) {
      throw new ConflictError(
        "Kategori tidak dapat dihapus karena layanannya digunakan pada booking aktif",
        "ACTIVE_BOOKING_EXISTS"
      );
    }

    const activeServiceCount = await tx.service.count({
      where: { categoryId },
    });

    if (activeServiceCount > 0) {
      throw new ConflictError(
        "Kategori masih memiliki layanan aktif. Hapus atau pindahkan layanan terlebih dahulu.",
        "CATEGORY_IN_USE"
      );
    }

    const deleted = await tx.category.delete({
      where: { id: categoryId },
      select: adminCategorySelect,
    });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "CATEGORY_DELETED",
      entity: "Category",
      entityId: categoryId,
      before: existing,
      after: deleted,
      ip,
    });

    return deleted;
  });
};

export const restoreCategory = async ({ actor, categoryId, ip }) => {
  return withDeleted.$transaction(async (tx) => {
    const existing = await tx.category.findUnique({
      where: { id: categoryId },
      select: adminCategorySelect,
    });

    if (!existing) {
      throw new NotFoundError("Kategori tidak ditemukan", "CATEGORY_NOT_FOUND");
    }

    if (existing.deletedAt === null) {
      throw new ConflictError("Kategori tidak dalam status terhapus", "CATEGORY_NOT_DELETED");
    }

    const restored = await tx.category.update({
      where: { id: categoryId },
      data: { deletedAt: null },
      select: adminCategorySelect,
    });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "CATEGORY_RESTORED",
      entity: "Category",
      entityId: categoryId,
      before: existing,
      after: restored,
      ip,
    });

    return restored;
  });
};
