import { beforeEach, describe, expect, it, vi } from "vitest";
import * as bookingsService from "../../src/services/bookings.service.js";
import { resolveSignedPrivateFile } from "../../src/services/files.service.js";
import { createSignedUrl } from "../../src/utils/signedUrl.js";

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

// Mock files.service untuk saveProcessedBookingPhoto
vi.mock("../../src/services/files.service.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    saveProcessedBookingPhoto: vi.fn(async (_buf, bookingId) => ({
      storageKey: `booking-photos/${bookingId}/mock-photo-uuid.webp`,
      filePath: `/fake/path/booking-photos/${bookingId}/mock-photo-uuid.webp`,
      sizeBytes: 10240,
      mimeType: "image/webp",
    })),
  };
});

// Mock mail.service untuk sendMail
vi.mock("../../src/services/mail.service.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    sendMail: vi.fn(async () => ({ messageId: "mock-msg-id" })),
  };
});

const createInspectionMockStore = () => {
  let seq = 2000;
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
    notification: [],
    auditLog: [],
  };

  const matches = (row, where = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (k === "OR" && Array.isArray(v)) return v.some((sub) => matches(row, sub));
      if (v && typeof v === "object" && !(v instanceof Date)) {
        if ("in" in v) return v.in.includes(row[k]);
        if ("notIn" in v) return !v.notIn.includes(row[k]);
        if ("not" in v) return row[k] !== v.not;
        if ("gte" in v) return row[k] >= v.gte;
        if ("lte" in v) return row[k] <= v.lte;
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
      clone.photos = tables.bookingPhoto.filter(
        (p) => p.bookingId === row.id && p.deletedAt === null
      );
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
          Object.assign(row, data, { updatedAt: new Date() });
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
      delete: async ({ where }) => {
        const idx = rows.findIndex((r) => matches(r, where));
        if (idx !== -1) {
          const [removed] = rows.splice(idx, 1);
          return hydrate(tableName, removed);
        }
        return null;
      },
    };
  };

  const store = {};
  for (const name of Object.keys(tables)) {
    store[name] = makeApi(name);
  }
  return { tables, store };
};

describe("Fase 6 Workshop Inspection, Additional Items, & Photos Tests", () => {
  let mock;

  beforeEach(() => {
    vi.restoreAllMocks();
    mock = createInspectionMockStore();
    storeRef.current = mock.store;

    // Seed master data
    mock.tables.outlet.push({
      id: 1,
      name: "Tallero Cilandak",
      timezone: "Asia/Jakarta",
      isActive: true,
      deletedAt: null,
    });

    mock.tables.user.push(
      {
        id: 10,
        name: "Customer A",
        email: "custA@gmail.com",
        role: "CUSTOMER",
        isActive: true,
      },
      {
        id: 11,
        name: "Customer B (Intruder)",
        email: "custB@gmail.com",
        role: "CUSTOMER",
        isActive: true,
      },
      {
        id: 20,
        name: "Mekanik Ditugaskan",
        email: "assigned@tallero.id",
        role: "MECHANIC",
        outletId: 1,
        isActive: true,
      },
      {
        id: 21,
        name: "Mekanik Lain",
        email: "other@tallero.id",
        role: "MECHANIC",
        outletId: 1,
        isActive: true,
      },
      {
        id: 1,
        name: "Admin Pusat",
        email: "admin@tallero.id",
        role: "ADMIN",
        isActive: true,
      }
    );

    mock.tables.vehicle.push({
      id: 101,
      userId: 10,
      plateNumber: "B1234XYZ",
      lastOdometerKm: 40000,
    });

    mock.tables.service.push({
      id: 1,
      name: "Ganti Kampas Rem",
      price: 150000,
      isActive: true,
    });

    mock.tables.sparepart.push({
      id: 5,
      name: "Kampas Rem Depan",
      price: 250000,
      stock: 2, // Stok 2 unit
      isActive: true,
    });

    // Booking 500 milik Customer 10, ditangani oleh Mekanik 20, status IN_PROGRESS
    mock.tables.booking.push({
      id: 500,
      code: "TLR-20261120-TEST01",
      customerId: 10,
      outletId: 1,
      vehicleId: 101,
      mechanicId: 20,
      status: "IN_PROGRESS",
      scheduledAt: new Date("2026-11-20T10:00:00.000Z"),
      slotEndAt: new Date("2026-11-20T11:00:00.000Z"),
      total: 300000, // Total awal
      paymentStatus: "UNPAID",
      odometerKm: 40000,
    });
  });

  describe("Item Tambahan & Persetujuan Customer", () => {
    it("menolak jika customer B mencoba menyetujui item booking milik customer A dengan 404 (IDOR)", async () => {
      // Mekanik mengajukan item tambahan
      mock.tables.bookingItem.push({
        id: 601,
        bookingId: 500,
        type: "SERVICE",
        nameSnapshot: "Ganti Kampas Rem",
        unitPrice: 150000,
        quantity: 1,
        subtotal: 150000,
        source: "MECHANIC_ADDED",
        approvalStatus: "PENDING_APPROVAL",
        stockDeducted: false,
      });
      mock.tables.booking[0].status = "WAITING_APPROVAL";

      const intruderCustomer = { id: 11, role: "CUSTOMER" };

      await expect(
        bookingsService.decideBookingApprovals({
          actor: intruderCustomer,
          bookingId: 500,
          data: {
            decisions: [{ itemId: 601, decision: "APPROVE" }],
          },
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "BOOKING_NOT_FOUND",
      });
    });

    it("menolak keputusan approval yang parsial, duplikat, atau mencakup item non-pending", async () => {
      // Ada 2 item yang PENDING_APPROVAL
      mock.tables.bookingItem.push(
        {
          id: 601,
          bookingId: 500,
          type: "SERVICE",
          nameSnapshot: "Layanan 1",
          unitPrice: 100000,
          quantity: 1,
          subtotal: 100000,
          source: "MECHANIC_ADDED",
          approvalStatus: "PENDING_APPROVAL",
        },
        {
          id: 602,
          bookingId: 500,
          type: "SPAREPART",
          nameSnapshot: "Suku Cadang 2",
          unitPrice: 50000,
          quantity: 1,
          subtotal: 50000,
          source: "MECHANIC_ADDED",
          approvalStatus: "PENDING_APPROVAL",
        }
      );
      mock.tables.booking[0].status = "WAITING_APPROVAL";

      const ownerCustomer = { id: 10, role: "CUSTOMER" };

      // 1. Parsial (hanya memutuskan 1 dari 2 item pending)
      await expect(
        bookingsService.decideBookingApprovals({
          actor: ownerCustomer,
          bookingId: 500,
          data: {
            decisions: [{ itemId: 601, decision: "APPROVE" }],
          },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "INCOMPLETE_APPROVAL_DECISIONS",
      });

      // 2. Duplikat ID item dalam batch keputusan
      await expect(
        bookingsService.decideBookingApprovals({
          actor: ownerCustomer,
          bookingId: 500,
          data: {
            decisions: [
              { itemId: 601, decision: "APPROVE" },
              { itemId: 601, decision: "REJECT" },
            ],
          },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "DUPLICATE_DECISION_ITEMS",
      });

      // 3. ID item bukan item pending pada booking
      await expect(
        bookingsService.decideBookingApprovals({
          actor: ownerCustomer,
          bookingId: 500,
          data: {
            decisions: [
              { itemId: 601, decision: "APPROVE" },
              { itemId: 999, decision: "APPROVE" },
            ],
          },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "INVALID_DECISION_ITEM",
      });
    });

    it("menolak approval dengan 409 bila stok suku cadang kurang dan total biaya tidak berubah", async () => {
      // Sparepart 5 hanya ada stok 2, mekanik mengajukan 5 unit
      mock.tables.bookingItem.push({
        id: 603,
        bookingId: 500,
        type: "SPAREPART",
        sparepartId: 5,
        nameSnapshot: "Kampas Rem Depan",
        unitPrice: 250000,
        quantity: 5, // melebihi stok 2
        subtotal: 1250000,
        source: "MECHANIC_ADDED",
        approvalStatus: "PENDING_APPROVAL",
        stockDeducted: false,
      });
      mock.tables.booking[0].status = "WAITING_APPROVAL";

      const ownerCustomer = { id: 10, role: "CUSTOMER" };

      await expect(
        bookingsService.decideBookingApprovals({
          actor: ownerCustomer,
          bookingId: 500,
          data: {
            decisions: [{ itemId: 603, decision: "APPROVE" }],
          },
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "STOCK_INSUFFICIENT",
      });

      // Total booking tetap pada nilai semula (300.000) dan stok tetap 2
      expect(mock.tables.booking[0].total).toBe(300000);
      expect(mock.tables.sparepart[0].stock).toBe(2);
    });

    it("memproses approval yang valid: memotong stok, memperbarui total, dan mengembalikan status ke IN_PROGRESS", async () => {
      // Pengajuan 1 kampas rem (stok ada 2)
      mock.tables.bookingItem.push({
        id: 604,
        bookingId: 500,
        type: "SPAREPART",
        sparepartId: 5,
        nameSnapshot: "Kampas Rem Depan",
        unitPrice: 250000,
        quantity: 1,
        subtotal: 250000,
        source: "MECHANIC_ADDED",
        approvalStatus: "PENDING_APPROVAL",
        stockDeducted: false,
      });
      mock.tables.booking[0].status = "WAITING_APPROVAL";

      const ownerCustomer = { id: 10, role: "CUSTOMER" };

      const updated = await bookingsService.decideBookingApprovals({
        actor: ownerCustomer,
        bookingId: 500,
        data: {
          decisions: [{ itemId: 604, decision: "APPROVE" }],
        },
      });

      // Status kembali ke IN_PROGRESS
      expect(updated.status).toBe("IN_PROGRESS");
      // Stok berkurang dari 2 menjadi 1
      expect(mock.tables.sparepart[0].stock).toBe(1);
      // Item ter-update
      expect(mock.tables.bookingItem[0].approvalStatus).toBe("APPROVED");
      expect(mock.tables.bookingItem[0].stockDeducted).toBe(true);
    });
  });

  describe("Inspeksi Foto & Batas Kuota", () => {
    it("menolak mekanik lain (bukan penangan) mengunggah atau mengubah data inspeksi booking", async () => {
      const otherMechanic = { id: 21, role: "MECHANIC", outletId: 1 };
      const fakeFile = { buffer: Buffer.from("fake-image-bytes") };

      // Mekanik 21 mencoba unggah foto untuk booking 500 (penangan = 20) -> 403
      await expect(
        bookingsService.uploadBookingPhoto({
          actor: otherMechanic,
          bookingId: 500,
          file: fakeFile,
          data: { type: "BEFORE" },
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
      });

      // Mekanik 21 mencoba update inspeksi -> 403
      await expect(
        bookingsService.updateInspection({
          actor: otherMechanic,
          bookingId: 500,
          data: { staffNotes: "Catatan mekanik lain" },
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
      });
    });

    it("menolak jika sudah ada 10 foto dan mencoba mengunggah foto ke-11 dengan 422 MAX_PHOTOS_EXCEEDED", async () => {
      const assignedMechanic = { id: 20, role: "MECHANIC", outletId: 1 };
      const fakeFile = { buffer: Buffer.from("fake-image-bytes") };

      // Masukkan 10 foto tipe BEFORE yang sudah ada
      for (let i = 1; i <= 10; i++) {
        mock.tables.bookingPhoto.push({
          id: 700 + i,
          bookingId: 500,
          type: "BEFORE",
          storageKey: `booking-photos/500/photo-${i}.webp`,
          uploadedById: 20,
          deletedAt: null,
        });
      }

      // Unggah foto ke-11 bertipe BEFORE
      await expect(
        bookingsService.uploadBookingPhoto({
          actor: assignedMechanic,
          bookingId: 500,
          file: fakeFile,
          data: { type: "BEFORE" },
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "MAX_PHOTOS_EXCEEDED",
      });
    });

    it("memverifikasi signed URL berkas foto: menolak URL dengan signature dimodifikasi atau kedaluwarsa dengan 403", async () => {
      // Foto valid tersimpan
      mock.tables.bookingPhoto.push({
        id: 888,
        bookingId: 500,
        type: "BEFORE",
        storageKey: "booking-photos/500/sample.webp",
        deletedAt: null,
      });

      const validSigned = createSignedUrl({
        kind: "booking-photo",
        id: 888,
        ttlSec: 600,
      });

      // 1. Signature dimanipulasi
      await expect(
        resolveSignedPrivateFile({
          kind: "booking-photo",
          id: "888",
          exp: String(validSigned.exp),
          sig: "tampered_signature_hex",
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "INVALID_SIGNED_URL",
      });

      // 2. URL telah kedaluwarsa (exp lampau)
      const expiredExp = String(Math.floor(Date.now() / 1000) - 30);
      await expect(
        resolveSignedPrivateFile({
          kind: "booking-photo",
          id: "888",
          exp: expiredExp,
          sig: validSigned.sig,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it("menolak transisi ke READY_FOR_PICKUP bila belum memiliki foto AFTER dengan 422 PHOTOS_INCOMPLETE", async () => {
      // Hanya ada foto BEFORE, belum ada foto AFTER
      mock.tables.bookingPhoto.push({
        id: 750,
        bookingId: 500,
        type: "BEFORE",
        storageKey: "booking-photos/500/before.webp",
        uploadedById: 20,
        deletedAt: null,
      });

      const assignedMechanic = { id: 20, role: "MECHANIC", outletId: 1 };

      await expect(
        bookingsService.markBookingReady({
          actor: assignedMechanic,
          bookingId: 500,
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "PHOTOS_INCOMPLETE",
      });
    });

    it("berhasil menandai READY_FOR_PICKUP saat memiliki foto BEFORE dan AFTER lengkap", async () => {
      // Masukkan foto BEFORE dan AFTER
      mock.tables.bookingPhoto.push(
        {
          id: 751,
          bookingId: 500,
          type: "BEFORE",
          storageKey: "booking-photos/500/before.webp",
          uploadedById: 20,
          deletedAt: null,
        },
        {
          id: 752,
          bookingId: 500,
          type: "AFTER",
          storageKey: "booking-photos/500/after.webp",
          uploadedById: 20,
          deletedAt: null,
        }
      );

      const assignedMechanic = { id: 20, role: "MECHANIC", outletId: 1 };

      const readyBooking = await bookingsService.markBookingReady({
        actor: assignedMechanic,
        bookingId: 500,
      });

      expect(readyBooking.status).toBe("READY_FOR_PICKUP");
      expect(mock.tables.notification).toHaveLength(1);
      expect(mock.tables.notification[0].type).toBe("BOOKING_STATUS");
    });
  });

  describe("Inspeksi Odometer Aman", () => {
    it("menolak penurunan angka odometer kendaraan dengan 422 INVALID_ODOMETER", async () => {
      const assignedMechanic = { id: 20, role: "MECHANIC", outletId: 1 };

      // Angka terakhir kendaraan di DB adalah 40.000 km
      // Mekanik mencoba memasukkan 35.000 km -> ditolak
      await expect(
        bookingsService.updateInspection({
          actor: assignedMechanic,
          bookingId: 500,
          data: { odometerKm: 35000 },
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "INVALID_ODOMETER",
      });
    });

    it("memperbarui odometer dan catatan inspeksi staf secara valid", async () => {
      const assignedMechanic = { id: 20, role: "MECHANIC", outletId: 1 };

      const res = await bookingsService.updateInspection({
        actor: assignedMechanic,
        bookingId: 500,
        data: {
          odometerKm: 42500,
          staffNotes: "Ban depan kiri aus tipis, kampas rem masih aman",
        },
      });

      expect(mock.tables.vehicle[0].lastOdometerKm).toBe(42500);
      expect(res.odometerKm).toBe(42500);
      expect(res.staffNotes).toBe("Ban depan kiri aus tipis, kampas rem masih aman");
    });
  });
});
