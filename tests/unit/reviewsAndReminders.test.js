// ==============================================================================
// TALLERO AUTO — REVIEWS, REMINDERS, NOTIFICATIONS & ASSISTANT UNIT TESTS
// Menguji Ulasan, Pengingat Servis, Notifikasi Terpusat, Push, dan Menu Assistant
// Sesuai aturan bisnis AGENTS.md §4, §6, §8
// ==============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as reviewsService from "../../src/services/reviews.service.js";
import * as remindersService from "../../src/services/reminders.service.js";
import * as notificationsService from "../../src/services/notifications.service.js";
import * as assistantService from "../../src/services/assistant.service.js";
import * as bookingsService from "../../src/services/bookings.service.js";
import * as pushService from "../../src/services/push.service.js";

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

// Mock Socket.IO
vi.mock("../../src/config/socket.js", () => ({
  emitRealtimeEvent: vi.fn(),
  getIO: vi.fn(() => ({ to: () => ({ emit: vi.fn() }) })),
}));

// Mock Mail Service
vi.mock("../../src/services/mail.service.js", () => ({
  sendMail: vi.fn(async () => ({ messageId: "mock-mail-id" })),
  buildReadyForPickupEmail: vi.fn(() => ({ subject: "Siap", html: "<p>Siap</p>", text: "Siap" })),
}));

// Mock expo-server-sdk
const mockSendPushNotificationsAsync = vi.fn(async (chunks) => {
  return chunks.map((msg) => {
    if (msg.to.includes("invalid-device-token")) {
      return {
        status: "error",
        message: "DeviceNotRegistered",
        details: { error: "DeviceNotRegistered" },
      };
    }
    return { status: "ok", id: "ticket-123" };
  });
});

vi.mock("expo-server-sdk", () => {
  class MockExpo {
    static isExpoPushToken(token) {
      return typeof token === "string" && token.startsWith("ExponentPushToken[");
    }
    chunkPushNotifications(messages) {
      return [messages];
    }
    async sendPushNotificationsAsync(chunk) {
      return mockSendPushNotificationsAsync(chunk);
    }
  }
  return {
    Expo: MockExpo,
  };
});

/**
 * In-memory Mock Store
 */
const createPhase8MockStore = () => {
  let seq = 7000;
  const tables = {
    user: [],
    outlet: [],
    outletClosure: [],
    vehicle: [],
    service: [],
    category: [],
    sparepart: [],
    booking: [],
    bookingItem: [],
    bookingPhoto: [],
    bookingLog: [],
    payment: [],
    review: [],
    notification: [],
    auditLog: [],
    serviceReminder: [],
    deviceToken: [],
  };

  const matches = (row, where = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (k === "OR" && Array.isArray(v)) return v.some((sub) => matches(row, sub));
      if (v && typeof v === "object" && !(v instanceof Date)) {
        if ("in" in v && !v.in.includes(row[k])) return false;
        if ("notIn" in v && v.notIn.includes(row[k])) return false;
        if ("not" in v && row[k] === v.not) return false;
        if ("gte" in v) {
          const val = row[k] instanceof Date ? row[k].getTime() : row[k];
          const target = v.gte instanceof Date ? v.gte.getTime() : v.gte;
          if (val < target) return false;
        }
        if ("gt" in v) {
          const val = row[k] instanceof Date ? row[k].getTime() : row[k];
          const target = v.gt instanceof Date ? v.gt.getTime() : v.gt;
          if (val <= target) return false;
        }
        if ("lte" in v) {
          const val = row[k] instanceof Date ? row[k].getTime() : row[k];
          const target = v.lte instanceof Date ? v.lte.getTime() : v.lte;
          if (val > target) return false;
        }
        if ("lt" in v) {
          const val = row[k] instanceof Date ? row[k].getTime() : row[k];
          const target = v.lt instanceof Date ? v.lt.getTime() : v.lt;
          if (val >= target) return false;
        }
        if ("startsWith" in v && !String(row[k] || "").startsWith(v.startsWith)) return false;
        return true;
      }
      if (v === null) {
        return row[k] === null || row[k] === undefined;
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
      clone.review = tables.review.find((r) => r.bookingId === row.id) || null;
      clone.items = tables.bookingItem
        .filter((i) => i.bookingId === row.id)
        .map((i) => ({
          ...i,
          service: tables.service.find((s) => s.id === i.serviceId) || null,
        }));
    }
    if (tableName === "review") {
      clone.customer = tables.user.find((u) => u.id === row.customerId) || null;
      clone.mechanic = tables.user.find((u) => u.id === row.mechanicId) || null;
      clone.outlet = tables.outlet.find((o) => o.id === row.outletId) || null;
    }
    if (tableName === "serviceReminder") {
      clone.service = tables.service.find((s) => s.id === row.serviceId) || null;
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
        if (skip) list = list.slice(skip);
        if (take) list = list.slice(0, take);
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
      deleteMany: async ({ where } = {}) => {
        const before = rows.length;
        const remaining = rows.filter((r) => !matches(r, where));
        tables[tableName] = remaining;
        return { count: before - remaining.length };
      },
      upsert: async ({ where, create, update }) => {
        const existing = rows.find((r) => matches(r, where));
        if (existing) {
          Object.assign(existing, update, { updatedAt: new Date() });
          return hydrate(tableName, existing);
        }
        const item = { id: ++seq, ...create, createdAt: new Date(), updatedAt: new Date() };
        rows.push(item);
        return hydrate(tableName, item);
      },
      aggregate: async ({ where, _avg } = {}) => {
        const list = rows.filter((r) => matches(r, where));
        if (_avg?.rating) {
          if (list.length === 0) return { _avg: { rating: null } };
          const sum = list.reduce((acc, it) => acc + (it.rating || 0), 0);
          return { _avg: { rating: sum / list.length } };
        }
        return { _avg: {} };
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

describe("Fase 8: Review, Riwayat, Reminder Servis, Notifikasi, Push, Assistant, Cron", () => {
  let mockStore;
  let customerA;
  let customerB;
  let mechanic;
  let admin;
  let outlet;
  let vehicle;
  let serviceTuneUp;

  beforeEach(() => {
    mockStore = createPhase8MockStore();
    storeRef.current = mockStore;

    customerA = {
      id: 10,
      name: "Ahmad Dani",
      email: "ahmad@example.com",
      phone: "+6281111111",
      role: "CUSTOMER",
      isActive: true,
      deletedAt: null,
    };
    customerB = {
      id: 20,
      name: "Bambang Pamungkas",
      email: "bambang@example.com",
      phone: "+6282222222",
      role: "CUSTOMER",
      isActive: true,
      deletedAt: null,
    };
    mechanic = {
      id: 30,
      name: "Teguh Pratama",
      email: "teguh@tallero.id",
      role: "MECHANIC",
      outletId: 1,
      isActive: true,
      deletedAt: null,
    };
    admin = {
      id: 99,
      name: "Admin Utama",
      email: "admin@tallero.id",
      role: "ADMIN",
      isActive: true,
      deletedAt: null,
    };

    outlet = {
      id: 1,
      name: "Tallero Auto Kebayoran",
      address: "Jl. Kyai Maja No. 10",
      phone: "+6221777888",
      openDays: [1, 2, 3, 4, 5, 6], // Senin - Sabtu
      openTime: "08:00",
      closeTime: "17:00",
      slotMinutes: 60,
      slotCapacity: 2,
      timezone: "Asia/Jakarta",
      isActive: true,
      deletedAt: null,
    };

    vehicle = {
      id: 100,
      userId: 10,
      plateNumber: "B1000XYZ",
      brand: "Toyota",
      model: "Avanza",
      type: "CAR",
      year: 2020,
      lastOdometerKm: 20000,
      deletedAt: null,
    };

    serviceTuneUp = {
      id: 50,
      categoryId: 1,
      name: "Tune Up & Servis Berkala",
      price: 250000,
      estimatedMinutes: 60,
      vehicleType: "CAR",
      reminderIntervalDays: 90,
      reminderIntervalKm: 5000,
      isActive: true,
      deletedAt: null,
    };

    mockStore._tables.user.push(customerA, customerB, mechanic, admin);
    mockStore._tables.outlet.push(outlet);
    mockStore._tables.vehicle.push(vehicle);
    mockStore._tables.service.push(serviceTuneUp);
  });

  // ============================================================================
  // 1. REVIEWS TESTS
  // ============================================================================
  describe("Review Modul", () => {
    it("review sebelum COMPLETED / booking orang lain / ulasan ganda / di luar jendela ditolak", async () => {
      // A. Booking belum COMPLETED (masih READY_FOR_PICKUP)
      const uncompletedBooking = await mockStore.booking.create({
        data: {
          code: "TLR-20261113-UNCOMP",
          customerId: 10,
          outletId: 1,
          vehicleId: 100,
          status: "READY_FOR_PICKUP",
          total: 250000,
        },
      });

      await expect(
        reviewsService.createBookingReview({
          actor: customerA,
          bookingId: uncompletedBooking.id,
          rating: 5,
          comment: "Puas sekali!",
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "INVALID_BOOKING_STATUS",
      });

      // Update booking menjadi COMPLETED
      const completedBooking = await mockStore.booking.create({
        data: {
          code: "TLR-20261113-COMPL",
          customerId: 10,
          outletId: 1,
          vehicleId: 100,
          mechanicId: 30,
          status: "COMPLETED",
          completedAt: new Date(),
          total: 250000,
        },
      });

      // B. Booking milik customer lain (Customer B mencoba ulas booking Customer A)
      await expect(
        reviewsService.createBookingReview({
          actor: customerB,
          bookingId: completedBooking.id,
          rating: 4,
          comment: "Bagus",
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "BOOKING_NOT_FOUND",
      });

      // C. Booking di luar jendela waktu (lebih dari 30 hari)
      const oldCompletedBooking = await mockStore.booking.create({
        data: {
          code: "TLR-20260901-EXPIRED",
          customerId: 10,
          outletId: 1,
          vehicleId: 100,
          status: "COMPLETED",
          completedAt: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // 35 hari lalu
          total: 250000,
        },
      });

      await expect(
        reviewsService.createBookingReview({
          actor: customerA,
          bookingId: oldCompletedBooking.id,
          rating: 5,
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "REVIEW_WINDOW_EXPIRED",
      });

      // D. Ulasan valid pertama berhasil
      const review1 = await reviewsService.createBookingReview({
        actor: customerA,
        bookingId: completedBooking.id,
        rating: 5,
        comment: "Pelayanan sangat memuaskan, mekanik ramah!",
      });

      expect(review1.rating).toBe(5);
      expect(review1.customer.name).toBe("Ahmad"); // Anonim nama depan

      // E. Percobaan ulasan ganda pada booking yang sama ditolak (409)
      await expect(
        reviewsService.createBookingReview({
          actor: customerA,
          bookingId: completedBooking.id,
          rating: 4,
          comment: "Ulasan kedua",
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "REVIEW_ALREADY_EXISTS",
      });
    });

    it("list ulasan publik outlet menghitung rata-rata & menyaring ulasan yang disembunyikan", async () => {
      // Buat ulasan 1 (rating 5, terlihat)
      await mockStore.review.create({
        data: {
          bookingId: 1001,
          customerId: 10,
          outletId: 1,
          mechanicId: 30,
          rating: 5,
          comment: "Hebat",
          isHidden: false,
        },
      });

      // Buat ulasan 2 (rating 3, terlihat)
      await mockStore.review.create({
        data: {
          bookingId: 1002,
          customerId: 20,
          outletId: 1,
          mechanicId: 30,
          rating: 3,
          comment: "Cukup",
          isHidden: false,
        },
      });

      // Buat ulasan 3 (rating 1, disembunyikan admin)
      const hiddenReview = await mockStore.review.create({
        data: {
          bookingId: 1003,
          customerId: 10,
          outletId: 1,
          mechanicId: 30,
          rating: 1,
          comment: "Spam komentar kotor",
          isHidden: true,
        },
      });

      const outletReviews = await reviewsService.listOutletReviews({
        outletId: 1,
        query: { page: 1, limit: 10 },
      });

      // Hanya 2 ulasan yang tampil
      expect(outletReviews.data.length).toBe(2);
      expect(outletReviews.meta.totalReviews).toBe(2);
      expect(outletReviews.meta.averageRating).toBe(4); // (5 + 3) / 2 = 4.0

      // Admin menampilkan kembali ulasan 3
      const updated = await reviewsService.updateReviewVisibility({
        actor: admin,
        reviewId: hiddenReview.id,
        isHidden: false,
      });
      expect(updated.isHidden).toBe(false);
    });
  });

  // ============================================================================
  // 2 & 3. SERVICE REMINDERS & CRON TESTS
  // ============================================================================
  describe("Pengingat Servis (Service Reminders & Cron)", () => {
    it("reminder dibuat saat COMPLETED, reminder lama otomatis DONE, dan tidak terbuat ganda", async () => {
      // 1. Buat booking pertama dan selesaikan
      const booking1 = await mockStore.booking.create({
        data: {
          code: "TLR-20261113-REM01",
          customerId: 10,
          outletId: 1,
          vehicleId: 100,
          status: "READY_FOR_PICKUP",
          paymentStatus: "PAID",
          total: 250000,
          odometerKm: 20000,
        },
      });
      await mockStore.bookingItem.create({
        data: {
          bookingId: booking1.id,
          type: "SERVICE",
          serviceId: 50,
          nameSnapshot: "Tune Up & Servis Berkala",
          unitPrice: 250000,
          quantity: 1,
          subtotal: 250000,
          source: "CUSTOMER_BOOKING",
          approvalStatus: "APPROVED",
        },
      });

      await bookingsService.completeBooking({
        actor: admin,
        bookingId: booking1.id,
      });

      const reminders1 = mockStore._tables.serviceReminder.filter(
        (r) => r.vehicleId === 100 && r.serviceId === 50
      );
      expect(reminders1.length).toBe(1);
      expect(reminders1[0].status).toBe("SCHEDULED");
      expect(reminders1[0].dueOdometerKm).toBe(25000); // 20.000 + 5.000

      // 2. Servis berikutnya pada KM 25.000
      const booking2 = await mockStore.booking.create({
        data: {
          code: "TLR-20261113-REM02",
          customerId: 10,
          outletId: 1,
          vehicleId: 100,
          status: "READY_FOR_PICKUP",
          paymentStatus: "PAID",
          total: 250000,
          odometerKm: 25000,
        },
      });
      await mockStore.bookingItem.create({
        data: {
          bookingId: booking2.id,
          type: "SERVICE",
          serviceId: 50,
          nameSnapshot: "Tune Up & Servis Berkala",
          unitPrice: 250000,
          quantity: 1,
          subtotal: 250000,
          source: "CUSTOMER_BOOKING",
          approvalStatus: "APPROVED",
        },
      });

      await bookingsService.completeBooking({
        actor: admin,
        bookingId: booking2.id,
      });

      // Reminder 1 menjadi DONE
      const oldReminder = mockStore._tables.serviceReminder.find((r) => r.id === reminders1[0].id);
      expect(oldReminder.status).toBe("DONE");

      // Reminder baru berstatus SCHEDULED untuk KM 30.000
      const activeReminders = mockStore._tables.serviceReminder.filter(
        (r) => r.vehicleId === 100 && r.status === "SCHEDULED"
      );
      expect(activeReminders.length).toBe(1);
      expect(activeReminders[0].dueOdometerKm).toBe(30000);
    });

    it("cron reminder harian dijalankan 2x bersifat idempotent (tidak mengirim notifikasi ganda)", async () => {
      const now = new Date();
      // Buat reminder yang jatuh tempo dalam 3 hari (H-3 <= H-7, harus masuk REMINDED)
      const leadReminder = await mockStore.serviceReminder.create({
        data: {
          vehicleId: 100,
          userId: 10,
          serviceId: 50,
          sourceBookingId: 1,
          dueDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
          status: "SCHEDULED",
        },
      });

      // Eksekusi Cron Pertama
      const cronRun1 = await remindersService.runServiceRemindersCron();
      expect(cronRun1.remindedCount).toBe(1);

      const checkReminder1 = await mockStore.serviceReminder.findUnique({
        where: { id: leadReminder.id },
      });
      expect(checkReminder1.status).toBe("REMINDED");
      expect(checkReminder1.remindedAt).toBeDefined();

      const notifCount1 = mockStore._tables.notification.filter(
        (n) => n.type === "SERVICE_REMINDER"
      ).length;
      expect(notifCount1).toBe(1);

      // Eksekusi Cron Kedua pada hari yang sama (Idempotency)
      const cronRun2 = await remindersService.runServiceRemindersCron();
      expect(cronRun2.remindedCount).toBe(0);
      expect(cronRun2.dueCount).toBe(0);

      const notifCount2 = mockStore._tables.notification.filter(
        (n) => n.type === "SERVICE_REMINDER"
      ).length;
      expect(notifCount2).toBe(1); // Tetap 1, tidak ada spam notifikasi
    });

    it("evaluasi odometer: saat km mencapai batas target, reminder otomatis berpindah ke DUE", async () => {
      const odometerReminder = await mockStore.serviceReminder.create({
        data: {
          vehicleId: 100,
          userId: 10,
          serviceId: 50,
          sourceBookingId: 1,
          dueDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // Masih 60 hari lagi
          dueOdometerKm: 25000,
          status: "SCHEDULED",
        },
      });

      // Odometer di bawah batas target (24.000 < 25.000) -> Belum DUE
      const countBelow = await remindersService.evaluateOdometerReminders({
        vehicleId: 100,
        newOdometerKm: 24000,
      });
      expect(countBelow).toBe(0);

      // Odometer mencapai batas target (25.100 >= 25.000) -> Berpindah ke DUE
      const countReached = await remindersService.evaluateOdometerReminders({
        vehicleId: 100,
        newOdometerKm: 25100,
      });
      expect(countReached).toBe(1);

      const checkReminder = await mockStore.serviceReminder.findUnique({
        where: { id: odometerReminder.id },
      });
      expect(checkReminder.status).toBe("DUE");
      expect(checkReminder.dueNotifiedAt).toBeDefined();
    });
  });

  // ============================================================================
  // 4. NOTIFIKASI & EXPO PUSH TOKEN TESTS
  // ============================================================================
  describe("Notifikasi & Expo Push", () => {
    it("customer tak bisa membaca notifikasi user lain (404 IDOR)", async () => {
      const notifA = await mockStore.notification.create({
        data: {
          userId: 10,
          type: "BOOKING_STATUS",
          title: "Status Update",
          body: "Mobil Anda siap diambil",
        },
      });

      // Customer B mencoba menandai notifikasi Customer A
      await expect(
        notificationsService.markAsRead({
          actor: customerB,
          notificationId: notifA.id,
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "NOTIFICATION_NOT_FOUND",
      });

      // Customer A menandai notifikasi miliknya sendiri -> Sukses
      const readResult = await notificationsService.markAsRead({
        actor: customerA,
        notificationId: notifA.id,
      });
      expect(readResult.readAt).toBeDefined();
    });

    it("registrasi token Expo valid berhasil dan membersihkan token DeviceNotRegistered otomatis", async () => {
      // 1. Registrasi token Expo valid
      const validToken = "ExponentPushToken[xxxxxxxxxxxx-valid-token]";
      const reg = await notificationsService.registerDeviceToken({
        actor: customerA,
        expoPushToken: validToken,
        platform: "android",
      });
      expect(reg.expoPushToken).toBe(validToken);

      // 2. Registrasi token kadaluwarsa (DeviceNotRegistered)
      const staleToken = "ExponentPushToken[invalid-device-token-123]";
      await notificationsService.registerDeviceToken({
        actor: customerA,
        expoPushToken: staleToken,
        platform: "ios",
      });

      expect(mockStore._tables.deviceToken.length).toBe(2);

      // 3. Kirim notifikasi push yang memicu error DeviceNotRegistered
      await pushService.sendExpoPush({
        tokens: [staleToken],
        title: "Test Alert",
        body: "Test Body",
      });

      // Token kadaluwarsa otomatis dibersihkan dari DB
      const remainingTokens = mockStore._tables.deviceToken.map((d) => d.expoPushToken);
      expect(remainingTokens).not.toContain(staleToken);
      expect(remainingTokens).toContain(validToken);
    });
  });

  // ============================================================================
  // 5. ASSISTANT TESTS
  // ============================================================================
  describe("Assistant Deterministik Tanpa AI", () => {
    it("intent CHECK_SLOT konsisten dengan endpoint availability", async () => {
      const today = new Date().toISOString().slice(0, 10);

      // Panggil via assistant
      const assistantRes = await assistantService.queryAssistant({
        actor: customerA,
        intent: "CHECK_SLOT",
        queryData: {
          params: {
            outletId: 1,
            date: today,
            serviceIds: [50],
          },
        },
      });

      // Panggil langsung via service availability
      const directAvailability = await bookingsService.getOutletAvailability({
        outletId: 1,
        date: today,
        serviceIds: [50],
      });

      expect(assistantRes.type).toBe("SLOT_AVAILABILITY");
      expect(assistantRes.data.totalSlots).toBe(directAvailability.slots.length);
      expect(assistantRes.data.slots[0].time).toBe(directAvailability.slots[0].time);
    });

    it("intent OUTLET_OPEN_STATUS, MY_BOOKING_STATUS, SERVICE_PRICE_LIST, dan MY_NEXT_SERVICE mengembalikan format terstruktur", async () => {
      // A. OUTLET_OPEN_STATUS
      const outletRes = await assistantService.queryAssistant({
        actor: customerA,
        intent: "OUTLET_OPEN_STATUS",
        queryData: { params: { outletId: 1 } },
      });
      expect(outletRes.type).toBe("OUTLET_STATUS");
      expect(outletRes.data.outlet.name).toBe("Tallero Auto Kebayoran");

      // B. MY_BOOKING_STATUS (Saat tidak ada booking)
      const noBookingRes = await assistantService.queryAssistant({
        actor: customerA,
        intent: "MY_BOOKING_STATUS",
        queryData: {},
      });
      expect(noBookingRes.type).toBe("NO_ACTIVE_BOOKING");

      // C. SERVICE_PRICE_LIST
      const priceRes = await assistantService.queryAssistant({
        actor: customerA,
        intent: "SERVICE_PRICE_LIST",
        queryData: { params: { vehicleType: "CAR" } },
      });
      expect(priceRes.type).toBe("PRICE_LIST");
      expect(priceRes.data.services.length).toBeGreaterThanOrEqual(1);
      expect(priceRes.data.services[0].name).toBe("Tune Up & Servis Berkala");

      // D. MY_NEXT_SERVICE
      await mockStore.serviceReminder.create({
        data: {
          vehicleId: 100,
          userId: 10,
          serviceId: 50,
          sourceBookingId: 1,
          dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
          status: "SCHEDULED",
        },
      });

      const nextServiceRes = await assistantService.queryAssistant({
        actor: customerA,
        intent: "MY_NEXT_SERVICE",
        queryData: {},
      });
      expect(nextServiceRes.type).toBe("NEXT_SERVICE");
      expect(nextServiceRes.data.length).toBe(1);
      expect(nextServiceRes.data[0].serviceName).toBe("Tune Up & Servis Berkala");
    });
  });
});
