import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, storeRef } = vi.hoisted(() => {
  const ref = { current: null };
  const models = [
    "user",
    "outlet",
    "outletClosure",
    "category",
    "service",
    "sparepart",
    "vehicle",
    "booking",
    "bookingItem",
    "bookingLog",
    "serviceReminder",
    "auditLog",
  ];
  const methods = [
    "findMany",
    "findFirst",
    "findUnique",
    "count",
    "create",
    "update",
    "updateMany",
    "delete",
  ];

  // Mutex per outlet untuk mensimulasikan lockOutlet (FOR UPDATE) pada transaksi paralel
  const outletLocks = new Map();

  const buildClient = () => {
    const client = {};
    for (const model of models) {
      client[model] = {};
      for (const method of methods) {
        client[model][method] = (...args) => ref.current[model][method](...args);
      }
    }
    client.$transaction = async (fn) => {
      // Serialize transaksi agar lockOutlet FOR UPDATE bekerja seperti di database sungguhan
      const prevPromise = outletLocks.get(1) || Promise.resolve();
      let release;
      const currentPromise = new Promise((resolve) => {
        release = resolve;
      });
      outletLocks.set(
        1,
        prevPromise.then(() => currentPromise)
      );

      await prevPromise;
      try {
        return await fn(client);
      } finally {
        release();
      }
    };
    return client;
  };

  return {
    storeRef: ref,
    mockPrisma: buildClient(),
  };
});

vi.mock("../../src/config/prisma.js", () => ({
  default: mockPrisma,
  prisma: mockPrisma,
  withDeleted: mockPrisma,
  lockOutlet: vi.fn(),
  lockCustomer: vi.fn(),
  lockBooking: vi.fn(),
  lockInvoices: vi.fn(),
}));

import * as bookingsService from "../../src/services/bookings.service.js";

const createBookingMockStore = () => {
  let seq = 1;
  const tables = {
    user: [],
    outlet: [],
    outletClosure: [],
    service: [],
    sparepart: [],
    vehicle: [],
    booking: [],
    bookingItem: [],
    bookingLog: [],
  };

  const matches = (row, where = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (k === "OR" && Array.isArray(v)) return v.some((sub) => matches(row, sub));
      if (v && typeof v === "object" && !(v instanceof Date)) {
        if ("in" in v) return v.in.includes(row[k]);
        if ("notIn" in v) return !v.notIn.includes(row[k]);
        if ("not" in v) return row[k] !== v.not;
        if ("gte" in v && "lte" in v) {
          const t = row[k] instanceof Date ? row[k].getTime() : new Date(row[k]).getTime();
          return t >= v.gte.getTime() && t <= v.lte.getTime();
        }
        if ("contains" in v) {
          return String(row[k] ?? "")
            .toLowerCase()
            .includes(String(v.contains).toLowerCase());
        }
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
      clone.items = tables.bookingItem.filter((i) => i.bookingId === row.id);
    }
    return clone;
  };

  const makeApi = (tableName) => {
    const rows = tables[tableName];
    return {
      findMany: async ({ where } = {}) =>
        rows.filter((r) => matches(r, where)).map((r) => hydrate(tableName, r)),
      findFirst: async ({ where } = {}) => {
        const found = rows.find((r) => matches(r, where));
        return found ? hydrate(tableName, found) : null;
      },
      findUnique: async ({ where } = {}) => {
        const found = rows.find((r) => matches(r, where));
        return found ? hydrate(tableName, found) : null;
      },
      count: async ({ where } = {}) => rows.filter((r) => matches(r, where)).length,
      create: async ({ data }) => {
        const { items, ...bookingData } = data;
        const row = {
          id: seq++,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...bookingData,
        };
        rows.push(row);
        if (items?.create) {
          for (const itemData of items.create) {
            tables.bookingItem.push({
              id: seq++,
              bookingId: row.id,
              createdAt: new Date(),
              updatedAt: new Date(),
              ...itemData,
            });
          }
        }
        return hydrate(tableName, row);
      },
      updateMany: async ({ where, data }) => {
        const list = rows.filter((r) => matches(r, where));
        for (const row of list) {
          Object.assign(row, data, { updatedAt: new Date() });
        }
        return { count: list.length };
      },
    };
  };

  const store = {};
  for (const name of Object.keys(tables)) {
    store[name] = makeApi(name);
  }
  return { tables, store };
};

describe("Fase 4 bookings service (concurrency, pricing, IDOR, validations)", () => {
  let mock;
  const outletTz = "Asia/Jakarta";

  beforeEach(() => {
    vi.restoreAllMocks();
    mock = createBookingMockStore();
    storeRef.current = mock.store;

    mock.tables.outlet.push({
      id: 1,
      name: "Tallero Cilandak",
      timezone: outletTz,
      openTime: "08:00",
      closeTime: "17:00",
      slotMinutes: 60,
      slotCapacity: 2, // Kapasitas 2 per slot
      openDays: [1, 2, 3, 4, 5, 6], // Buka Senin - Sabtu
      isActive: true,
      deletedAt: null,
    });

    mock.tables.user.push(
      {
        id: 10,
        name: "Budi Santoso",
        email: "budi@example.com",
        phone: "+6281234567890",
        role: "CUSTOMER",
      },
      {
        id: 20,
        name: "Sari Indah",
        email: "sari@example.com",
        phone: "+6281234567899",
        role: "CUSTOMER",
      },
      {
        id: 30,
        name: "Mekanik Joko",
        email: "joko@tallero.id",
        role: "MECHANIC",
        outletId: 1,
      },
      {
        id: 40,
        name: "Admin Pusat",
        email: "admin@tallero.id",
        role: "ADMIN",
      }
    );

    mock.tables.vehicle.push(
      {
        id: 101,
        userId: 10,
        plateNumber: "B1234TLL",
        type: "CAR",
        brand: "Toyota",
        model: "Avanza",
      },
      {
        id: 102,
        userId: 10,
        plateNumber: "B5678TLL",
        type: "MOTORCYCLE",
        brand: "Yamaha",
        model: "NMAX",
      },
      {
        id: 201,
        userId: 20,
        plateNumber: "B9999SARI",
        type: "CAR",
        brand: "Honda",
        model: "HRV",
      }
    );

    mock.tables.service.push(
      {
        id: 1,
        name: "Ganti Oli Mobil",
        price: 250000,
        estimatedMinutes: 45,
        vehicleType: "CAR",
        isActive: true,
        deletedAt: null,
      },
      {
        id: 2,
        name: "Servis Ringan Motor",
        price: 90000,
        estimatedMinutes: 30,
        vehicleType: "MOTORCYCLE",
        isActive: true,
        deletedAt: null,
      }
    );

    mock.tables.sparepart.push({
      id: 5,
      sku: "OLI-5W30",
      name: "Oli Full Sintetik 4L",
      price: 320000,
      stock: 10,
      isActive: true,
      deletedAt: null,
    });
  });

  it("handles 20 parallel booking requests to a slot with capacity 2: exactly 2 succeed and 18 are rejected with 409 SLOT_FULL", async () => {
    // Tentukan waktu booking 2 hari ke depan pukul 10:00 WIB
    const targetDt = DateTime.now().setZone(outletTz).plus({ days: 2 }).set({
      hour: 10,
      minute: 0,
      second: 0,
      millisecond: 0,
    });
    // Pastikan bukan hari Minggu
    const bookingDt = targetDt.weekday === 7 ? targetDt.plus({ days: 1 }) : targetDt;
    const scheduledAt = bookingDt.toISO();

    // 20 request paralel dengan kendaraan berbeda agar tidak terkena validasi 1 booking aktif per kendaraan
    const requests = Array.from({ length: 20 }, (_, i) => {
      const vId = 500 + i;
      mock.tables.vehicle.push({
        id: vId,
        userId: 10,
        plateNumber: `B${1000 + i}CAR`,
        type: "CAR",
        brand: "Toyota",
        model: "Yaris",
      });

      return bookingsService.createBooking({
        actor: { id: 10, role: "CUSTOMER" },
        data: {
          outletId: 1,
          vehicleId: vId,
          scheduledAt,
          items: [{ type: "SERVICE", serviceId: 1, quantity: 1 }],
        },
      });
    });

    const results = await Promise.allSettled(requests);
    const successes = results.filter((r) => r.status === "fulfilled");
    const rejections = results.filter((r) => r.status === "rejected");

    expect(successes).toHaveLength(2);
    expect(rejections).toHaveLength(18);

    for (const rej of rejections) {
      expect(rej.reason.statusCode).toBe(409);
      expect(rej.reason.code).toBe("SLOT_FULL");
    }
  });

  it("calculates price strictly on server from snapshot and ignores/rejects manipulated client pricing", async () => {
    const targetDt = DateTime.now()
      .setZone(outletTz)
      .plus({ days: 3 })
      .set({ hour: 13, minute: 0, second: 0 });
    const bookingDt = targetDt.weekday === 7 ? targetDt.plus({ days: 1 }) : targetDt;

    const booking = await bookingsService.createBooking({
      actor: { id: 10, role: "CUSTOMER" },
      data: {
        outletId: 1,
        vehicleId: 101,
        scheduledAt: bookingDt.toISO(),
        items: [
          { type: "SERVICE", serviceId: 1, quantity: 1 },
          { type: "SPAREPART", sparepartId: 5, quantity: 2 },
        ],
      },
    });

    // Harga server: Service 250.000 + Sparepart 320.000 * 2 = 890.000
    expect(booking.total).toBe(890000);
    expect(booking.items).toHaveLength(2);
    expect(booking.items[0].nameSnapshot).toBe("Ganti Oli Mobil");
    expect(booking.items[0].unitPrice).toBe(250000);
    expect(booking.items[1].nameSnapshot).toBe("Oli Full Sintetik 4L");
    expect(booking.items[1].unitPrice).toBe(320000);
    expect(booking.items[1].subtotal).toBe(640000);

    // Stok sparepart BELUM dipotong saat booking dibuat
    expect(mock.tables.sparepart[0].stock).toBe(10);
  });

  it("protects against IDOR with 404 when customer B attempts to view or cancel customer A's booking", async () => {
    const targetDt = DateTime.now()
      .setZone(outletTz)
      .plus({ days: 1 })
      .set({ hour: 14, minute: 0, second: 0 });
    const bookingDt = targetDt.weekday === 7 ? targetDt.plus({ days: 1 }) : targetDt;

    const bookingA = await bookingsService.createBooking({
      actor: { id: 10, role: "CUSTOMER" },
      data: {
        outletId: 1,
        vehicleId: 101,
        scheduledAt: bookingDt.toISO(),
        items: [{ type: "SERVICE", serviceId: 1, quantity: 1 }],
      },
    });

    // Customer B mencoba melihat booking Customer A -> 404
    await expect(
      bookingsService.getBookingById({
        actor: { id: 20, role: "CUSTOMER" },
        bookingId: bookingA.id,
      })
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "BOOKING_NOT_FOUND",
    });

    // Customer B mencoba membatalkan booking Customer A -> 404
    await expect(
      bookingsService.cancelBooking({
        actor: { id: 20, role: "CUSTOMER" },
        bookingId: bookingA.id,
        reason: "Iseng membatalkan",
      })
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "BOOKING_NOT_FOUND",
    });
  });

  it("rejects booking when vehicle already has an active booking", async () => {
    const targetDt1 = DateTime.now()
      .setZone(outletTz)
      .plus({ days: 1 })
      .set({ hour: 11, minute: 0, second: 0 });
    const dt1 = targetDt1.weekday === 7 ? targetDt1.plus({ days: 1 }) : targetDt1;

    await bookingsService.createBooking({
      actor: { id: 10, role: "CUSTOMER" },
      data: {
        outletId: 1,
        vehicleId: 101,
        scheduledAt: dt1.toISO(),
        items: [{ type: "SERVICE", serviceId: 1, quantity: 1 }],
      },
    });

    // Booking kedua menggunakan kendaraan 101 yang sama
    const targetDt2 = DateTime.now()
      .setZone(outletTz)
      .plus({ days: 2 })
      .set({ hour: 11, minute: 0, second: 0 });
    const dt2 = targetDt2.weekday === 7 ? targetDt2.plus({ days: 1 }) : targetDt2;

    await expect(
      bookingsService.createBooking({
        actor: { id: 10, role: "CUSTOMER" },
        data: {
          outletId: 1,
          vehicleId: 101,
          scheduledAt: dt2.toISO(),
          items: [{ type: "SERVICE", serviceId: 1, quantity: 1 }],
        },
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "VEHICLE_HAS_ACTIVE_BOOKING",
    });
  });

  it("rejects motorcycle service booked for a car with 422 INCOMPATIBLE_VEHICLE_TYPE", async () => {
    const targetDt = DateTime.now()
      .setZone(outletTz)
      .plus({ days: 1 })
      .set({ hour: 15, minute: 0, second: 0 });
    const dt = targetDt.weekday === 7 ? targetDt.plus({ days: 1 }) : targetDt;

    // Kendaraan 101 bertipe CAR, layanan 2 bertipe MOTORCYCLE
    await expect(
      bookingsService.createBooking({
        actor: { id: 10, role: "CUSTOMER" },
        data: {
          outletId: 1,
          vehicleId: 101,
          scheduledAt: dt.toISO(),
          items: [{ type: "SERVICE", serviceId: 2, quantity: 1 }],
        },
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "INCOMPATIBLE_VEHICLE_TYPE",
    });
  });

  it("rejects past slots, slots beyond 30 days, closed days, and closure holidays", async () => {
    // 1. Slot lampau (< 60 menit dari sekarang)
    const pastDt = DateTime.now().setZone(outletTz).plus({ minutes: 20 });
    await expect(
      bookingsService.createBooking({
        actor: { id: 10, role: "CUSTOMER" },
        data: {
          outletId: 1,
          vehicleId: 101,
          scheduledAt: pastDt.toISO(),
          items: [{ type: "SERVICE", serviceId: 1, quantity: 1 }],
        },
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "SLOT_PAST_LEAD_TIME",
    });

    // 2. Slot di luar 30 hari ke depan
    const futureDt = DateTime.now()
      .setZone(outletTz)
      .plus({ days: 35 })
      .set({ hour: 10, minute: 0 });
    await expect(
      bookingsService.createBooking({
        actor: { id: 10, role: "CUSTOMER" },
        data: {
          outletId: 1,
          vehicleId: 101,
          scheduledAt: futureDt.toISO(),
          items: [{ type: "SERVICE", serviceId: 1, quantity: 1 }],
        },
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "SLOT_EXCEEDS_MAX_ADVANCE",
    });

    // 3. Hari Minggu (outlet tutup)
    const sundayDt = DateTime.now().setZone(outletTz).plus({ days: 1 });
    const nextSunday = sundayDt.set({ weekday: 7, hour: 10, minute: 0 });
    await expect(
      bookingsService.createBooking({
        actor: { id: 10, role: "CUSTOMER" },
        data: {
          outletId: 1,
          vehicleId: 101,
          scheduledAt: nextSunday.toISO(),
          items: [{ type: "SERVICE", serviceId: 1, quantity: 1 }],
        },
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "OUTLET_CLOSED_ON_DAY",
    });

    // 4. Hari libur (closure)
    const closureDt = DateTime.now()
      .setZone(outletTz)
      .plus({ days: 4 })
      .set({ hour: 10, minute: 0 });
    const validClosureDt = closureDt.weekday === 7 ? closureDt.plus({ days: 1 }) : closureDt;
    mock.tables.outletClosure.push({
      id: 1,
      outletId: 1,
      date: new Date(`${validClosureDt.toISODate()}T00:00:00.000Z`),
      reason: "Cuti Bersama",
    });

    await expect(
      bookingsService.createBooking({
        actor: { id: 10, role: "CUSTOMER" },
        data: {
          outletId: 1,
          vehicleId: 101,
          scheduledAt: validClosureDt.toISO(),
          items: [{ type: "SERVICE", serviceId: 1, quantity: 1 }],
        },
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "OUTLET_CLOSED_ON_DATE",
    });
  });

  it("generates and verifies signed QR payloads (code.hmac16)", () => {
    const code = "TLR-20261120-X8K9L2";
    const payload = bookingsService.generateBookingQrPayload(code);
    expect(payload).toMatch(/^TLR-20261120-X8K9L2\.[a-f0-9]{16}$/);

    const verified = bookingsService.verifyBookingQrPayload(payload);
    expect(verified.valid).toBe(true);
    expect(verified.code).toBe(code);

    const tampered = `${code}.0000000000000000`;
    expect(bookingsService.verifyBookingQrPayload(tampered).valid).toBe(false);
    expect(bookingsService.verifyBookingQrPayload("corrupted").valid).toBe(false);
  });

  it("scopes and formats booking data per actor role (mechanic privacy restrictions)", async () => {
    const targetDt = DateTime.now()
      .setZone(outletTz)
      .plus({ days: 2 })
      .set({ hour: 10, minute: 0, second: 0 });
    const bookingDt = targetDt.weekday === 7 ? targetDt.plus({ days: 1 }) : targetDt;

    const b = await bookingsService.createBooking({
      actor: { id: 10, role: "CUSTOMER" },
      data: {
        outletId: 1,
        vehicleId: 101,
        scheduledAt: bookingDt.toISO(),
        items: [{ type: "SERVICE", serviceId: 1, quantity: 1 }],
      },
    });

    // Mekanik belum di-assign -> nama depan customer saja, nomor telepon disembunyikan (null)
    const mechanicViewUnassigned = await bookingsService.getBookingById({
      actor: { id: 30, role: "MECHANIC", outletId: 1 },
      bookingId: b.id,
    });
    expect(mechanicViewUnassigned.customer.name).toBe("Budi");
    expect(mechanicViewUnassigned.customer.phone).toBeNull();

    // Mekanik yang di-assign -> nomor telepon lengkap tersedia
    mock.tables.booking[0].mechanicId = 30;
    const mechanicViewAssigned = await bookingsService.getBookingById({
      actor: { id: 30, role: "MECHANIC", outletId: 1 },
      bookingId: b.id,
    });
    expect(mechanicViewAssigned.customer.phone).toBe("+6281234567890");

    // Customer melihat nama mekanik, BUKAN email atau telepon mekanik
    const customerView = await bookingsService.getBookingById({
      actor: { id: 10, role: "CUSTOMER" },
      bookingId: b.id,
    });
    expect(customerView.mechanic.name).toBe("Mekanik Joko");
    expect(customerView.mechanic.email).toBeUndefined();
    expect(customerView.mechanic.phone).toBeUndefined();
  });
});
