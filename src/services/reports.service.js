// ==============================================================================
// TALLERO AUTO — REPORTS & DASHBOARD SERVICE
// Sesuai AGENTS.md §2, §4, §6, §8
// ==============================================================================

import prisma from "../config/prisma.js";
import { DateTime } from "luxon";
import RULES from "../config/rules.js";
import { recordAuditLog } from "./audit.service.js";
import { exportToCsv, exportToXlsx, exportToPdf, sanitizeCell } from "./reportExporters.service.js";
import {
  fetchRevenueDataset,
  fetchBookingsDataset,
  fetchMechanicsDataset,
  fetchServicesDataset,
  fetchStockDataset,
} from "./reportDatasets.service.js";

const calcGrowth = (current, previous) => {
  if (!previous || previous === 0) {
    return current > 0 ? 100 : 0;
  }
  return Math.round(((current - previous) / previous) * 100);
};

/**
 * Menghitung metrik finansial (Net Revenue = Paid Invoices - Refunded Invoices, Tip dipisah)
 */
const getPeriodRevenue = async ({ start, end, outletId }) => {
  const whereBase = {
    ...(outletId ? { booking: { outletId } } : {}),
  };

  const [paidInvoices, refundedInvoices, paidTips] = await Promise.all([
    prisma.payment.aggregate({
      where: {
        ...whereBase,
        type: "INVOICE",
        status: { in: ["PAID", "REFUNDED"] },
        paidAt: { gte: start, lte: end },
      },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: {
        ...whereBase,
        type: "INVOICE",
        status: "REFUNDED",
        updatedAt: { gte: start, lte: end },
      },
      _sum: { amount: true },
    }),
    prisma.payment.aggregate({
      where: {
        ...whereBase,
        type: "TIP",
        status: "PAID",
        paidAt: { gte: start, lte: end },
      },
      _sum: { amount: true },
    }),
  ]);

  const gross = paidInvoices._sum.amount || 0;
  const refunds = refundedInvoices._sum.amount || 0;
  const net = gross - refunds;
  const tips = paidTips._sum.amount || 0;

  return { gross, refunds, net, tips };
};

/**
 * Mengambil ringkasan metrik dashboard admin.
 */
export const getDashboardMetrics = async ({ outletId }) => {
  const now = DateTime.now().setZone(RULES.TIMEZONE);

  const todayStart = now.startOf("day").toUTC().toJSDate();
  const todayEnd = now.endOf("day").toUTC().toJSDate();
  const yestStart = now.minus({ days: 1 }).startOf("day").toUTC().toJSDate();
  const yestEnd = now.minus({ days: 1 }).endOf("day").toUTC().toJSDate();

  const monthStart = now.startOf("month").toUTC().toJSDate();
  const monthEnd = now.endOf("month").toUTC().toJSDate();
  const prevMonthStart = now.minus({ months: 1 }).startOf("month").toUTC().toJSDate();
  const prevMonthEnd = now.minus({ months: 1 }).endOf("month").toUTC().toJSDate();

  const yearStart = now.startOf("year").toUTC().toJSDate();
  const yearEnd = now.endOf("year").toUTC().toJSDate();
  const prevYearStart = now.minus({ years: 1 }).startOf("year").toUTC().toJSDate();
  const prevYearEnd = now.minus({ years: 1 }).endOf("year").toUTC().toJSDate();

  const [
    todayRev,
    yestRev,
    monthRev,
    prevMonthRev,
    yearRev,
    prevYearRev,
    todayBookings,
    queueCounts,
    recentCompleted,
    topServicesAgg,
    mechanics,
    lowStockSpareparts,
  ] = await Promise.all([
    getPeriodRevenue({ start: todayStart, end: todayEnd, outletId }),
    getPeriodRevenue({ start: yestStart, end: yestEnd, outletId }),
    getPeriodRevenue({ start: monthStart, end: monthEnd, outletId }),
    getPeriodRevenue({ start: prevMonthStart, end: prevMonthEnd, outletId }),
    getPeriodRevenue({ start: yearStart, end: yearEnd, outletId }),
    getPeriodRevenue({ start: prevYearStart, end: prevYearEnd, outletId }),

    // Status booking hari ini
    prisma.booking.groupBy({
      by: ["status"],
      where: {
        scheduledAt: { gte: todayStart, lte: todayEnd },
        ...(outletId ? { outletId } : {}),
      },
      _count: { id: true },
    }),

    // Antrian aktif saat ini
    prisma.booking.count({
      where: {
        status: {
          in: ["PENDING", "CHECKED_IN", "IN_PROGRESS", "WAITING_APPROVAL", "READY_FOR_PICKUP"],
        },
        ...(outletId ? { outletId } : {}),
      },
    }),

    // Waktu tunggu & durasi servis
    prisma.booking.findMany({
      where: {
        status: { in: ["READY_FOR_PICKUP", "COMPLETED"] },
        checkedInAt: { not: null },
        startedAt: { not: null },
        scheduledAt: { gte: monthStart, lte: monthEnd },
        ...(outletId ? { outletId } : {}),
      },
      select: {
        checkedInAt: true,
        startedAt: true,
        readyAt: true,
      },
      take: 200,
    }),

    // Top layanan berdasarkan subtotal pendapatan item
    prisma.bookingItem.groupBy({
      by: ["serviceId", "nameSnapshot"],
      where: {
        type: "SERVICE",
        approvalStatus: "APPROVED",
        serviceId: { not: null },
        booking: {
          status: { notIn: ["CANCELLED"] },
          scheduledAt: { gte: monthStart, lte: monthEnd },
          ...(outletId ? { outletId } : {}),
        },
      },
      _sum: { subtotal: true, quantity: true },
      _count: { id: true },
      orderBy: {
        _sum: { subtotal: "desc" },
      },
      take: 5,
    }),

    // Data mekanik aktif
    prisma.user.findMany({
      where: {
        role: "MECHANIC",
        isActive: true,
        deletedAt: null,
        ...(outletId ? { outletId } : {}),
      },
      select: {
        id: true,
        name: true,
        outlet: { select: { id: true, name: true } },
      },
    }),

    // Sparepart stok menipis
    prisma.sparepart.findMany({
      where: {
        stock: { lte: RULES.LOW_STOCK_THRESHOLD },
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        sku: true,
        name: true,
        stock: true,
        unit: true,
        price: true,
      },
      orderBy: { stock: "asc" },
      take: 10,
    }),
  ]);

  // Susun status booking hari ini
  const statusMap = {
    PENDING: 0,
    CHECKED_IN: 0,
    IN_PROGRESS: 0,
    WAITING_APPROVAL: 0,
    READY_FOR_PICKUP: 0,
    COMPLETED: 0,
    CANCELLED: 0,
    NO_SHOW: 0,
  };
  let totalTodayBookings = 0;
  for (const row of todayBookings) {
    statusMap[row.status] = row._count.id;
    totalTodayBookings += row._count.id;
  }

  const noShowRate =
    totalTodayBookings > 0
      ? Number(((statusMap.NO_SHOW / totalTodayBookings) * 100).toFixed(1))
      : 0;

  // Hitung rata-rata waktu tunggu & durasi servis dalam menit
  let totalWaitMinutes = 0;
  let waitCount = 0;
  let totalServiceMinutes = 0;
  let serviceCount = 0;

  for (const b of recentCompleted) {
    if (b.checkedInAt && b.startedAt) {
      const diff = (new Date(b.startedAt) - new Date(b.checkedInAt)) / 60000;
      if (diff >= 0) {
        totalWaitMinutes += diff;
        waitCount++;
      }
    }
    if (b.startedAt && b.readyAt) {
      const diff = (new Date(b.readyAt) - new Date(b.startedAt)) / 60000;
      if (diff >= 0) {
        totalServiceMinutes += diff;
        serviceCount++;
      }
    }
  }

  const avgWaitMinutes = waitCount > 0 ? Math.round(totalWaitMinutes / waitCount) : 0;
  const avgServiceMinutes = serviceCount > 0 ? Math.round(totalServiceMinutes / serviceCount) : 0;

  // Leaderboard mekanik
  const mechanicLeaderboard = await Promise.all(
    mechanics.map(async (m) => {
      const [completedJobs, reviewAgg, tipAgg] = await Promise.all([
        prisma.booking.count({
          where: {
            mechanicId: m.id,
            status: "COMPLETED",
            ...(outletId ? { outletId } : {}),
          },
        }),
        prisma.review.aggregate({
          where: { mechanicId: m.id, isHidden: false },
          _avg: { rating: true },
          _count: { id: true },
        }),
        prisma.payment.aggregate({
          where: {
            recipientMechanicId: m.id,
            type: "TIP",
            status: "PAID",
          },
          _sum: { amount: true },
        }),
      ]);

      return {
        id: m.id,
        name: m.name,
        outlet: m.outlet,
        completedJobs,
        averageRating: reviewAgg._avg.rating ? Number(reviewAgg._avg.rating.toFixed(1)) : 0,
        reviewsCount: reviewAgg._count.id,
        totalTips: tipAgg._sum.amount || 0,
      };
    })
  );

  mechanicLeaderboard.sort((a, b) => {
    if (b.completedJobs !== a.completedJobs) return b.completedJobs - a.completedJobs;
    if (b.averageRating !== a.averageRating) return b.averageRating - a.averageRating;
    return b.totalTips - a.totalTips;
  });

  const topServices = topServicesAgg.map((s) => ({
    serviceId: s.serviceId,
    name: s.nameSnapshot,
    revenue: s._sum.subtotal || 0,
    quantity: s._sum.quantity || 0,
    bookingsCount: s._count.id || 0,
  }));

  return {
    revenue: {
      today: {
        netRevenue: todayRev.net,
        grossRevenue: todayRev.gross,
        refunds: todayRev.refunds,
        tips: todayRev.tips,
        growthPercentage: calcGrowth(todayRev.net, yestRev.net),
      },
      month: {
        netRevenue: monthRev.net,
        grossRevenue: monthRev.gross,
        refunds: monthRev.refunds,
        tips: monthRev.tips,
        growthPercentage: calcGrowth(monthRev.net, prevMonthRev.net),
      },
      year: {
        netRevenue: yearRev.net,
        grossRevenue: yearRev.gross,
        refunds: yearRev.refunds,
        tips: yearRev.tips,
        growthPercentage: calcGrowth(yearRev.net, prevYearRev.net),
      },
    },
    bookings: {
      todayTotal: totalTodayBookings,
      activeQueue: queueCounts,
      statusDistribution: statusMap,
      noShowRate,
    },
    performance: {
      avgWaitMinutes,
      avgServiceMinutes,
    },
    topServices,
    mechanicLeaderboard: mechanicLeaderboard.slice(0, 10),
    lowStockSpareparts,
  };
};

/**
 * Ringkasan laporan operasional dan finansial untuk rentang tanggal tertentu.
 */
export const getReportsSummary = async ({ from, to, outletId }) => {
  const start = DateTime.fromISO(from, { zone: RULES.TIMEZONE }).startOf("day").toUTC().toJSDate();
  const end = DateTime.fromISO(to, { zone: RULES.TIMEZONE }).endOf("day").toUTC().toJSDate();

  const [rev, statusAgg, completedCount, totalBookings] = await Promise.all([
    getPeriodRevenue({ start, end, outletId }),
    prisma.booking.groupBy({
      by: ["status"],
      where: {
        scheduledAt: { gte: start, lte: end },
        ...(outletId ? { outletId } : {}),
      },
      _count: { id: true },
    }),
    prisma.booking.count({
      where: {
        status: "COMPLETED",
        scheduledAt: { gte: start, lte: end },
        ...(outletId ? { outletId } : {}),
      },
    }),
    prisma.booking.count({
      where: {
        scheduledAt: { gte: start, lte: end },
        ...(outletId ? { outletId } : {}),
      },
    }),
  ]);

  const statusDistribution = {};
  for (const row of statusAgg) {
    statusDistribution[row.status] = row._count.id;
  }

  const avgBookingValue = completedCount > 0 ? Math.round(rev.net / completedCount) : 0;

  return {
    dateRange: { from, to },
    revenue: rev,
    bookings: {
      total: totalBookings,
      completed: completedCount,
      statusDistribution,
      avgBookingValue,
    },
  };
};

/**
 * Ekspor dataset laporan ke CSV, XLSX, atau PDF.
 */
export const exportReport = async ({ type, format, from, to, outletId, res, actor, ip }) => {
  const start = DateTime.fromISO(from, { zone: RULES.TIMEZONE }).startOf("day").toUTC().toJSDate();
  const end = DateTime.fromISO(to, { zone: RULES.TIMEZONE }).endOf("day").toUTC().toJSDate();

  let headers = [];
  let rows = [];
  const title = `Laporan ${type.toUpperCase()}`;
  const subtitle = `Periode: ${from} s/d ${to} | Dicetak oleh: ${actor.name}`;
  const filename = `report_${type}_${from}_${to}.${format}`;

  if (type === "revenue") {
    const dataset = await fetchRevenueDataset({ start, end, outletId });
    headers = dataset.headers;
    rows = dataset.rows;
  } else if (type === "bookings") {
    const dataset = await fetchBookingsDataset({ start, end, outletId });
    headers = dataset.headers;
    rows = dataset.rows;
  } else if (type === "mechanics") {
    const dataset = await fetchMechanicsDataset({ start, end, outletId });
    headers = dataset.headers;
    rows = dataset.rows;
  } else if (type === "services") {
    const dataset = await fetchServicesDataset({ start, end, outletId });
    headers = dataset.headers;
    rows = dataset.rows;
  } else if (type === "stock") {
    const dataset = await fetchStockDataset();
    headers = dataset.headers;
    rows = dataset.rows;
  }

  // Catat AuditLog untuk setiap ekspor
  await recordAuditLog(prisma, {
    actorId: actor.id,
    action: "REPORT_EXPORTED",
    entity: "Report",
    entityId: `${type}-${format}`,
    after: { type, format, from, to, outletId: outletId || null },
    ip,
  });

  if (format === "csv") {
    return exportToCsv({ headers, rows, filename, res });
  }
  if (format === "xlsx") {
    return exportToXlsx({ title, headers, rows, filename, res });
  }
  if (format === "pdf") {
    return exportToPdf({ title, subtitle, headers, rows, filename, res });
  }
};

export default {
  getDashboardMetrics,
  getReportsSummary,
  exportReport,
  sanitizeCell,
};
