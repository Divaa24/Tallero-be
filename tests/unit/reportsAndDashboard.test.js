// ==============================================================================
// TALLERO AUTO — REPORTS, DASHBOARD & METRICS UNIT TESTS
// Menguji Dashboard Admin, Laporan, Formula Injection, Ekspor CSV/XLSX/PDF, & Tip Mekanik
// Sesuai AGENTS.md §2, §4, §6, §8
// ==============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import * as reportsService from "../../src/services/reports.service.js";
import * as reportsController from "../../src/controllers/reports.controller.js";
import * as staffController from "../../src/controllers/staff.controller.js";
import { sanitizeCell } from "../../src/services/reportExporters.service.js";
import {
  reportsSummaryQuerySchema,
  reportsExportQuerySchema,
} from "../../src/validations/reports.validation.js";
import { authorize } from "../../src/middlewares/authorize.js";

const storeRef = vi.hoisted(() => ({ current: null }));

vi.mock("../../src/config/prisma.js", () => {
  const handler = {
    get: (_target, prop) => {
      if (prop === "lockOutlet") {
        return async () => {};
      }
      if (prop === "$transaction") {
        return async (fn) => fn(storeRef.current);
      }
      return storeRef.current?.[prop];
    },
  };
  const mockProxy = new Proxy({}, handler);
  return {
    default: mockProxy,
    prisma: mockProxy,
    lockOutlet: async () => {},
    lockCustomer: vi.fn(),
    lockBooking: vi.fn(),
    lockInvoices: vi.fn(),
  };
});

const createReportsMockStore = () => {
  let seq = 6000;
  const tables = {
    user: [],
    outlet: [],
    vehicle: [],
    service: [],
    category: [],
    sparepart: [],
    booking: [],
    bookingItem: [],
    payment: [],
    review: [],
    auditLog: [],
  };

  const matches = (row, where = {}) => {
    if (!row) return false;
    for (const [k, v] of Object.entries(where)) {
      if (k === "OR" && Array.isArray(v)) {
        if (!v.some((sub) => matches(row, sub))) return false;
        continue;
      }
      if (k === "booking" && v && typeof v === "object") {
        const booking = tables.booking.find((b) => b.id === row.bookingId);
        if (!booking || !matches(booking, v)) return false;
        continue;
      }
      if (v && typeof v === "object" && !(v instanceof Date)) {
        if ("in" in v && !v.in.includes(row[k])) return false;
        if ("notIn" in v && v.notIn.includes(row[k])) return false;
        if ("not" in v && row[k] === v.not) return false;
        if ("gte" in v) {
          const val = row[k] instanceof Date ? row[k] : new Date(row[k]);
          if (val < new Date(v.gte)) return false;
        }
        if ("lte" in v) {
          const val = row[k] instanceof Date ? row[k] : new Date(row[k]);
          if (val > new Date(v.lte)) return false;
        }
        continue;
      }
      if (row[k] !== v) {
        if (v === null && row[k] === undefined) continue;
        return false;
      }
    }
    return true;
  };

  const hydrate = (tableName, row) => {
    const clone = { ...row };
    if (tableName === "payment") {
      clone.booking = tables.booking.find((b) => b.id === row.bookingId) || null;
    }
    if (tableName === "user") {
      clone.outlet = tables.outlet.find((o) => o.id === row.outletId) || null;
    }
    if (tableName === "service") {
      clone.category = tables.category.find((c) => c.id === row.categoryId) || null;
    }
    if (tableName === "booking") {
      clone.outlet = tables.outlet.find((o) => o.id === row.outletId) || null;
      clone.customer = tables.user.find((u) => u.id === row.customerId) || null;
      clone.vehicle = tables.vehicle.find((v) => v.id === row.vehicleId) || null;
    }
    return clone;
  };

  const makeApi = (tableName) => {
    const rows = tables[tableName];
    return {
      findMany: async ({ where, orderBy, take, skip } = {}) => {
        let list = rows.filter((r) => matches(r, where));
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0];
          list.sort((a, b) => {
            if (a[field] < b[field]) return dir === "asc" ? -1 : 1;
            if (a[field] > b[field]) return dir === "asc" ? 1 : -1;
            return 0;
          });
        }
        if (typeof skip === "number") {
          list = list.slice(skip);
        }
        if (typeof take === "number") {
          list = list.slice(0, take);
        }
        return list.map((r) => hydrate(tableName, r));
      },
      findFirst: async ({ where } = {}) => {
        const found = rows.find((r) => matches(r, where));
        return found ? hydrate(tableName, found) : null;
      },
      findUnique: async ({ where } = {}) => {
        const found = rows.find((r) => matches(r, where));
        return found ? hydrate(tableName, found) : null;
      },
      count: async ({ where } = {}) => rows.filter((r) => matches(r, where)).length,
      aggregate: async ({ where, _sum, _avg, _count } = {}) => {
        const filtered = rows.filter((r) => matches(r, where));
        const res = { _count: { id: filtered.length } };
        if (_sum) {
          res._sum = {};
          for (const f of Object.keys(_sum)) {
            res._sum[f] = filtered.reduce((acc, r) => acc + (Number(r[f]) || 0), 0);
          }
        }
        if (_avg) {
          res._avg = {};
          for (const f of Object.keys(_avg)) {
            const sum = filtered.reduce((acc, r) => acc + (Number(r[f]) || 0), 0);
            res._avg[f] = filtered.length > 0 ? sum / filtered.length : null;
          }
        }
        return res;
      },
      groupBy: async ({ by, where, _sum, _count, orderBy, take } = {}) => {
        const filtered = rows.filter((r) => matches(r, where));
        const groups = new Map();
        for (const r of filtered) {
          const key = by.map((b) => r[b]).join("___");
          if (!groups.has(key)) {
            const groupItem = {};
            for (const b of by) {
              groupItem[b] = r[b];
            }
            groupItem._rows = [];
            groups.set(key, groupItem);
          }
          groups.get(key)._rows.push(r);
        }

        let list = Array.from(groups.values()).map((g) => {
          const res = {};
          for (const b of by) {
            res[b] = g[b];
          }
          if (_count) {
            res._count = { id: g._rows.length };
          }
          if (_sum) {
            res._sum = {};
            for (const f of Object.keys(_sum)) {
              res._sum[f] = g._rows.reduce((acc, r) => acc + (Number(r[f]) || 0), 0);
            }
          }
          return res;
        });

        if (orderBy?._sum?.subtotal) {
          const dir = orderBy._sum.subtotal;
          list.sort((a, b) => {
            const diff = (b._sum?.subtotal || 0) - (a._sum?.subtotal || 0);
            return dir === "desc" ? diff : -diff;
          });
        }

        if (take) {
          list = list.slice(0, take);
        }
        return list;
      },
      create: async ({ data }) => {
        const item = {
          id: data.id || ++seq,
          ...data,
          createdAt: data.createdAt || new Date(),
          updatedAt: new Date(),
        };
        rows.push(item);
        return hydrate(tableName, item);
      },
    };
  };

  const store = {};
  for (const name of Object.keys(tables)) {
    store[name] = makeApi(name);
  }
  store._tables = tables;
  return store;
};

const createMockRes = () => {
  const res = new PassThrough();
  res.statusCode = 200;
  res.headers = {};
  res.bodyData = "";

  res.setHeader = (k, v) => {
    res.headers[k.toLowerCase()] = v;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.jsonData = data;
    return res;
  };

  res.on("data", (chunk) => {
    res.bodyData += chunk.toString("utf8");
  });

  return res;
};

describe("Fase 9: Dashboard, Laporan, Export, Formula Injection & Tip Mekanik", () => {
  let mockStore;
  let adminUser;
  let customerUser;
  let mechanicUser;
  let testOutlet;

  beforeEach(() => {
    mockStore = createReportsMockStore();
    storeRef.current = mockStore;

    adminUser = {
      id: 1,
      name: "Admin Pusat",
      email: "admin@tallero.test",
      role: "ADMIN",
      isActive: true,
      isVerified: true,
      tokenVersion: 1,
      deletedAt: null,
    };
    customerUser = {
      id: 2,
      name: "Budi Santoso",
      email: "budi@tallero.test",
      role: "CUSTOMER",
      isActive: true,
      isVerified: true,
      tokenVersion: 1,
      deletedAt: null,
    };
    mechanicUser = {
      id: 3,
      name: "Agus Mekanik",
      email: "agus@tallero.test",
      role: "MECHANIC",
      outletId: 10,
      isActive: true,
      isVerified: true,
      tokenVersion: 1,
      deletedAt: null,
    };

    mockStore._tables.user.push(adminUser, customerUser, mechanicUser);

    testOutlet = {
      id: 10,
      name: "Tallero Cabang Barat",
      address: "Jl. Barat No. 10",
      timezone: "Asia/Jakarta",
      isActive: true,
      deletedAt: null,
    };
    mockStore._tables.outlet.push(testOutlet);
  });

  describe("Formula Injection Neutralization (CSV / XLSX / Exporter)", () => {
    it("menambahkan prefiks petik tunggal (') pada sel string berawalan =, +, -, atau @", () => {
      // Potensi formula DDE / command injection
      expect(sanitizeCell("=cmd|' /C calc'!A0")).toBe("'=cmd|' /C calc'!A0");
      expect(sanitizeCell("+123456")).toBe("'+123456");
      expect(sanitizeCell("-9999")).toBe("'-9999");
      expect(sanitizeCell("@SUM(A1:A10)")).toBe("'@SUM(A1:A10)");
      expect(sanitizeCell("  =1+1")).toBe("'  =1+1");

      // Teks normal dan angka murni tidak diubah
      expect(sanitizeCell("TLR-2026-001")).toBe("TLR-2026-001");
      expect(sanitizeCell("Ganti Oli Mesin")).toBe("Ganti Oli Mesin");
      expect(sanitizeCell(150000)).toBe(150000);
      expect(sanitizeCell(null)).toBe("");
      expect(sanitizeCell(undefined)).toBe("");
    });
  });

  describe("Definisi Pendapatan, Pengurangan Refund, & Pemisahan Tip", () => {
    it("menghitung Net Revenue = Paid Invoices - Refunded Invoices, dan tip dilaporkan terpisah", async () => {
      const now = new Date();

      // Booking 1 & 2
      const b1 = { id: 101, outletId: 10, customerId: 2, status: "COMPLETED", scheduledAt: now };
      const b2 = { id: 102, outletId: 10, customerId: 2, status: "COMPLETED", scheduledAt: now };
      mockStore._tables.booking.push(b1, b2);

      // Pembayaran Invoice PAID 1: Rp 300.000
      mockStore._tables.payment.push({
        id: 1,
        bookingId: 101,
        type: "INVOICE",
        status: "PAID",
        amount: 300000,
        paidAt: now,
        updatedAt: now,
      });

      // Pembayaran Invoice PAID 2: Rp 200.000
      mockStore._tables.payment.push({
        id: 2,
        bookingId: 102,
        type: "INVOICE",
        status: "PAID",
        amount: 200000,
        paidAt: now,
        updatedAt: now,
      });

      // Pembayaran Invoice REFUNDED: Rp 50.000 (pengembalian dana)
      mockStore._tables.payment.push({
        id: 3,
        bookingId: 101,
        type: "INVOICE",
        status: "REFUNDED",
        amount: 50000,
        paidAt: now,
        updatedAt: now,
      });

      // Pembayaran TIP Mekanik: Rp 25.000 (bukan pendapatan bengkel)
      mockStore._tables.payment.push({
        id: 4,
        bookingId: 101,
        recipientMechanicId: 3,
        type: "TIP",
        status: "PAID",
        amount: 25000,
        paidAt: now,
        updatedAt: now,
      });

      const metrics = await reportsService.getDashboardMetrics({ outletId: 10 });

      // Gross mencakup penerimaan sebelum refund: 300.000 + 200.000 + 50.000.
      // Refunds = 50.000
      // Net = 550.000 - 50.000 = 500.000
      // Tips = 25.000 (dilaporkan tersendiri)
      expect(metrics.revenue.today.grossRevenue).toBe(550000);
      expect(metrics.revenue.today.refunds).toBe(50000);
      expect(metrics.revenue.today.netRevenue).toBe(500000);
      expect(metrics.revenue.today.tips).toBe(25000);
    });

    it("menghitung efisiensi pengerjaan (waktu tunggu dan durasi servis rata-rata)", async () => {
      const now = new Date();
      const checkInTime = new Date(now.getTime() - 90 * 60000); // 90 menit lalu
      const startTime = new Date(now.getTime() - 60 * 60000); // 60 menit lalu (tunggu = 30 mnt)
      const readyTime = new Date(now.getTime() - 15 * 60000); // 15 menit lalu (durasi servis = 45 mnt)

      mockStore._tables.booking.push({
        id: 103,
        outletId: 10,
        status: "COMPLETED",
        scheduledAt: now,
        checkedInAt: checkInTime,
        startedAt: startTime,
        readyAt: readyTime,
      });

      const metrics = await reportsService.getDashboardMetrics({ outletId: 10 });
      expect(metrics.performance.avgWaitMinutes).toBe(30);
      expect(metrics.performance.avgServiceMinutes).toBe(45);
    });

    it("menampilkan sparepart dengan stok di bawah atau sama dengan LOW_STOCK_THRESHOLD", async () => {
      mockStore._tables.sparepart.push(
        {
          id: 1,
          sku: "OLI-01",
          name: "Oli Mesin",
          stock: 3,
          unit: "botol",
          price: 85000,
          isActive: true,
          deletedAt: null,
        },
        {
          id: 2,
          sku: "BUSI-01",
          name: "Busi Iridium",
          stock: 5,
          unit: "pcs",
          price: 45000,
          isActive: true,
          deletedAt: null,
        },
        {
          id: 3,
          sku: "BAN-01",
          name: "Ban Tubeless",
          stock: 20,
          unit: "pcs",
          price: 250000,
          isActive: true,
          deletedAt: null,
        }
      );

      const metrics = await reportsService.getDashboardMetrics({ outletId: 10 });
      expect(metrics.lowStockSpareparts.length).toBe(2);
      expect(metrics.lowStockSpareparts.map((p) => p.sku)).toContain("OLI-01");
      expect(metrics.lowStockSpareparts.map((p) => p.sku)).toContain("BUSI-01");
      expect(metrics.lowStockSpareparts.map((p) => p.sku)).not.toContain("BAN-01");
    });
  });

  describe("Otorisasi & Hak Akses Endpoint (403 untuk Non-Admin)", () => {
    it("menolak akses role CUSTOMER dan MECHANIC pada middleware authorize('ADMIN')", () => {
      const adminMiddleware = authorize("ADMIN");

      const reqCust = { user: customerUser };
      const nextCust = vi.fn();
      expect(() => adminMiddleware(reqCust, {}, nextCust)).toThrow(/tidak memiliki izin/i);

      const reqMech = { user: mechanicUser };
      const nextMech = vi.fn();
      expect(() => adminMiddleware(reqMech, {}, nextMech)).toThrow(/tidak memiliki izin/i);

      const reqAdmin = { user: adminUser };
      const nextAdmin = vi.fn();
      adminMiddleware(reqAdmin, {}, nextAdmin);
      expect(nextAdmin).toHaveBeenCalledOnce();
    });

    it("mengizinkan ADMIN mengakses controller getDashboard dan getSummary", async () => {
      const req = {
        user: adminUser,
        valid: { query: { outletId: 10, range: "today" } },
      };
      const res = createMockRes();

      await reportsController.getDashboard(req, res);
      expect(res.jsonData).toBeDefined();
      expect(res.jsonData.success).toBe(true);
      expect(res.jsonData.data.revenue).toBeDefined();

      const reqSummary = {
        user: adminUser,
        valid: { query: { from: "2026-11-01", to: "2026-11-13", outletId: 10 } },
      };
      const resSummary = createMockRes();

      await reportsController.getSummary(reqSummary, resSummary);
      expect(resSummary.jsonData).toBeDefined();
      expect(resSummary.jsonData.success).toBe(true);
      expect(resSummary.jsonData.data.revenue).toBeDefined();
      expect(resSummary.jsonData.data.bookings).toBeDefined();
    });
  });

  describe("Validasi Parameter Laporan & Batas Rentang Waktu (Max 366 Hari)", () => {
    it("menolak rentang laporan yang melebihi 366 hari", () => {
      // Rentang 400 hari
      const parseResult = reportsSummaryQuerySchema.safeParse({
        from: "2025-01-01",
        to: "2026-02-05",
      });

      expect(parseResult.success).toBe(false);
      expect(parseResult.error.issues[0].message).toContain("366 hari");
    });

    it("menolak jika from lebih besar daripada to", () => {
      const parseResult = reportsSummaryQuerySchema.safeParse({
        from: "2026-11-15",
        to: "2026-11-01",
      });

      expect(parseResult.success).toBe(false);
      expect(parseResult.error.issues[0].message).toContain("tidak boleh lebih besar");
    });

    it("menolak format tanggal yang tidak valid", () => {
      const parseResult = reportsSummaryQuerySchema.safeParse({
        from: "15-11-2026",
        to: "invalid-date",
      });

      expect(parseResult.success).toBe(false);
    });

    it("menolak jika type atau format ekspor tidak ada dalam whitelist", () => {
      const parseType = reportsExportQuerySchema.safeParse({
        type: "hacked",
        format: "csv",
        from: "2026-11-01",
        to: "2026-11-13",
      });
      expect(parseType.success).toBe(false);

      const parseFormat = reportsExportQuerySchema.safeParse({
        type: "stock",
        format: "exe",
        from: "2026-11-01",
        to: "2026-11-13",
      });
      expect(parseFormat.success).toBe(false);
    });
  });

  describe("Privasi & Hak Akses Tip Mekanik (/api/v1/staff/me/tips)", () => {
    it("mengizinkan mekanik melihat total dan daftar tip miliknya tanpa data pribadi pelanggan", async () => {
      const now = new Date();
      mockStore._tables.booking.push({
        id: 201,
        code: "TLR-20261113-ABC123",
        customerId: 2,
        status: "COMPLETED",
        total: 250000,
      });

      mockStore._tables.payment.push({
        id: 88,
        bookingId: 201,
        recipientMechanicId: 3, // milik Agus
        orderId: "TIP-20261113-001",
        amount: 35000,
        type: "TIP",
        status: "PAID",
        paidAt: now,
      });

      // Tip milik mekanik lain (id: 4)
      mockStore._tables.payment.push({
        id: 89,
        bookingId: 201,
        recipientMechanicId: 4,
        orderId: "TIP-20261113-002",
        amount: 50000,
        type: "TIP",
        status: "PAID",
        paidAt: now,
      });

      const res = createMockRes();
      const req = {
        user: mechanicUser,
        valid: { query: { page: 1, limit: 20 } },
      };

      await staffController.getMeTips(req, res);

      expect(res.jsonData).toBeDefined();
      expect(res.jsonData.success).toBe(true);
      expect(res.jsonData.data.totalTips).toBe(35000);
      expect(res.jsonData.data.tips.length).toBe(1);
      expect(res.jsonData.data.tips[0].orderId).toBe("TIP-20261113-001");
      expect(res.jsonData.data.tips[0].booking.code).toBe("TLR-20261113-ABC123");

      // Verifikasi TIDAK ADA kebocoran data pribadi pelanggan (nama, email, phone)
      expect(res.jsonData.data.tips[0].customer).toBeUndefined();
      expect(res.jsonData.data.tips[0].customerName).toBeUndefined();
      expect(res.jsonData.data.tips[0].phone).toBeUndefined();
    });

    it("menolak akses CUSTOMER ke authorize('MECHANIC')", () => {
      const mechanicMiddleware = authorize("MECHANIC");
      const reqCust = { user: customerUser };
      const nextCust = vi.fn();
      expect(() => mechanicMiddleware(reqCust, {}, nextCust)).toThrow(/tidak memiliki izin/i);
    });
  });

  describe("Ekspor Laporan & Pencatatan AuditLog", () => {
    it("mengekspor laporan format CSV dengan UTF-8 BOM dan mencatat AuditLog", async () => {
      mockStore._tables.sparepart.push({
        id: 10,
        sku: "=cmd|'calc'!A0", // Uji formula injection di nama / SKU
        name: "@Formula Injection Part",
        price: 50000,
        stock: 2,
        unit: "pcs",
        deletedAt: null,
      });

      const res = createMockRes();
      const req = {
        user: adminUser,
        ip: "127.0.0.1",
        valid: {
          query: {
            type: "stock",
            format: "csv",
            from: "2026-11-01",
            to: "2026-11-13",
          },
        },
      };

      await reportsController.exportData(req, res);

      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain(
        "report_stock_2026-11-01_2026-11-13.csv"
      );

      // Verifikasi UTF-8 BOM
      expect(res.bodyData.startsWith("\uFEFF")).toBe(true);

      // Verifikasi sel formula dinetralkan dengan '
      expect(res.bodyData).toContain("'=cmd|'calc'!A0");
      expect(res.bodyData).toContain("'@Formula Injection Part");

      // Verifikasi AuditLog tercatat
      const auditLogs = mockStore._tables.auditLog;
      expect(auditLogs.length).toBeGreaterThan(0);
      const exportAudit = auditLogs.find((a) => a.action === "REPORT_EXPORTED");
      expect(exportAudit).toBeDefined();
      expect(exportAudit.actorId).toBe(1);
      expect(exportAudit.entity).toBe("Report");
      expect(exportAudit.entityId).toBe("stock-csv");
    });

    it("mengekspor laporan format XLSX via ExcelJS dan mencatat AuditLog", async () => {
      mockStore._tables.sparepart.push({
        id: 11,
        sku: "SP-001",
        name: "Busi Racing",
        price: 75000,
        stock: 10,
        unit: "pcs",
        deletedAt: null,
      });

      const res = createMockRes();
      const req = {
        user: adminUser,
        ip: "127.0.0.1",
        valid: {
          query: {
            type: "stock",
            format: "xlsx",
            from: "2026-11-01",
            to: "2026-11-13",
          },
        },
      };

      await reportsController.exportData(req, res);

      expect(res.headers["content-type"]).toContain("spreadsheetml.sheet");
      expect(res.headers["content-disposition"]).toContain(
        "report_stock_2026-11-01_2026-11-13.xlsx"
      );

      const exportAudit = mockStore._tables.auditLog.find((a) => a.entityId === "stock-xlsx");
      expect(exportAudit).toBeDefined();
    });

    it("mengekspor laporan format PDF via PDFKit dan mencatat AuditLog", async () => {
      const res = createMockRes();
      const req = {
        user: adminUser,
        ip: "127.0.0.1",
        valid: {
          query: {
            type: "stock",
            format: "pdf",
            from: "2026-11-01",
            to: "2026-11-13",
          },
        },
      };

      await reportsController.exportData(req, res);

      expect(res.headers["content-type"]).toContain("application/pdf");
      expect(res.headers["content-disposition"]).toContain(
        "report_stock_2026-11-01_2026-11-13.pdf"
      );

      const exportAudit = mockStore._tables.auditLog.find((a) => a.entityId === "stock-pdf");
      expect(exportAudit).toBeDefined();
    });
  });
});
