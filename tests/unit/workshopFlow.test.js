import { beforeEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import * as bookingsService from "../../src/services/bookings.service.js";

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

const createWorkshopMockStore = () => {
  let seq = 1000;
  const tables = {
    user: [],
    outlet: [],
    outletClosure: [],
    service: [],
    sparepart: [],
    vehicle: [],
    booking: [],
    bookingItem: [],
    bookingPhoto: [],
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
        if ("lt" in v) {
          return row[k] < v.lt;
        }
        if ("lte" in v) {
          const t = row[k] instanceof Date ? row[k].getTime() : new Date(row[k]).getTime();
          const target = v.lte instanceof Date ? v.lte.getTime() : new Date(v.lte).getTime();
          return t <= target;
        }
        if ("gte" in v) {
          const t = row[k] instanceof Date ? row[k].getTime() : new Date(row[k]).getTime();
          const target = v.gte instanceof Date ? v.gte.getTime() : new Date(v.gte).getTime();
          return t >= target;
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
      clone.items = tables.bookingItem
        .filter((i) => i.bookingId === row.id)
        .map((item) => ({
          ...item,
          service: tables.service.find((s) => s.id === item.serviceId) || null,
          sparepart: tables.sparepart.find((sp) => sp.id === item.sparepartId) || null,
        }));
    }
    return clone;
  };

  const makeApi = (tableName) => {
    const rows = tables[tableName];
    return {
      findMany: async ({ where, orderBy, take } = {}) => {
        let list = rows.filter((r) => matches(r, where));
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0];
          list.sort((a, b) => {
            const valA = a[field] instanceof Date ? a[field].getTime() : a[field];
            const valB = b[field] instanceof Date ? b[field].getTime() : b[field];
            if (valA < valB) return dir === "asc" ? -1 : 1;
            if (valA > valB) return dir === "asc" ? 1 : -1;
            return 0;
          });
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
      aggregate: async ({ where } = {}) => {
        const list = rows.filter((r) => matches(r, where));
        const maxQueue = list.reduce((max, r) => (r.queueNumber > max ? r.queueNumber : max), 0);
        return {
          _max: { queueNumber: maxQueue },
        };
      },
      create: async ({ data }) => {
        const row = {
          id: seq++,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        rows.push(row);
        return hydrate(tableName, row);
      },
      update: async ({ where, data }) => {
        const row = rows.find((r) => matches(r, where));
        if (row) {
          for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === "object" && "increment" in v) {
              row[k] = (row[k] || 0) + v.increment;
            } else if (v && typeof v === "object" && "decrement" in v) {
              row[k] = (row[k] || 0) - v.decrement;
            } else {
              row[k] = v;
            }
          }
          row.updatedAt = new Date();
        }
        return hydrate(tableName, row);
      },
      updateMany: async ({ where, data }) => {
        const list = rows.filter((r) => matches(r, where));
        for (const row of list) {
          for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === "object" && "increment" in v) {
              row[k] = (row[k] || 0) + v.increment;
            } else if (v && typeof v === "object" && "decrement" in v) {
              row[k] = (row[k] || 0) - v.decrement;
            } else {
              row[k] = v;
            }
          }
          row.updatedAt = new Date();
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

describe("Fase 5 Workshop Flow & Queue Tests", () => {
  let mock;
  const outletTz = "Asia/Jakarta";

  beforeEach(() => {
    vi.restoreAllMocks();
    mock = createWorkshopMockStore();
    storeRef.current = mock.store;

    // Outlet 1 (Jakarta)
    mock.tables.outlet.push(
      {
        id: 1,
        name: "Tallero Cilandak",
        timezone: outletTz,
        openTime: "08:00",
        closeTime: "17:00",
        slotMinutes: 60,
        slotCapacity: 2,
        openDays: [1, 2, 3, 4, 5, 6],
        isActive: true,
        isVerified: true,
        deletedAt: null,
      },
      // Outlet 2 (Bandung)
      {
        id: 2,
        name: "Tallero Bandung",
        timezone: outletTz,
        openTime: "08:00",
        closeTime: "17:00",
        slotMinutes: 60,
        slotCapacity: 2,
        openDays: [1, 2, 3, 4, 5, 6],
        isActive: true,
        isVerified: true,
        deletedAt: null,
      }
    );

    // Users
    mock.tables.user.push(
      {
        id: 10,
        name: "Budi Santoso",
        email: "budi@gmail.com",
        phone: "+6281234567890",
        role: "CUSTOMER",
        isActive: true,
        isVerified: true,
        deletedAt: null,
      },
      {
        id: 20,
        name: "Mekanik Joko",
        email: "joko@tallero.id",
        role: "MECHANIC",
        outletId: 1,
        isActive: true,
        isVerified: true,
        deletedAt: null,
      },
      {
        id: 21,
        name: "Mekanik Agus",
        email: "agus@tallero.id",
        role: "MECHANIC",
        outletId: 1,
        isActive: true,
        isVerified: true,
        deletedAt: null,
      },
      {
        id: 30,
        name: "Mekanik Bandung",
        email: "bandung@tallero.id",
        role: "MECHANIC",
        outletId: 2,
        isActive: true,
        isVerified: true,
        deletedAt: null,
      },
      {
        id: 1,
        name: "Admin Pusat",
        email: "admin@tallero.id",
        role: "ADMIN",
        isActive: true,
        isVerified: true,
        deletedAt: null,
      }
    );

    // Vehicles
    mock.tables.vehicle.push({
      id: 101,
      userId: 10,
      plateNumber: "B1234XYZ",
      type: "CAR",
      brand: "Toyota",
      model: "Avanza",
      lastOdometerKm: 45000,
    });

    // Services & Spareparts
    mock.tables.service.push({
      id: 1,
      name: "Servis Berkala 50k",
      price: 350000,
      estimatedMinutes: 60,
      vehicleType: "CAR",
      isActive: true,
      deletedAt: null,
    });

    mock.tables.sparepart.push({
      id: 5,
      sku: "OLI-5W30",
      name: "Oli Mesin 4L",
      price: 300000,
      stock: 5,
      isActive: true,
      deletedAt: null,
    });
  });

  describe("Check-in via QR Code", () => {
    it("menolak check-in bila payload QR dipalsukan (tampered signature)", async () => {
      const actor = { id: 20, role: "MECHANIC", outletId: 1 };
      const tamperedPayload = "TLR-20261120-ABC123.0000000000000000";

      await expect(
        bookingsService.checkInBooking({
          actor,
          data: { qrPayload: tamperedPayload },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_QR_PAYLOAD",
      });
    });

    it("menolak check-in oleh mekanik yang bertugas di outlet berbeda", async () => {
      const code = "TLR-20261120-XYZ999";
      const scheduledAt = DateTime.now()
        .setZone(outletTz)
        .set({ hour: 10, minute: 0, second: 0 })
        .toJSDate();

      mock.tables.booking.push({
        id: 701,
        code,
        outletId: 1, // Outlet 1 Cilandak
        customerId: 10,
        vehicleId: 101,
        status: "PENDING",
        scheduledAt,
        slotEndAt: new Date(scheduledAt.getTime() + 3600000),
      });

      const qrPayload = bookingsService.generateBookingQrPayload(code);
      // Mekanik 30 berasal dari Outlet 2 (Bandung)
      const actor = { id: 30, role: "MECHANIC", outletId: 2 };

      await expect(
        bookingsService.checkInBooking({
          actor,
          data: { qrPayload },
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN_OUTLET",
      });
    });

    it("menolak check-in di luar hari-H (tanggal jadwal berbeda)", async () => {
      const code = "TLR-20261125-FUT001";
      // Jadwal besok
      const scheduledAt = DateTime.now()
        .setZone(outletTz)
        .plus({ days: 1 })
        .set({ hour: 10, minute: 0 })
        .toJSDate();

      mock.tables.booking.push({
        id: 702,
        code,
        outletId: 1,
        customerId: 10,
        vehicleId: 101,
        status: "PENDING",
        scheduledAt,
        slotEndAt: new Date(scheduledAt.getTime() + 3600000),
      });

      const qrPayload = bookingsService.generateBookingQrPayload(code);
      const actor = { id: 20, role: "MECHANIC", outletId: 1 };

      await expect(
        bookingsService.checkInBooking({
          actor,
          data: { qrPayload },
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "CHECKIN_DATE_MISMATCH",
      });
    });

    it("berhasil memproses check-in pada hari-H: alokasi nomor antrian atomik dan update odometer", async () => {
      const code = "TLR-20261120-VAL123";
      // Jadwal jam 10:00 WIB, check-in dilakukan jam 09:30 WIB (dalam jam buka 08:00 - 17:00)
      const testNowDt = DateTime.now()
        .setZone(outletTz)
        .set({ hour: 9, minute: 30, second: 0, millisecond: 0 });
      const scheduledAt = testNowDt.plus({ minutes: 30 }).toJSDate();

      mock.tables.booking.push({
        id: 703,
        code,
        outletId: 1,
        customerId: 10,
        vehicleId: 101,
        status: "PENDING",
        scheduledAt,
        slotEndAt: new Date(scheduledAt.getTime() + 3600000),
      });

      const qrPayload = bookingsService.generateBookingQrPayload(code);
      const actor = { id: 20, role: "MECHANIC", outletId: 1 };

      const checkedIn = await bookingsService.checkInBooking({
        actor,
        data: { qrPayload, odometerKm: 48500, now: testNowDt.toJSDate() },
      });

      expect(checkedIn.status).toBe("CHECKED_IN");
      expect(checkedIn.queueNumber).toBe(1);
      // Kendaraan terupdate odometer baru yang lebih besar
      expect(mock.tables.vehicle[0].lastOdometerKm).toBe(48500);
    });
  });

  describe("Aturan Antrian & Pengerjaan Servis", () => {
    beforeEach(() => {
      // Siapkan 2 booking yang sudah CHECKED_IN di Outlet 1
      mock.tables.booking.push(
        {
          id: 801,
          code: "TLR-ANTRIAN-001",
          outletId: 1,
          customerId: 10,
          vehicleId: 101,
          status: "CHECKED_IN",
          queueNumber: 1,
          mechanicId: null,
          scheduledAt: new Date(),
          slotEndAt: new Date(),
        },
        {
          id: 802,
          code: "TLR-ANTRIAN-002",
          outletId: 1,
          customerId: 10,
          vehicleId: 101,
          status: "CHECKED_IN",
          queueNumber: 2,
          mechanicId: null,
          scheduledAt: new Date(),
          slotEndAt: new Date(),
        }
      );
    });

    it("menolak mekanik yang mencoba memulai booking yang BUKAN kepala antrian dengan 409 QUEUE_ORDER_VIOLATION", async () => {
      const actor = { id: 20, role: "MECHANIC", outletId: 1 };

      // Mekanik mencoba start booking nomor 802 (antrian #2), padahal antrian #1 (801) belum dikerjakan
      await expect(
        bookingsService.startBooking({
          actor,
          bookingId: 802,
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "QUEUE_ORDER_VIOLATION",
      });
    });

    it("menangani dua mekanik yang memanggil claim-next secara bersamaan: masing-masing mendapatkan booking berurutan tanpa duplikasi", async () => {
      const mech1 = { id: 20, role: "MECHANIC", outletId: 1 };
      const mech2 = { id: 21, role: "MECHANIC", outletId: 1 };

      // Mekanik 1 mengambil antrian pertama
      const job1 = await bookingsService.claimNextBooking({ actor: mech1 });
      expect(job1.id).toBe(801);
      expect(job1.status).toBe("IN_PROGRESS");
      expect(job1.mechanicId).toBe(20);

      // Mekanik 2 mengambil antrian berikutnya
      const job2 = await bookingsService.claimNextBooking({ actor: mech2 });
      expect(job2.id).toBe(802);
      expect(job2.status).toBe("IN_PROGRESS");
      expect(job2.mechanicId).toBe(21);
    });

    it("menolak mekanik memulai job baru bila sudah memiliki 1 pengerjaan aktif dengan 409 MAX_ACTIVE_JOBS_EXCEEDED", async () => {
      const mech1 = { id: 20, role: "MECHANIC", outletId: 1 };

      // Mekanik 1 sudah mengambil booking 801
      await bookingsService.startBooking({ actor: mech1, bookingId: 801 });

      // Mekanik 1 mencoba start lagi saat 801 masih IN_PROGRESS
      await expect(
        bookingsService.startBooking({ actor: mech1, bookingId: 802 })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "MAX_ACTIVE_JOBS_EXCEEDED",
      });
    });

    it("memotong stok suku cadang saat booking dimulai dan menolak dengan 409 bila stok kurang", async () => {
      // Booking 801 membutuhkan 10 Oli Mesin, sedangkan stok di gudang hanya 5
      mock.tables.bookingItem.push({
        id: 991,
        bookingId: 801,
        type: "SPAREPART",
        sparepartId: 5,
        nameSnapshot: "Oli Mesin 4L",
        quantity: 10,
        subtotal: 3000000,
        approvalStatus: "APPROVED",
        stockDeducted: false,
      });

      const mech1 = { id: 20, role: "MECHANIC", outletId: 1 };

      await expect(
        bookingsService.startBooking({ actor: mech1, bookingId: 801 })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "STOCK_INSUFFICIENT",
      });

      // Stok tidak berkurang
      expect(mock.tables.sparepart[0].stock).toBe(5);
    });

    it("memastikan mekanik di outlet A tidak melihat dan tidak dapat mengakses antrian di outlet B", async () => {
      // Booking di outlet 2 Bandung
      mock.tables.booking.push({
        id: 888,
        code: "TLR-BDG-001",
        outletId: 2,
        customerId: 10,
        vehicleId: 101,
        status: "CHECKED_IN",
        queueNumber: 1,
      });

      const mechJakarta = { id: 20, role: "MECHANIC", outletId: 1 };

      // Mekanik Jakarta melihat antrian staff: otomatis ter-filter ke outlet 1
      const queue = await bookingsService.getStaffQueue({ actor: mechJakarta });
      expect(queue.outletId).toBe(1);
      const hasBandungBooking = queue.waiting.some((b) => b.id === 888);
      expect(hasBandungBooking).toBe(false);

      // Mekanik Jakarta mencoba mengambil booking di Outlet 2 -> 403
      await expect(
        bookingsService.startBooking({ actor: mechJakarta, bookingId: 888 })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN_OUTLET",
      });
    });

    it("menghitung posisi antrian dan estimasi waktu tunggu untuk customer pemilik", async () => {
      const customer = { id: 10, role: "CUSTOMER" };

      // Antrian #2 (ada 1 booking di depan)
      const pos = await bookingsService.getQueuePosition({
        actor: customer,
        bookingId: 802,
      });

      expect(pos.queueNumber).toBe(2);
      expect(pos.aheadCount).toBe(1);
      expect(pos.activeMechanicCount).toBe(2);
      expect(pos.estimatedWaitMinutes).toBeGreaterThan(0);
    });
  });
});
