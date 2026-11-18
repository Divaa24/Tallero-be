import crypto from "node:crypto";
import prisma, { withDeleted } from "../config/prisma.js";
import RULES from "../config/rules.js";
import logger from "../config/logger.js";
import { hashPassword } from "../utils/crypto.js";
import { createSignedUrl } from "../utils/signedUrl.js";
import { buildPaginationMeta, parsePagination, parseSort } from "../utils/pagination.js";
import { BadRequestError, ConflictError, NotFoundError } from "../utils/errors.js";
import { recordAuditLog } from "./audit.service.js";
import { buildStaffInviteEmail, sendMail } from "./mail.service.js";
import { revokeAllUserSessions } from "./sessionTokens.service.js";

const USER_SORT_FIELDS = ["id", "name", "email", "role", "createdAt"];

export const adminUserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  address: true,
  avatarKey: true,
  role: true,
  outletId: true,
  outlet: { select: { id: true, name: true } },
  isActive: true,
  isVerified: true,
  mustChangePassword: true,
  lastLoginAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
};

const formatAdminUserDto = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  address: user.address ?? null,
  avatarUrl: user.avatarKey ? createSignedUrl({ kind: "avatar", id: user.avatarKey }).url : null,
  role: user.role,
  outletId: user.outletId ?? null,
  outlet: user.outlet ?? null,
  isActive: user.isActive,
  isVerified: user.isVerified,
  mustChangePassword: user.mustChangePassword,
  lastLoginAt: user.lastLoginAt ?? null,
  deletedAt: user.deletedAt ?? null,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const generateTemporaryPassword = () => {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const all = upper + lower + digits;
  const chars = [
    upper[crypto.randomInt(0, upper.length)],
    lower[crypto.randomInt(0, lower.length)],
    digits[crypto.randomInt(0, digits.length)],
  ];
  for (let i = 0; i < 9; i++) {
    chars.push(all[crypto.randomInt(0, all.length)]);
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
};

const assertValidActiveOutlet = async (db, outletId) => {
  const outlet = await db.outlet.findUnique({
    where: { id: outletId },
    select: { id: true, isActive: true, deletedAt: true },
  });
  if (!outlet || outlet.deletedAt !== null || !outlet.isActive) {
    throw new BadRequestError("Outlet tidak ditemukan atau sedang nonaktif", "INVALID_OUTLET");
  }
};

const assertNotLastActiveAdmin = async (tx, targetUser) => {
  if (targetUser.role !== "ADMIN" || !targetUser.isActive) {
    return;
  }

  const remainingActiveAdmins = await tx.user.count({
    where: {
      role: "ADMIN",
      isActive: true,
      deletedAt: null,
      id: { not: targetUser.id },
    },
  });

  if (remainingActiveAdmins < 1) {
    throw new ConflictError(
      "Tidak dapat menonaktifkan, menurunkan role, atau menghapus admin aktif terakhir",
      "LAST_ADMIN_PROTECTED"
    );
  }
};

export const listUsers = async ({ query }) => {
  const { page, limit, skip } = parsePagination(query);
  const orderBy = parseSort(query.sort, USER_SORT_FIELDS, { createdAt: "desc" });
  const client = query.includeDeleted ? withDeleted : prisma;

  const where = {};
  if (query.role) where.role = query.role;
  if (query.outletId) where.outletId = query.outletId;
  if (query.isActive !== undefined) where.isActive = query.isActive;
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { email: { contains: query.search, mode: "insensitive" } },
      { phone: { contains: query.search, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await Promise.all([
    client.user.findMany({ where, select: adminUserSelect, orderBy, skip, take: limit }),
    client.user.count({ where }),
  ]);

  return {
    items: rows.map(formatAdminUserDto),
    meta: buildPaginationMeta({ page, limit, total }),
  };
};

export const getUserById = async ({ userId }) => {
  const user = await withDeleted.user.findUnique({
    where: { id: userId },
    select: adminUserSelect,
  });

  if (!user) {
    throw new NotFoundError("Pengguna tidak ditemukan", "USER_NOT_FOUND");
  }

  return formatAdminUserDto(user);
};

export const createStaff = async ({ actor, data, ip }) => {
  const existing = await withDeleted.user.findUnique({
    where: { email: data.email },
    select: { id: true },
  });

  if (existing) {
    throw new ConflictError("Email sudah terdaftar di sistem", "EMAIL_ALREADY_EXISTS");
  }

  if (data.role === "MECHANIC") {
    await assertValidActiveOutlet(prisma, data.outletId);
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash,
        phone: data.phone,
        address: data.address ?? null,
        role: data.role,
        outletId: data.role === "MECHANIC" ? data.outletId : null,
        isActive: true,
        isVerified: true,
        mustChangePassword: true,
      },
      select: adminUserSelect,
    });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "USER_CREATED",
      entity: "User",
      entityId: user.id,
      after: { id: user.id, email: user.email, role: user.role, outletId: user.outletId },
      ip,
    });

    return user;
  });

  const emailContent = buildStaffInviteEmail({
    name: created.name,
    email: created.email,
    role: created.role,
    temporaryPassword,
  });

  try {
    await sendMail({ to: created.email, ...emailContent });
  } catch (error) {
    logger.warn({ err: error, userId: created.id }, "Gagal mengirim email undangan staf");
  }

  return {
    user: formatAdminUserDto(created),
    temporaryPassword,
  };
};

export const updateUser = async ({ actor, userId, data, ip }) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: userId },
      select: adminUserSelect,
    });

    if (!existing) {
      throw new NotFoundError("Pengguna tidak ditemukan", "USER_NOT_FOUND");
    }

    if (existing.role === "CUSTOMER" && data.role) {
      throw new ConflictError(
        "Role akun customer tidak dapat diubah ke staf",
        "ROLE_CHANGE_FORBIDDEN"
      );
    }

    if (userId === actor.id && data.role && data.role !== existing.role) {
      throw new ConflictError(
        "Admin tidak dapat mengubah role dirinya sendiri",
        "SELF_ACTION_FORBIDDEN"
      );
    }

    const nextRole = data.role ?? existing.role;
    const isRoleChanged = nextRole !== existing.role;

    if (existing.role === "ADMIN" && nextRole !== "ADMIN") {
      await assertNotLastActiveAdmin(tx, existing);
    }

    let nextOutletId = data.outletId !== undefined ? data.outletId : existing.outletId;
    if (nextRole === "MECHANIC") {
      if (!nextOutletId) {
        throw new BadRequestError("Staf MECHANIC wajib memiliki outletId", "OUTLET_REQUIRED");
      }
      await assertValidActiveOutlet(tx, nextOutletId);
    } else if (nextRole === "ADMIN") {
      nextOutletId = null;
    }

    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.address !== undefined ? { address: data.address } : {}),
        ...(data.role !== undefined ? { role: data.role } : {}),
        outletId: nextOutletId,
      },
      select: adminUserSelect,
    });

    if (isRoleChanged) {
      await revokeAllUserSessions({ db: tx, userId, incrementTokenVersion: true });
    }

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "USER_UPDATED",
      entity: "User",
      entityId: userId,
      before: {
        name: existing.name,
        phone: existing.phone,
        role: existing.role,
        outletId: existing.outletId,
      },
      after: {
        name: updated.name,
        phone: updated.phone,
        role: updated.role,
        outletId: updated.outletId,
      },
      ip,
    });

    return formatAdminUserDto(updated);
  });
};

export const updateUserStatus = async ({ actor, userId, isActive, ip }) => {
  if (userId === actor.id) {
    throw new ConflictError(
      "Admin tidak dapat mengaktifkan atau menonaktifkan dirinya sendiri",
      "SELF_ACTION_FORBIDDEN"
    );
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: userId },
      select: adminUserSelect,
    });

    if (!existing) {
      throw new NotFoundError("Pengguna tidak ditemukan", "USER_NOT_FOUND");
    }

    if (!isActive) {
      await assertNotLastActiveAdmin(tx, existing);
    }

    const updated = await tx.user.update({
      where: { id: userId },
      data: { isActive },
      select: adminUserSelect,
    });

    await revokeAllUserSessions({ db: tx, userId, incrementTokenVersion: true });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "USER_STATUS_CHANGED",
      entity: "User",
      entityId: userId,
      before: { isActive: existing.isActive },
      after: { isActive: updated.isActive },
      ip,
    });

    return formatAdminUserDto(updated);
  });
};

export const softDeleteUser = async ({ actor, userId, ip }) => {
  if (userId === actor.id) {
    throw new ConflictError("Admin tidak dapat menghapus dirinya sendiri", "SELF_ACTION_FORBIDDEN");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: userId },
      select: adminUserSelect,
    });

    if (!existing) {
      throw new NotFoundError("Pengguna tidak ditemukan", "USER_NOT_FOUND");
    }

    await assertNotLastActiveAdmin(tx, existing);

    const activeBookingCount = await tx.booking.count({
      where: {
        OR: [{ customerId: userId }, { mechanicId: userId }],
        status: { in: RULES.ACTIVE_BOOKING_STATUSES },
      },
    });

    if (activeBookingCount > 0) {
      throw new ConflictError(
        "Pengguna tidak dapat dihapus karena masih memiliki booking aktif",
        "ACTIVE_BOOKING_EXISTS"
      );
    }

    await tx.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    await revokeAllUserSessions({ db: tx, userId, incrementTokenVersion: true });

    const deleted = await tx.user.delete({
      where: { id: userId },
      select: adminUserSelect,
    });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "USER_DELETED",
      entity: "User",
      entityId: userId,
      before: { email: existing.email, role: existing.role, isActive: existing.isActive },
      after: { deletedAt: deleted.deletedAt, isActive: false },
      ip,
    });

    return formatAdminUserDto(deleted);
  });
};

export const restoreUser = async ({ actor, userId, ip }) => {
  return withDeleted.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: userId },
      select: adminUserSelect,
    });

    if (!existing) {
      throw new NotFoundError("Pengguna tidak ditemukan", "USER_NOT_FOUND");
    }

    if (existing.deletedAt === null) {
      throw new ConflictError("Pengguna tidak dalam status terhapus", "USER_NOT_DELETED");
    }

    const restored = await tx.user.update({
      where: { id: userId },
      data: { deletedAt: null, isActive: true },
      select: adminUserSelect,
    });

    await recordAuditLog(tx, {
      actorId: actor.id,
      action: "USER_RESTORED",
      entity: "User",
      entityId: userId,
      before: { deletedAt: existing.deletedAt, isActive: existing.isActive },
      after: { deletedAt: null, isActive: true },
      ip,
    });

    return formatAdminUserDto(restored);
  });
};
