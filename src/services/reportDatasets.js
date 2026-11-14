// ==============================================================================
// TALLERO AUTO — REPORT DATASETS BUILDER
// Sesuai AGENTS.md §2, §4, §8
// Mempersiapkan struktur kolom & baris untuk berbagai jenis ekspor laporan
// ==============================================================================

import prisma from "../config/prisma.js";
import { DateTime } from "luxon";
import RULES from "../config/rules.js";

/**
 * Mengambil dataset laporan pendapatan
 */
export const fetchRevenueDataset = async ({ start, end, outletId }) => {
  const headers = [
    { label: "Order ID", key: "orderId", width: 25 },
    { label: "Tanggal", key: "paidAt", width: 20 },
    { label: "Tipe", key: "type", width: 12 },
    { label: "Metode", key: "method", width: 12 },
    { label: "Status", key: "status", width: 12 },
    { label: "Jumlah (Rp)", key: "amount", width: 15, align: "right" },
    { label: "Kode Booking", key: "bookingCode", width: 22 },
  ];

  const payments = await prisma.payment.findMany({
    where: {
      paidAt: { gte: start, lte: end },
      ...(outletId ? { booking: { outletId } } : {}),
    },
    include: {
      booking: { select: { code: true } },
    },
    orderBy: { paidAt: "desc" },
  });

  const rows = payments.map((p) => ({
    orderId: p.orderId,
    paidAt: p.paidAt
      ? DateTime.fromJSDate(p.paidAt).setZone(RULES.TIMEZONE).toFormat("yyyy-MM-dd HH:mm")
      : "-",
    type: p.type,
    method: p.method,
    status: p.status,
    amount: p.amount,
    bookingCode: p.booking?.code || "-",
  }));

  return { headers, rows };
};

/**
 * Mengambil dataset laporan booking
 */
export const fetchBookingsDataset = async ({ start, end, outletId }) => {
  const headers = [
    { label: "Kode", key: "code", width: 22 },
    { label: "Jadwal", key: "scheduledAt", width: 20 },
    { label: "Outlet", key: "outlet", width: 20 },
    { label: "Customer", key: "customer", width: 20 },
    { label: "Kendaraan", key: "vehicle", width: 18 },
    { label: "Status", key: "status", width: 15 },
    { label: "Total (Rp)", key: "total", width: 15, align: "right" },
    { label: "Pembayaran", key: "paymentStatus", width: 14 },
  ];

  const bookings = await prisma.booking.findMany({
    where: {
      scheduledAt: { gte: start, lte: end },
      ...(outletId ? { outletId } : {}),
    },
    include: {
      outlet: { select: { name: true } },
      customer: { select: { name: true } },
      vehicle: { select: { plateNumber: true, brand: true, model: true } },
    },
    orderBy: { scheduledAt: "desc" },
  });

  const rows = bookings.map((b) => ({
    code: b.code,
    scheduledAt: DateTime.fromJSDate(b.scheduledAt)
      .setZone(RULES.TIMEZONE)
      .toFormat("yyyy-MM-dd HH:mm"),
    outlet: b.outlet?.name || "-",
    customer: b.customer?.name || "-",
    vehicle: b.vehicle ? `${b.vehicle.plateNumber} (${b.vehicle.brand})` : "-",
    status: b.status,
    total: b.total,
    paymentStatus: b.paymentStatus,
  }));

  return { headers, rows };
};

/**
 * Mengambil dataset laporan performa mekanik
 */
export const fetchMechanicsDataset = async ({ start, end, outletId }) => {
  const headers = [
    { label: "Nama Mekanik", key: "name", width: 25 },
    { label: "Outlet", key: "outlet", width: 20 },
    { label: "Job Selesai", key: "completedJobs", width: 14, align: "right" },
    { label: "Rating Rata-rata", key: "rating", width: 16, align: "right" },
    { label: "Total Tip (Rp)", key: "tips", width: 18, align: "right" },
  ];

  const mechanics = await prisma.user.findMany({
    where: {
      role: "MECHANIC",
      deletedAt: null,
      ...(outletId ? { outletId } : {}),
    },
    include: {
      outlet: { select: { name: true } },
    },
  });

  const rows = await Promise.all(
    mechanics.map(async (m) => {
      const [completedJobs, reviewAgg, tipAgg] = await Promise.all([
        prisma.booking.count({
          where: {
            mechanicId: m.id,
            status: "COMPLETED",
            scheduledAt: { gte: start, lte: end },
          },
        }),
        prisma.review.aggregate({
          where: { mechanicId: m.id, isHidden: false },
          _avg: { rating: true },
        }),
        prisma.payment.aggregate({
          where: {
            recipientMechanicId: m.id,
            type: "TIP",
            status: "PAID",
            paidAt: { gte: start, lte: end },
          },
          _sum: { amount: true },
        }),
      ]);

      return {
        name: m.name,
        outlet: m.outlet?.name || "-",
        completedJobs,
        rating: reviewAgg._avg.rating ? reviewAgg._avg.rating.toFixed(1) : "0.0",
        tips: tipAgg._sum.amount || 0,
      };
    })
  );

  return { headers, rows };
};

/**
 * Mengambil dataset laporan performa layanan/katalog
 */
export const fetchServicesDataset = async ({ start, end, outletId }) => {
  const headers = [
    { label: "Nama Layanan", key: "name", width: 30 },
    { label: "Kategori", key: "category", width: 20 },
    { label: "Jumlah Order", key: "ordersCount", width: 15, align: "right" },
    { label: "Total Qty", key: "quantity", width: 14, align: "right" },
    { label: "Pendapatan (Rp)", key: "revenue", width: 18, align: "right" },
  ];

  const agg = await prisma.bookingItem.groupBy({
    by: ["serviceId", "nameSnapshot"],
    where: {
      type: "SERVICE",
      approvalStatus: "APPROVED",
      serviceId: { not: null },
      booking: {
        status: { notIn: ["CANCELLED"] },
        scheduledAt: { gte: start, lte: end },
        ...(outletId ? { outletId } : {}),
      },
    },
    _sum: { subtotal: true, quantity: true },
    _count: { id: true },
    orderBy: { _sum: { subtotal: "desc" } },
  });

  const serviceIds = agg.map((a) => a.serviceId).filter(Boolean);
  const serviceRecords = await prisma.service.findMany({
    where: { id: { in: serviceIds } },
    include: { category: { select: { name: true } } },
  });
  const categoryMap = new Map(serviceRecords.map((s) => [s.id, s.category?.name]));

  const rows = agg.map((a) => ({
    name: a.nameSnapshot,
    category: categoryMap.get(a.serviceId) || "-",
    ordersCount: a._count.id || 0,
    quantity: a._sum.quantity || 0,
    revenue: a._sum.subtotal || 0,
  }));

  return { headers, rows };
};

/**
 * Mengambil dataset laporan stok sparepart
 */
export const fetchStockDataset = async () => {
  const headers = [
    { label: "SKU", key: "sku", width: 18 },
    { label: "Nama Sparepart", key: "name", width: 30 },
    { label: "Harga (Rp)", key: "price", width: 15, align: "right" },
    { label: "Stok", key: "stock", width: 12, align: "right" },
    { label: "Satuan", key: "unit", width: 12 },
    { label: "Status", key: "status", width: 15 },
  ];

  const parts = await prisma.sparepart.findMany({
    where: { deletedAt: null },
    orderBy: { stock: "asc" },
  });

  const rows = parts.map((p) => ({
    sku: p.sku,
    name: p.name,
    price: p.price,
    stock: p.stock,
    unit: p.unit,
    status: p.stock <= RULES.LOW_STOCK_THRESHOLD ? "MENIPIS" : "AMAN",
  }));

  return { headers, rows };
};

export default {
  fetchRevenueDataset,
  fetchBookingsDataset,
  fetchMechanicsDataset,
  fetchServicesDataset,
  fetchStockDataset,
};

