// ==============================================================================
// TALLERO AUTO — STAFF SERVICE
// Sesuai AGENTS.md §2, §4, §6, §8
// ==============================================================================

import prisma from "../config/prisma.js";
import { DateTime } from "luxon";
import RULES from "../config/rules.js";

const staffTipSelect = {
  id: true,
  orderId: true,
  amount: true,
  status: true,
  paidAt: true,
  booking: {
    select: {
      id: true,
      code: true,
    },
  },
};

/**
 * Mengambil daftar dan total tip untuk staf mekanik yang sedang login.
 * Data customer (nama, kontak) disembunyikan untuk melindungi privasi.
 */
export const getStaffMeTips = async ({ actor, query = {} }) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const skip = (page - 1) * limit;

  const where = {
    recipientMechanicId: actor.id,
    type: "TIP",
    status: "PAID",
  };

  if (query.from || query.to) {
    where.paidAt = {};
    if (query.from) {
      where.paidAt.gte = DateTime.fromISO(query.from, { zone: RULES.TIMEZONE })
        .startOf("day")
        .toUTC()
        .toJSDate();
    }
    if (query.to) {
      where.paidAt.lte = DateTime.fromISO(query.to, { zone: RULES.TIMEZONE })
        .endOf("day")
        .toUTC()
        .toJSDate();
    }
  }

  const [total, items, tipSum] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      select: staffTipSelect,
      orderBy: { paidAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.payment.aggregate({
      where,
      _sum: {
        amount: true,
      },
    }),
  ]);

  return {
    totalTips: tipSum._sum.amount || 0,
    items,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
};

export default {
  getStaffMeTips,
};

