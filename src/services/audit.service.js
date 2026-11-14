import prisma from "../config/prisma.js";
import { buildPaginationMeta, parsePagination, parseSort } from "../utils/pagination.js";

const AUDIT_SORT_FIELDS = ["id", "createdAt", "action", "entity"];

export const auditLogSelect = {
  id: true,
  actorId: true,
  actor: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
    },
  },
  action: true,
  entity: true,
  entityId: true,
  before: true,
  after: true,
  ip: true,
  createdAt: true,
};

/**
 * Mencatat perubahan entitas sensitif/master data ke tabel audit_logs.
 */
export const recordAuditLog = async (
  db,
  { actorId = null, action, entity, entityId, before = null, after = null, ip = null }
) => {
  return db.auditLog.create({
    data: {
      actorId,
      action,
      entity,
      entityId: String(entityId),
      before: before ?? undefined,
      after: after ?? undefined,
      ip: ip ? String(ip).slice(0, 64) : null,
    },
  });
};

export const listAuditLogs = async ({ query }) => {
  const { page, limit, skip } = parsePagination(query);
  const orderBy = parseSort(query.sort, AUDIT_SORT_FIELDS, { createdAt: "desc" });

  const where = {};
  if (query.entity) {
    where.entity = { equals: query.entity, mode: "insensitive" };
  }
  if (query.entityId) {
    where.entityId = query.entityId;
  }
  if (query.action) {
    where.action = { equals: query.action, mode: "insensitive" };
  }
  if (query.actorId) {
    where.actorId = query.actorId;
  }
  if (query.from || query.to) {
    where.createdAt = {};
    if (query.from) where.createdAt.gte = new Date(query.from);
    if (query.to) where.createdAt.lte = new Date(query.to);
  }

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: auditLogSelect,
      orderBy,
      skip,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    items,
    meta: buildPaginationMeta({ page, limit, total }),
  };
};

export default {
  auditLogSelect,
  recordAuditLog,
  listAuditLogs,
};
