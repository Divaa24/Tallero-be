import prisma, { withDeleted } from "../config/prisma.js";
import RULES from "../config/rules.js";
import { buildPaginationMeta, parsePagination, parseSort } from "../utils/pagination.js";
import { BusinessRuleError, ConflictError, NotFoundError } from "../utils/errors.js";
import { recordAuditLog } from "./audit.service.js";

const SPAREPART_SORT_FIELDS = ["id", "sku", "name", "price", "stock", "createdAt"];

export const sparepartSelect = {
  id: true,
  sku: true,
  name: true,
  price: true,
  stock: true,
  unit: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

export const adminSparepartSelect = {
  ...sparepartSelect,
  deletedAt: true,
};

const formatCustomerSparepartDto = (row) => ({
  id: row.id,
  sku: row.sku,
  name: row.name,
  price: row.price,
  unit: row.unit,
  inStock: row.stock > 0,
});

const formatStaffSparepartDto = (row) => ({
  id: row.id,
  sku: row.sku,
  name: row.name,
  price: row.price,
  stock: row.stock,
  unit: row.unit,
  inStock: row.stock > 0,
  isActive: row.isActive,
  deletedAt: row.deletedAt ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const listSpareparts = async ({ actor, query, adminMode = false }) => {
  const { page, limit, skip } = parsePagination(query);
  const isCustomer = actor.role === "CUSTOMER";

  // Customer tidak boleh melakukan sorting berdasarkan angka stok
  const allowedSort = isCustomer
    ? SPAREPART_SORT_FIELDS.filter((f) => f !== "stock")
    : SPAREPART_SORT_FIELDS;
  const orderBy = parseSort(query.sort, allowedSort, { name: "asc" });

  const useDeleted = adminMode && actor.role === "ADMIN" && query.includeDeleted;
  const client = useDeleted ? withDeleted : prisma;

  const where = {};
  if (isCustomer) {
    where.isActive = true;
  } else if (query.isActive !== undefined) {
    where.isActive = query.isActive;
  }

  if (query.inStock !== undefined) {
    where.stock = query.inStock ? { gt: 0 } : { lte: 0 };
  }

  if (query.search) {
    where.OR = [
      { sku: { contains: query.search, mode: "insensitive" } },
      { name: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const select = useDeleted ? adminSparepartSelect : sparepartSelect;
  const [rows, total] = await Promise.all([
    client.sparepart.findMany({ where, select, orderBy, skip, take: limit }),
    client.sparepart.count({ where }),
  ]);

  const items = rows.map(isCustomer ? formatCustomerSparepartDto : formatStaffSparepartDto);
  return { items, meta: buildPaginationMeta({ page, limit, total }) };
};

export const createSparepart = async ({ actor, data, ip }) => {
  const existingSku = await withDeleted.sparepart.findUnique({
    where: { sku: data.sku },
    select: { id: true },
  });

  if (existingSku) {
    throw new ConflictError("SKU sparepart sudah terdaftar", "SKU_ALREADY_EXISTS");
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.sparepart.create({
      data: {
        sku: data.sku,
        name: data.name,
        price: data.price,
        stock: data.stock,
        unit: data.unit,
        isActive: data.isActive ?? true,
      },
      select: adminSparepartSelect,
    });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "SPAREPART_CREATED",
      entity: "Sparepart",
      entityId: created.id,
      after: created,
      ip,
    });

    return formatStaffSparepartDto(created);
  });
};

export const updateSparepart = async ({ actor, sparepartId, data, ip }) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.sparepart.findUnique({
      where: { id: sparepartId },
      select: adminSparepartSelect,
    });

    if (!existing) {
      throw new NotFoundError("Sparepart tidak ditemukan", "SPAREPART_NOT_FOUND");
    }

    if (data.sku && data.sku !== existing.sku) {
      const duplicate = await withDeleted.sparepart.findUnique({
        where: { sku: data.sku },
        select: { id: true },
      });
      if (duplicate && duplicate.id !== sparepartId) {
        throw new ConflictError("SKU sparepart sudah terdaftar", "SKU_ALREADY_EXISTS");
      }
    }

    const updated = await tx.sparepart.update({
      where: { id: sparepartId },
      data,
      select: adminSparepartSelect,
    });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "SPAREPART_UPDATED",
      entity: "Sparepart",
      entityId: sparepartId,
      before: existing,
      after: updated,
      ip,
    });

    return formatStaffSparepartDto(updated);
  });
};

export const adjustSparepartStock = async ({ actor, sparepartId, delta, reason, ip }) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.sparepart.findUnique({
      where: { id: sparepartId },
      select: adminSparepartSelect,
    });

    if (!existing) {
      throw new NotFoundError("Sparepart tidak ditemukan", "SPAREPART_NOT_FOUND");
    }

    const updateWhere = {
      id: sparepartId,
      ...(delta < 0 ? { stock: { gte: Math.abs(delta) } } : {}),
    };

    const claimed = await tx.sparepart.updateMany({
      where: updateWhere,
      data: { stock: { increment: delta } },
    });

    if (claimed.count !== 1) {
      throw new BusinessRuleError(
        "Penyesuaian ditolak karena stok tidak boleh menjadi negatif",
        "INSUFFICIENT_STOCK"
      );
    }

    const updated = await tx.sparepart.findUnique({
      where: { id: sparepartId },
      select: adminSparepartSelect,
    });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "SPAREPART_STOCK_ADJUSTED",
      entity: "Sparepart",
      entityId: sparepartId,
      before: { stock: existing.stock },
      after: { stock: updated.stock, delta, reason },
      ip,
    });

    return formatStaffSparepartDto(updated);
  });
};

export const softDeleteSparepart = async ({ actor, sparepartId, ip }) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.sparepart.findUnique({
      where: { id: sparepartId },
      select: adminSparepartSelect,
    });

    if (!existing) {
      throw new NotFoundError("Sparepart tidak ditemukan", "SPAREPART_NOT_FOUND");
    }

    const activeBookingItems = await tx.bookingItem.count({
      where: {
        sparepartId,
        booking: { status: { in: RULES.ACTIVE_BOOKING_STATUSES } },
      },
    });

    if (activeBookingItems > 0) {
      throw new ConflictError(
        "Sparepart tidak dapat dihapus karena masih digunakan pada booking aktif",
        "ACTIVE_BOOKING_EXISTS"
      );
    }

    await tx.sparepart.update({ where: { id: sparepartId }, data: { isActive: false } });
    const deleted = await tx.sparepart.delete({
      where: { id: sparepartId },
      select: adminSparepartSelect,
    });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "SPAREPART_DELETED",
      entity: "Sparepart",
      entityId: sparepartId,
      before: existing,
      after: deleted,
      ip,
    });

    return formatStaffSparepartDto(deleted);
  });
};

export const restoreSparepart = async ({ actor, sparepartId, ip }) => {
  return withDeleted.$transaction(async (tx) => {
    const existing = await tx.sparepart.findUnique({
      where: { id: sparepartId },
      select: adminSparepartSelect,
    });

    if (!existing) {
      throw new NotFoundError("Sparepart tidak ditemukan", "SPAREPART_NOT_FOUND");
    }

    if (existing.deletedAt === null) {
      throw new ConflictError("Sparepart tidak dalam status terhapus", "SPAREPART_NOT_DELETED");
    }

    const restored = await tx.sparepart.update({
      where: { id: sparepartId },
      data: { deletedAt: null, isActive: true },
      select: adminSparepartSelect,
    });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "SPAREPART_RESTORED",
      entity: "Sparepart",
      entityId: sparepartId,
      before: existing,
      after: restored,
      ip,
    });

    return formatStaffSparepartDto(restored);
  });
};
