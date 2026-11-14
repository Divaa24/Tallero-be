// ==============================================================================
// TALLERO AUTO — PAYMENTS & MIDTRANS UNIT TESTS
// Menguji Midtrans Snap (mock HTTP fetch), Webhook, Idempotency, Duplikasi,
// Kasir Tunai, Tip Mekanik, dan Faktur PDF sesuai AGENTS.md §4 & §8
// ==============================================================================

import crypto from "node:crypto";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import env from "../../src/config/env.js";
import * as paymentsService from "../../src/services/payments.service.js";
import * as bookingsService from "../../src/services/bookings.service.js";
import { runPaymentSync } from "../../src/jobs/paymentSync.job.js";

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
  };
});

// Mock Socket.IO realtime event emitter
vi.mock("../../src/config/socket.js", () => ({
  emitRealtimeEvent: vi.fn(),
  getIO: vi.fn(() => ({ to: () => ({ emit: vi.fn() }) })),
}));

// Mock mail.service
vi.mock("../../src/services/mail.service.js", () => ({
  sendMail: vi.fn(async () => ({ messageId: "mock-mail-id" })),
  buildReadyForPickupEmail: vi.fn(() => ({ subject: "Siap", html: "<p>Siap</p>", text: "Siap" })),
}));

/**
 * In-memory Mock Store untuk database Prisma
 */
const createPaymentsMockStore = () => {
  let seq = 5000;
  const tables = {
    user: [],
    outlet: [],
    vehicle: [],
    service: [],
    sparepart: [],
    booking: [],
    bookingItem: [],
    bookingPhoto: [],
    bookingLog: [],
    payment: [],
    notification: [],
    auditLog: [],
    serviceReminder: [],
  };

  const matches = (row, where = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (k === "OR" && Array.isArray(v)) return v.some((sub) => matches(row, sub));
      if (v && typeof v === "object" && !(v instanceof Date)) {
        if ("in" in v) return v.in.includes(row[k]);
        if ("notIn" in v) return !v.notIn.includes(row[k]);
        if ("not" in v) return row[k] !== v.not;
        if ("gte" in v) return row[k] >= v.gte;
        if ("gt" in v) return row[k] > v.gt;
        if ("lte" in v) return row[k] <= v.lte;
        if ("lt" in v) return row[k] < v.lt;
        if ("startsWith" in v) return String(row[k] || "").startsWith(v.startsWith);
      }
      if (row[k] instanceof Date && v instanceof Date) {
        return row[k].getTime() === v.getTime();
      }
      return row[k] === v;
    });

  const hydrate = (tableName, row) => {
    const clone = { ...row };
    if (tableName === "booking") {
      clone.outlet = tables.outlet.find((o) => o.id === row.outletId) || null;
      clone.vehicle = tables.vehicle.find((v) => v.id === row.vehicleId) || null;
      clone.customer = tables.user.find((u) => u.id === row.customerId) || null;
      clone.mechanic = tables.user.find((u) => u.id === row.mechanicId) || null;
      clone.items = tables.bookingItem
        .filter((i) => i.bookingId === row.id)
        .map((i) => ({
          ...i,
          service: tables.service.find((s) => s.id === i.serviceId) || null,
          sparepart: tables.sparepart.find((sp) => sp.id === i.sparepartId) || null,
        }));
      clone.photos = tables.bookingPhoto.filter(
        (p) => p.bookingId === row.id && p.deletedAt === null
      );
      clone.payments = tables.payment.filter((p) => p.bookingId === row.id);
    }
    if (tableName === "payment") {
      clone.booking = tables.booking.find((b) => b.id === row.bookingId) || null;
      if (clone.booking) {
        clone.booking = hydrate("booking", clone.booking);
      }
    }
    if (tableName === "bookingItem") {
      clone.service = tables.service.find((s) => s.id === row.serviceId) || null;
      clone.sparepart = tables.sparepart.find((sp) => sp.id === row.sparepartId) || null;
    }
    return clone;
  };

  const makeApi = (tableName) => {
    const rows = tables[tableName];
    return {
      findMany: async ({ where, orderBy } = {}) => {
        const list = rows.filter((r) => matches(r, where));
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0];
          list.sort((a, b) => {
            if (a[field] < b[field]) return dir === "asc" ? -1 : 1;
            if (a[field] > b[field]) return dir === "asc" ? 1 : -1;
            return 0;
          });
        }
        return list.map((r) => hydrate(tableName, r));
      },
      findFirst: async ({ where, orderBy } = {}) => {
        const list = rows.filter((r) => matches(r, where));
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0];
          list.sort((a, b) => {
            if (a[field] < b[field]) return dir === "asc" ? -1 : 1;
            if (a[field] > b[field]) return dir === "asc" ? 1 : -1;
            return 0;
          });
        }
        return list[0] ? hydrate(tableName, list[0]) : null;
      },
      findUnique: async ({ where } = {}) => {
        const found = rows.find((r) => matches(r, where));
        return found ? hydrate(tableName, found) : null;
      },
      count: async ({ where } = {}) => rows.filter((r) => matches(r, where)).length,
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
      update: async ({ where, data }) => {
        const idx = rows.findIndex((r) => matches(r, where));
        if (idx === -1) throw new Error(`${tableName} not found for update`);
        const updated = { ...rows[idx], ...data, updatedAt: new Date() };
        rows[idx] = updated;
        return hydrate(tableName, updated);
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        rows.forEach((r, i) => {
          if (matches(r, where)) {
            rows[i] = { ...r, ...data, updatedAt: new Date() };
            count++;
          }
        });
        return { count };
      },
    };
  };

  const store = {};
  for (const table of Object.keys(tables)) {
    store[table] = makeApi(table);
  }
  store._tables = tables;
  return store;
};

describe("Fase 7: Pembayaran Midtrans Snap, Webhook, Tips, Kasir & Faktur PDF", () => {
  let mockStore;
  let customerUser;
  let customerOther;
  let mechanicUser;
  let adminUser;
  let testOutlet;
  let testVehicle;
  let readyBooking;

  // Helper untuk membuat tanda tangan Midtrans yang valid
  const computeMidtransSignature = (orderId, statusCode, grossAmount) => {
    return crypto
      .createHash("sha512")
      .update(`${orderId}${statusCode}${grossAmount}${env.MIDTRANS_SERVER_KEY}`)
      .digest("hex");
  };

  beforeEach(() => {
    mockStore = createPaymentsMockStore();
    storeRef.current = mockStore;

    // Seed master data awal
    customerUser = {
      id: 101,
      name: "Budi Santoso",
      email: "budi@example.com",
      phone: "+62812345678",
      role: "CUSTOMER",
    };
    customerOther = {
      id: 102,
      name: "Iwan Fals",
      email: "iwan@example.com",
      phone: "+62898765432",
      role: "CUSTOMER",
    };
    mechanicUser = {
      id: 201,
      name: "Joko Mekanik",
      email: "joko@tallero.id",
      phone: "+62855555555",
      role: "MECHANIC",
      outletId: 1,
    };
    adminUser = {
      id: 999,
      name: "Super Admin",
      email: "admin@tallero.id",
      role: "ADMIN",
      isActive: true,
      deletedAt: null,
    };

    testOutlet = {
      id: 1,
      name: "Tallero Sudirman",
      address: "Jl. Sudirman No. 1",
      phone: "+6221123456",
    };
    testVehicle = {
      id: 50,
      userId: 101,
      plateNumber: "B1234XYZ",
      brand: "Honda",
      model: "Civic",
      type: "CAR",
      year: 2021,
      lastOdometerKm: 15000,
    };

    mockStore._tables.user.push(customerUser, customerOther, mechanicUser, adminUser);
    mockStore._tables.outlet.push(testOutlet);
    mockStore._tables.vehicle.push(testVehicle);

    // Seed service dengan reminder interval
    mockStore._tables.service.push({
      id: 301,
      name: "Tune Up Mesin & Ganti Oli",
      price: 150000,
      reminderIntervalDays: 90,
      reminderIntervalKm: 5000,
      isActive: true,
    });

    // Booking berstatus READY_FOR_PICKUP dengan total Rp 150.000 (UNPAID)
    readyBooking = {
      id: 501,
      code: "TLR-20261113-TEST01",
      customerId: 101,
      outletId: 1,
      vehicleId: 50,
      mechanicId: 201,
      scheduledAt: new Date(),
      slotEndAt: new Date(),
      status: "READY_FOR_PICKUP",
      total: 150000,
      paymentStatus: "UNPAID",
      odometerKm: 15500,
      invoiceNumber: null,
      readyAt: new Date(),
    };
    mockStore._tables.booking.push(readyBooking);

    // Item booking APPROVED
    mockStore._tables.bookingItem.push({
      id: 801,
      bookingId: 501,
      type: "SERVICE",
      serviceId: 301,
      nameSnapshot: "Tune Up Mesin & Ganti Oli",
      unitPrice: 150000,
      quantity: 1,
      subtotal: 150000,
      source: "CUSTOMER_BOOKING",
      approvalStatus: "APPROVED",
      stockDeducted: false,
    });

    // Setup Mock Fetch global untuk Midtrans API
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, _opts) => {
        const urlStr = String(url);

        // A. Snap API (/transactions)
        if (urlStr.includes("/transactions")) {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              token: "mock-snap-token-xyz-123",
              redirect_url:
                "https://app.sandbox.midtrans.com/snap/v2/vtweb/mock-snap-token-xyz-123",
            }),
          };
        }

        // B. Core Status API (/status)
        if (urlStr.includes("/status")) {
          const parts = urlStr.split("/");
          const orderId = decodeURIComponent(parts[parts.length - 2]);
          const grossAmount = "150000.00";
          const statusCode = "200";
          const signatureKey = computeMidtransSignature(orderId, statusCode, grossAmount);

          return {
            ok: true,
            status: 200,
            json: async () => ({
              status_code: statusCode,
              status_message: "Success, transaction is found",
              transaction_id: `midtrans-tx-${orderId}`,
              order_id: orderId,
              gross_amount: grossAmount,
              payment_type: "qris",
              transaction_time: "2026-11-13 22:30:00",
              transaction_status: "settlement",
              fraud_status: "accept",
              signature_key: signatureKey,
            }),
          };
        }

        // C. Core Cancel API (/cancel)
        if (urlStr.includes("/cancel")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status_code: "200",
              status_message: "Success, transaction is canceled",
            }),
          };
        }

        return {
          ok: false,
          status: 404,
          json: async () => ({ message: "Not found" }),
        };
      })
    );
  });

  // ============================================================================
  // 1. SIGNATURE & WEBHOOK VALIDATION
  // ============================================================================
  it("signature salah → 401/403 tanpa efek apapun pada database", async () => {
    // Buat payment awal
    const payment = await mockStore.payment.create({
      data: {
        bookingId: readyBooking.id,
        type: "INVOICE",
        method: "MIDTRANS",
        orderId: `${readyBooking.code}-INV-1-1234`,
        amount: 150000,
        status: "PENDING",
      },
    });

    const fakePayload = {
      order_id: payment.orderId,
      status_code: "200",
      gross_amount: "150000.00",
      signature_key: "invalid-signature-hex-not-matching-sha512",
    };

    await expect(paymentsService.handleMidtransNotification(fakePayload)).rejects.toMatchObject({
      statusCode: 403,
      code: "INVALID_SIGNATURE",
    });

    // DB tetap PENDING dan booking tetap UNPAID
    const checkPayment = await mockStore.payment.findUnique({ where: { id: payment.id } });
    expect(checkPayment.status).toBe("PENDING");
    const checkBooking = await mockStore.booking.findUnique({ where: { id: readyBooking.id } });
    expect(checkBooking.paymentStatus).toBe("UNPAID");
  });

  // ============================================================================
  // 2. AMOUNT MISMATCH
  // ============================================================================
  it("amount tidak cocok → ditolak dengan 400 AMOUNT_MISMATCH", async () => {
    const payment = await mockStore.payment.create({
      data: {
        bookingId: readyBooking.id,
        type: "INVOICE",
        method: "MIDTRANS",
        orderId: `${readyBooking.code}-INV-2-5678`,
        amount: 150000, // DB mencatat 150.000
        status: "PENDING",
      },
    });

    // Mock fetch mengembalikan gross_amount berbeda (misal 100.000)
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          status_code: "200",
          transaction_status: "settlement",
          fraud_status: "accept",
          order_id: payment.orderId,
          gross_amount: "100000.00", // Tidak cocok dengan 150.000
          signature_key: computeMidtransSignature(payment.orderId, "200", "100000.00"),
        }),
      }))
    );

    const validSignatureFor100k = computeMidtransSignature(payment.orderId, "200", "100000.00");
    const payload = {
      order_id: payment.orderId,
      status_code: "200",
      gross_amount: "100000.00",
      signature_key: validSignatureFor100k,
    };

    await expect(paymentsService.handleMidtransNotification(payload)).rejects.toMatchObject({
      statusCode: 400,
      code: "AMOUNT_MISMATCH",
    });

    const checkPayment = await mockStore.payment.findUnique({ where: { id: payment.id } });
    expect(checkPayment.status).toBe("PENDING");
  });

  // ============================================================================
  // 3. IDEMPOTENCY
  // ============================================================================
  it("webhook dikirim 2x → efek sekali (idempotent, return status tanpa error)", async () => {
    const payment = await mockStore.payment.create({
      data: {
        bookingId: readyBooking.id,
        type: "INVOICE",
        method: "MIDTRANS",
        orderId: `${readyBooking.code}-INV-3-9999`,
        amount: 150000,
        status: "PENDING",
      },
    });

    const grossAmount = "150000.00";
    const sig = computeMidtransSignature(payment.orderId, "200", grossAmount);
    const payload = {
      order_id: payment.orderId,
      status_code: "200",
      gross_amount: grossAmount,
      signature_key: sig,
    };

    // Panggilan 1: Berhasil menjadi PAID
    const res1 = await paymentsService.handleMidtransNotification(payload);
    expect(res1.status).toBe("PAID");
    expect(res1.duplicate).toBe(false);

    const postBooking1 = await mockStore.booking.findUnique({ where: { id: readyBooking.id } });
    expect(postBooking1.paymentStatus).toBe("PAID");
    expect(postBooking1.invoiceNumber).toMatch(/^INV-\d{6}-\d{6}$/);

    const notifCount1 = mockStore._tables.notification.length;

    // Panggilan 2: Notifikasi yang sama dikirim ulang oleh Midtrans
    const res2 = await paymentsService.handleMidtransNotification(payload);
    expect(res2.success).toBe(true);
    expect(res2.status).toBe("PAID");

    // Tidak ada notifikasi ganda yang dibuat
    const notifCount2 = mockStore._tables.notification.length;
    expect(notifCount2).toBe(notifCount1);
  });

  // ============================================================================
  // 4. REVERSED SEQUENCE PROTECTION
  // ============================================================================
  it("urutan terbalik (settlement sebelum pending) tidak menurunkan status PAID kembali ke PENDING", async () => {
    const payment = await mockStore.payment.create({
      data: {
        bookingId: readyBooking.id,
        type: "INVOICE",
        method: "MIDTRANS",
        orderId: `${readyBooking.code}-INV-4-1111`,
        amount: 150000,
        status: "PAID", // Sudah berstatus PAID
        paidAt: new Date(),
      },
    });

    // Mock Status API mengembalikan pending yang terlambat
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          status_code: "201",
          transaction_status: "pending",
          order_id: payment.orderId,
          gross_amount: "150000.00",
          signature_key: computeMidtransSignature(payment.orderId, "201", "150000.00"),
        }),
      }))
    );

    const sig = computeMidtransSignature(payment.orderId, "201", "150000.00");
    const payload = {
      order_id: payment.orderId,
      status_code: "201",
      gross_amount: "150000.00",
      signature_key: sig,
    };

    const res = await paymentsService.handleMidtransNotification(payload);
    expect(res.status).toBe("PAID"); // Tidak turun ke PENDING

    const checkPayment = await mockStore.payment.findUnique({ where: { id: payment.id } });
    expect(checkPayment.status).toBe("PAID");
  });

  // ============================================================================
  // 5. IDOR & SCOPE SECURITY
  // ============================================================================
  it("customer lain tak bisa membuat, melihat, atau menyinkronkan payment (404)", async () => {
    // 1. Customer B mencoba inisiasi Snap untuk booking Customer A
    await expect(
      paymentsService.createMidtransInvoicePayment({
        actor: customerOther,
        bookingId: readyBooking.id,
      })
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "BOOKING_NOT_FOUND",
    });

    // 2. Customer B mencoba melihat list pembayaran booking Customer A
    await expect(
      paymentsService.listBookingPayments({
        actor: customerOther,
        bookingId: readyBooking.id,
      })
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "BOOKING_NOT_FOUND",
    });

    // 3. Customer B mencoba sync payment milik Customer A
    const payment = await mockStore.payment.create({
      data: {
        bookingId: readyBooking.id,
        type: "INVOICE",
        method: "MIDTRANS",
        orderId: `${readyBooking.code}-INV-5-5555`,
        amount: 150000,
        status: "PENDING",
      },
    });

    await expect(
      paymentsService.syncPaymentStatus({
        actor: customerOther,
        orderId: payment.orderId,
      })
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "PAYMENT_NOT_FOUND",
    });
  });

  // ============================================================================
  // 6. TIP MECHANIC GUARDS
  // ============================================================================
  it("tip di luar batas (< 1000 atau > 500.000) atau booking tanpa mekanik ditolak", async () => {
    // A. Nominal di bawah batas minimal (Rp 500 < Rp 1.000)
    await expect(
      paymentsService.createTipPayment({
        actor: customerUser,
        bookingId: readyBooking.id,
        amount: 500,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_TIP_AMOUNT",
    });

    // B. Nominal di atas batas maksimal (Rp 600.000 > Rp 500.000)
    await expect(
      paymentsService.createTipPayment({
        actor: customerUser,
        bookingId: readyBooking.id,
        amount: 600000,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_TIP_AMOUNT",
    });

    // C. Booking tanpa mekanik
    const bookingNoMechanic = await mockStore.booking.create({
      data: {
        code: "TLR-20261113-NOMECH",
        customerId: 101,
        outletId: 1,
        vehicleId: 50,
        mechanicId: null, // Tanpa mekanik
        status: "READY_FOR_PICKUP",
        total: 100000,
      },
    });

    await expect(
      paymentsService.createTipPayment({
        actor: customerUser,
        bookingId: bookingNoMechanic.id,
        amount: 25000,
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "MECHANIC_NOT_ASSIGNED",
    });

    // D. Valid tip: Sukses mengembalikan Snap token & merekam type TIP dengan recipientMechanicId
    const validTipRes = await paymentsService.createTipPayment({
      actor: customerUser,
      bookingId: readyBooking.id,
      amount: 50000,
    });

    expect(validTipRes.snapToken).toBe("mock-snap-token-xyz-123");
    expect(validTipRes.amount).toBe(50000);

    const savedTip = await mockStore.payment.findUnique({
      where: { orderId: validTipRes.orderId },
    });
    expect(savedTip.type).toBe("TIP");
    expect(savedTip.recipientMechanicId).toBe(201);
  });

  // ============================================================================
  // 7. DUPLICATE PAYMENT SETTLEMENT
  // ============================================================================
  it("dua percobaan lalu keduanya settle → percobaan pertama PAID, percobaan kedua DUPLICATE + AuditLog + Admin Alert", async () => {
    // Percobaan 1
    const payment1 = await mockStore.payment.create({
      data: {
        bookingId: readyBooking.id,
        type: "INVOICE",
        method: "MIDTRANS",
        orderId: `${readyBooking.code}-INV-7-ATTEMPT1`,
        amount: 150000,
        status: "PENDING",
      },
    });

    // Percobaan 2
    const payment2 = await mockStore.payment.create({
      data: {
        bookingId: readyBooking.id,
        type: "INVOICE",
        method: "MIDTRANS",
        orderId: `${readyBooking.code}-INV-7-ATTEMPT2`,
        amount: 150000,
        status: "PENDING",
      },
    });

    const sig1 = computeMidtransSignature(payment1.orderId, "200", "150000.00");
    const sig2 = computeMidtransSignature(payment2.orderId, "200", "150000.00");

    // Settle pembayaran 1
    const res1 = await paymentsService.handleMidtransNotification({
      order_id: payment1.orderId,
      status_code: "200",
      gross_amount: "150000.00",
      signature_key: sig1,
    });
    expect(res1.status).toBe("PAID");
    expect(res1.duplicate).toBe(false);

    const checkPayment1 = await mockStore.payment.findUnique({ where: { id: payment1.id } });
    expect(checkPayment1.status).toBe("PAID");

    const checkBooking = await mockStore.booking.findUnique({ where: { id: readyBooking.id } });
    expect(checkBooking.paymentStatus).toBe("PAID");

    // Settle pembayaran 2 (Keduanya dibayar oleh user karena jendela Snap ganda)
    const res2 = await paymentsService.handleMidtransNotification({
      order_id: payment2.orderId,
      status_code: "200",
      gross_amount: "150000.00",
      signature_key: sig2,
    });

    expect(res2.status).toBe("DUPLICATE");
    expect(res2.duplicate).toBe(true);

    const checkPayment2 = await mockStore.payment.findUnique({ where: { id: payment2.id } });
    expect(checkPayment2.status).toBe("DUPLICATE");

    // Verifikasi AuditLog pencatatan duplikasi
    const audit = mockStore._tables.auditLog.find(
      (a) => a.action === "DUPLICATE_PAYMENT_DETECTED" && a.entityId === String(payment2.id)
    );
    expect(audit).toBeDefined();

    // Verifikasi Notifikasi darurat ke Admin
    const adminNotif = mockStore._tables.notification.find(
      (n) => n.userId === 999 && n.title.includes("Duplikat Pembayaran")
    );
    expect(adminNotif).toBeDefined();
    expect(adminNotif.body).toContain(payment2.orderId);
  });

  // ============================================================================
  // 8 & 9. INVOICE PDF SECURITY GUARDS
  // ============================================================================
  it("invoice PDF customer lain → 404, dan invoice sebelum bayar → 409 BOOKING_NOT_PAID", async () => {
    const mockRes = new PassThrough();
    mockRes.setHeader = vi.fn();

    // A. Customer lain mencoba download PDF
    await expect(
      paymentsService.generateInvoicePdf({
        actor: customerOther,
        bookingId: readyBooking.id,
        res: mockRes,
      })
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "BOOKING_NOT_FOUND",
    });

    // B. Customer pemilik mencoba download saat status UNPAID
    await expect(
      paymentsService.generateInvoicePdf({
        actor: customerUser,
        bookingId: readyBooking.id,
        res: mockRes,
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "BOOKING_NOT_PAID",
    });

    // C. Setelah lunas (PAID), unduh PDF berhasil
    await mockStore.booking.update({
      where: { id: readyBooking.id },
      data: {
        paymentStatus: "PAID",
        invoiceNumber: "INV-202611-000001",
      },
    });

    await paymentsService.generateInvoicePdf({
      actor: customerUser,
      bookingId: readyBooking.id,
      res: mockRes,
    });

    expect(mockRes.setHeader).toHaveBeenCalledWith("Content-Type", "application/pdf");
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'inline; filename="invoice-INV-202611-000001.pdf"'
    );
  });

  // ============================================================================
  // 10. CASHIER PAYMENT FLOW
  // ============================================================================
  it("pembayaran tunai kasir: admin mencatat, booking PAID, nomor invoice dibuat, audit log tercatat", async () => {
    // Siapkan percobaan Midtrans pending sebelumnya
    const priorPending = await mockStore.payment.create({
      data: {
        bookingId: readyBooking.id,
        type: "INVOICE",
        method: "MIDTRANS",
        orderId: `${readyBooking.code}-INV-10-PENDING`,
        amount: 150000,
        status: "PENDING",
      },
    });

    const cashResult = await paymentsService.payCash({
      actor: adminUser,
      bookingId: readyBooking.id,
      ip: "127.0.0.1",
    });

    expect(cashResult.payment.method).toBe("CASH");
    expect(cashResult.payment.status).toBe("PAID");
    expect(cashResult.booking.paymentStatus).toBe("PAID");
    expect(cashResult.invoiceNumber).toMatch(/^INV-\d{6}-\d{6}$/);

    // Percobaan Midtrans pending sebelumnya otomatis dibatalkan
    const checkPrior = await mockStore.payment.findUnique({ where: { id: priorPending.id } });
    expect(checkPrior.status).toBe("CANCELLED");

    // Audit log tercatat
    const audit = mockStore._tables.auditLog.find(
      (a) => a.action === "PAYMENT_CASH_RECEIVED" && a.entityId === String(readyBooking.id)
    );
    expect(audit).toBeDefined();
    expect(audit.actorId).toBe(999);
  });

  // ============================================================================
  // 11. COMPLETE BOOKING GUARD & SERVICE REMINDER GENERATION
  // ============================================================================
  it("complete booking menegakkan guard invoice PAID (409 bila UNPAID) dan membangkitkan ServiceReminder", async () => {
    // A. Belum lunas (UNPAID) → Gagal 409 BOOKING_NOT_PAID
    await expect(
      bookingsService.completeBooking({
        actor: adminUser,
        bookingId: readyBooking.id,
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "BOOKING_NOT_PAID",
    });

    // B. Setelah dilunasi kasir / Midtrans
    await mockStore.booking.update({
      where: { id: readyBooking.id },
      data: {
        paymentStatus: "PAID",
        invoiceNumber: "INV-202611-000002",
      },
    });

    const completed = await bookingsService.completeBooking({
      actor: adminUser,
      bookingId: readyBooking.id,
      note: "Mobil diambil oleh pemilik",
    });

    expect(completed.status).toBe("COMPLETED");

    // C. ServiceReminder otomatis dibangkitkan untuk item Tune Up (reminderIntervalDays = 90)
    const reminders = mockStore._tables.serviceReminder.filter(
      (r) => r.sourceBookingId === readyBooking.id
    );
    expect(reminders.length).toBe(1);
    expect(reminders[0].serviceId).toBe(301);
    expect(reminders[0].dueOdometerKm).toBe(15500 + 5000); // 20.500 KM
    expect(reminders[0].status).toBe("SCHEDULED");
  });

  // ============================================================================
  // 12. BACKGROUND CRON PAYMENT SYNC
  // ============================================================================
  it("cron paymentSync: memproses sinkronisasi pembayaran pending aktif", async () => {
    const pendingPayment = await mockStore.payment.create({
      data: {
        bookingId: readyBooking.id,
        type: "INVOICE",
        method: "MIDTRANS",
        orderId: `${readyBooking.code}-INV-CRON-SYNC`,
        amount: 150000,
        status: "PENDING",
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // Belum expired
      },
    });

    const cronResult = await runPaymentSync();
    expect(cronResult.processed).toBeGreaterThanOrEqual(1);
    expect(cronResult.updated).toBe(1);

    const checkPayment = await mockStore.payment.findUnique({ where: { id: pendingPayment.id } });
    expect(checkPayment.status).toBe("PAID");
  });
});
