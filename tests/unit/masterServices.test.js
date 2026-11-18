import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockWithDeleted, storeRef } = vi.hoisted(() => {
  const ref = { current: null };
  const models = [
    "user",
    "refreshToken",
    "outlet",
    "outletClosure",
    "category",
    "service",
    "sparepart",
    "vehicle",
    "booking",
    "bookingItem",
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
  const buildClient = (useRaw) => {
    const client = {};
    for (const model of models) {
      client[model] = {};
      for (const method of methods) {
        client[model][method] = (...args) =>
          ref.current[useRaw ? "raw" : "soft"][model][method](...args);
      }
    }
    client.$transaction = async (fn) => fn(client);
    return client;
  };
  return {
    storeRef: ref,
    mockPrisma: buildClient(false),
    mockWithDeleted: buildClient(true),
  };
});

vi.mock("../../src/config/prisma.js", () => ({
  default: mockPrisma,
  prisma: mockPrisma,
  withDeleted: mockWithDeleted,
  lockOutlet: vi.fn(),
  lockCustomer: vi.fn(),
  lockBooking: vi.fn(),
  lockInvoices: vi.fn(),
}));

import * as mailService from "../../src/services/mail.service.js";
import * as usersService from "../../src/services/users.service.js";
import * as outletsService from "../../src/services/outlets.service.js";
import * as catalogService from "../../src/services/catalog.service.js";
import * as catalogCategories from "../../src/services/catalogCategories.service.js";
import * as sparepartsService from "../../src/services/spareparts.service.js";
import * as vehiclesService from "../../src/services/vehicles.service.js";
import * as auditService from "../../src/services/audit.service.js";

const createMasterMockStore = () => {
  let seq = 1;
  const tables = {
    user: [],
    refreshToken: [],
    outlet: [],
    outletClosure: [],
    category: [],
    service: [],
    sparepart: [],
    vehicle: [],
    booking: [],
    bookingItem: [],
    serviceReminder: [],
    auditLog: [],
  };

  const softModels = new Set(["user", "outlet", "category", "service", "sparepart", "vehicle"]);

  const matches = (row, where = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (k === "OR" && Array.isArray(v)) return v.some((sub) => matches(row, sub));
      if (k === "AND" && Array.isArray(v)) return v.every((sub) => matches(row, sub));
      if (k === "service" && v && typeof v === "object") {
        const svc = tables.service.find((s) => s.id === row.serviceId);
        return svc ? matches(svc, v) : false;
      }
      if (k === "booking" && v && typeof v === "object") {
        const bk = tables.booking.find((b) => b.id === row.bookingId);
        return bk ? matches(bk, v) : false;
      }
      if (k === "category" && v && typeof v === "object") {
        const cat = tables.category.find((c) => c.id === row.categoryId);
        return cat ? matches(cat, v) : false;
      }
      if (v && typeof v === "object" && !(v instanceof Date)) {
        if ("in" in v) return v.in.includes(row[k]);
        if ("not" in v) return row[k] !== v.not;
        if ("gte" in v) return row[k] >= v.gte;
        if ("gt" in v) return row[k] > v.gt;
        if ("lte" in v) return row[k] <= v.lte;
        if ("contains" in v) {
          return String(row[k] ?? "")
            .toLowerCase()
            .includes(String(v.contains).toLowerCase());
        }
        if ("equals" in v) {
          return String(row[k] ?? "").toLowerCase() === String(v.equals).toLowerCase();
        }
      }
      return row[k] === v;
    });

  const hydrate = (tableName, row) => {
    const clone = { ...row };
    if (tableName === "user" && row.outletId) {
      const outlet = tables.outlet.find((o) => o.id === row.outletId);
      clone.outlet = outlet ? { id: outlet.id, name: outlet.name } : null;
    }
    if (tableName === "service") {
      const cat = tables.category.find((c) => c.id === row.categoryId);
      clone.category = cat ? { id: cat.id, name: cat.name } : null;
    }
    if (tableName === "auditLog" && row.actorId) {
      const actor = tables.user.find((u) => u.id === row.actorId);
      clone.actor = actor
        ? { id: actor.id, name: actor.name, email: actor.email, role: actor.role }
        : null;
    }
    if (tableName === "outlet") {
      clone.closures = tables.outletClosure.filter((c) => c.outletId === row.id);
    }
    return clone;
  };

  const makeApi = (tableName, respectSoftDelete) => {
    const rows = tables[tableName];
    const isSoft = softModels.has(tableName) && respectSoftDelete;
    const activeRows = () => (isSoft ? rows.filter((r) => r.deletedAt === null) : rows);

    return {
      findMany: async ({ where } = {}) =>
        activeRows()
          .filter((r) => matches(r, where))
          .map((r) => hydrate(tableName, r)),
      findFirst: async ({ where } = {}) => {
        const found = activeRows().find((r) => matches(r, where));
        return found ? hydrate(tableName, found) : null;
      },
      findUnique: async ({ where } = {}) => {
        const found = activeRows().find((r) => matches(r, where));
        return found ? hydrate(tableName, found) : null;
      },
      count: async ({ where } = {}) => activeRows().filter((r) => matches(r, where)).length,
      create: async ({ data }) => {
        const row = {
          id: seq++,
          deletedAt: null,
          isActive: true,
          tokenVersion: 0,
          mustChangePassword: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        rows.push(row);
        return hydrate(tableName, row);
      },
      update: async ({ where, data }) => {
        const found = activeRows().find((r) => matches(r, where));
        if (!found) throw new Error(`Record not found in ${tableName}`);
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in v) {
            found[k] = (found[k] ?? 0) + v.increment;
          } else {
            found[k] = v;
          }
        }
        found.updatedAt = new Date();
        return hydrate(tableName, found);
      },
      updateMany: async ({ where, data }) => {
        const list = activeRows().filter((r) => matches(r, where));
        for (const row of list) {
          for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === "object" && "increment" in v) {
              row[k] = (row[k] ?? 0) + v.increment;
            } else {
              row[k] = v;
            }
          }
        }
        return { count: list.length };
      },
      delete: async ({ where }) => {
        const idx = activeRows().findIndex((r) => matches(r, where));
        if (idx === -1) throw new Error(`Record not found in ${tableName}`);
        const target = activeRows()[idx];
        if (softModels.has(tableName)) {
          target.deletedAt = new Date();
          if (tableName === "vehicle") target.activePlate = null;
          return hydrate(tableName, target);
        }
        const realIdx = rows.indexOf(target);
        rows.splice(realIdx, 1);
        return hydrate(tableName, target);
      },
    };
  };

  return { tables, makeApi };
};

const wireStore = (store) => {
  const soft = {};
  const raw = {};
  for (const name of Object.keys(store.tables)) {
    soft[name] = store.makeApi(name, true);
    raw[name] = store.makeApi(name, false);
  }
  storeRef.current = { soft, raw };
};

describe("Fase 3 master data services & business guards", () => {
  let store;

  beforeEach(() => {
    vi.restoreAllMocks();
    store = createMasterMockStore();
    wireStore(store);
    vi.spyOn(mailService, "sendMail").mockResolvedValue({ accepted: ["test"], driver: "console" });

    store.tables.user.push(
      {
        id: 1,
        name: "Super Admin",
        email: "admin@tallero.test",
        phone: "+628111111111",
        role: "ADMIN",
        outletId: null,
        isActive: true,
        isVerified: true,
        mustChangePassword: false,
        tokenVersion: 0,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 2,
        name: "Budi Customer",
        email: "budi@example.com",
        phone: "+628122222222",
        role: "CUSTOMER",
        outletId: null,
        isActive: true,
        isVerified: true,
        mustChangePassword: false,
        tokenVersion: 0,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 3,
        name: "Sari Customer",
        email: "sari@example.com",
        phone: "+628133333333",
        role: "CUSTOMER",
        outletId: null,
        isActive: true,
        isVerified: true,
        mustChangePassword: false,
        tokenVersion: 0,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    );
    store.tables.outlet.push({
      id: 10,
      name: "Tallero Kemang",
      address: "Jl. Kemang Raya No. 1",
      latitude: -6.26,
      longitude: 106.81,
      openDays: [1, 2, 3, 4, 5, 6],
      openTime: "08:00",
      closeTime: "17:00",
      slotMinutes: 60,
      slotCapacity: 3,
      timezone: "Asia/Jakarta",
      isActive: true,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("manages staff creation, self/last-admin guards, tokenVersion revocation, and restore", async () => {
    const adminActor = { id: 1, role: "ADMIN" };

    // Last active admin cannot delete, deactivate, or demote self
    await expect(
      usersService.softDeleteUser({ actor: adminActor, userId: 1, ip: "127.0.0.1" })
    ).rejects.toMatchObject({ statusCode: 409, code: "SELF_ACTION_FORBIDDEN" });
    await expect(
      usersService.updateUserStatus({
        actor: adminActor,
        userId: 1,
        isActive: false,
        ip: "127.0.0.1",
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "SELF_ACTION_FORBIDDEN" });

    // Create second admin + mechanic
    const secondAdmin = await usersService.createStaff({
      actor: adminActor,
      data: {
        name: "Admin 2",
        email: "admin2@tallero.test",
        phone: "+628144444444",
        role: "ADMIN",
      },
      ip: "127.0.0.1",
    });
    expect(secondAdmin.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    expect(secondAdmin.user.mustChangePassword).toBe(true);

    // Another admin trying to delete only remaining active admin after deactivation is blocked
    const mech = await usersService.createStaff({
      actor: adminActor,
      data: {
        name: "Mekanik Andi",
        email: "andi@tallero.test",
        phone: "+628155555555",
        role: "MECHANIC",
        outletId: 10,
      },
      ip: "127.0.0.1",
    });
    expect(mech.user.outletId).toBe(10);

    store.tables.refreshToken.push({
      id: 99,
      userId: mech.user.id,
      tokenHash: "abc",
      familyId: "fam",
      revokedAt: null,
    });

    await usersService.updateUserStatus({
      actor: adminActor,
      userId: mech.user.id,
      isActive: false,
      ip: "127.0.0.1",
    });

    const mechRow = store.tables.user.find((u) => u.id === mech.user.id);
    expect(mechRow.tokenVersion).toBe(1);
    expect(store.tables.refreshToken[0].revokedAt).toBeInstanceOf(Date);

    // Soft-delete and restore mechanic
    await usersService.softDeleteUser({ actor: adminActor, userId: mech.user.id, ip: "127.0.0.1" });
    expect(store.tables.user.find((u) => u.id === mech.user.id).deletedAt).toBeInstanceOf(Date);

    const restored = await usersService.restoreUser({
      actor: adminActor,
      userId: mech.user.id,
      ip: "127.0.0.1",
    });
    expect(restored.deletedAt).toBeNull();
    expect(restored.isActive).toBe(true);
  });

  it("rejects deleting outlet, service, sparepart, and vehicle when active bookings exist", async () => {
    const adminActor = { id: 1, role: "ADMIN" };
    const budiActor = { id: 2, role: "CUSTOMER" };

    const cat = await catalogCategories.createCategory({
      actor: adminActor,
      data: { name: "Servis Rutin" },
      ip: "127.0.0.1",
    });
    const svc = await catalogService.createService({
      actor: adminActor,
      data: {
        categoryId: cat.id,
        name: "Ganti Oli Mesin",
        price: 150000,
        estimatedMinutes: 45,
        vehicleType: null,
      },
      ip: "127.0.0.1",
    });
    const part = await sparepartsService.createSparepart({
      actor: adminActor,
      data: { sku: "OLI-001", name: "Oli Sintetik 1L", price: 120000, stock: 5, unit: "botol" },
      ip: "127.0.0.1",
    });
    const vehicle = await vehiclesService.createVehicle({
      actor: budiActor,
      data: { plateNumber: "B1234XYZ", brand: "Toyota", model: "Avanza", type: "CAR", year: 2021 },
    });

    // Active booking & snapshot item referencing these entities
    const bookingId = 500;
    store.tables.booking.push({
      id: bookingId,
      outletId: 10,
      vehicleId: vehicle.id,
      status: "IN_PROGRESS",
    });
    store.tables.bookingItem.push({
      id: 501,
      bookingId,
      type: "SERVICE",
      serviceId: svc.id,
      sparepartId: null,
      nameSnapshot: "Ganti Oli Mesin",
      unitPrice: 150000,
      quantity: 1,
      subtotal: 150000,
    });
    store.tables.bookingItem.push({
      id: 502,
      bookingId,
      type: "SPAREPART",
      serviceId: null,
      sparepartId: part.id,
      nameSnapshot: "Oli Sintetik 1L",
      unitPrice: 120000,
      quantity: 1,
      subtotal: 120000,
    });

    await expect(
      outletsService.softDeleteOutlet({ actor: adminActor, outletId: 10, ip: "127.0.0.1" })
    ).rejects.toMatchObject({ statusCode: 409, code: "ACTIVE_BOOKING_EXISTS" });

    await expect(
      catalogService.softDeleteService({ actor: adminActor, serviceId: svc.id, ip: "127.0.0.1" })
    ).rejects.toMatchObject({ statusCode: 409, code: "ACTIVE_BOOKING_EXISTS" });

    await expect(
      sparepartsService.softDeleteSparepart({
        actor: adminActor,
        sparepartId: part.id,
        ip: "127.0.0.1",
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "ACTIVE_BOOKING_EXISTS" });

    await expect(
      vehiclesService.deleteVehicle({ actor: budiActor, vehicleId: vehicle.id })
    ).rejects.toMatchObject({ statusCode: 409, code: "ACTIVE_BOOKING_EXISTS" });

    // Service price update records audit log AND does not mutate existing BookingItem snapshot
    await catalogService.updateService({
      actor: adminActor,
      serviceId: svc.id,
      data: { price: 185000 },
      ip: "127.0.0.1",
    });
    expect(store.tables.bookingItem[0].unitPrice).toBe(150000);
    expect(store.tables.bookingItem[0].subtotal).toBe(150000);
    const logs = await auditService.listAuditLogs({ query: { action: "SERVICE_PRICE_UPDATED" } });
    expect(logs.items).toHaveLength(1);
    expect(logs.items[0].before.price).toBe(150000);
    expect(logs.items[0].after.price).toBe(185000);
  });

  it("hides sparepart numeric stock from customers and enforces non-negative audited stock adjustment", async () => {
    const adminActor = { id: 1, role: "ADMIN" };
    const part = await sparepartsService.createSparepart({
      actor: adminActor,
      data: { sku: "FILTER-01", name: "Filter Udara", price: 85000, stock: 3, unit: "pcs" },
      ip: "127.0.0.1",
    });

    const customerList = await sparepartsService.listSpareparts({
      actor: { id: 2, role: "CUSTOMER" },
      query: {},
    });
    expect(customerList.items[0]).toEqual({
      id: part.id,
      sku: "FILTER-01",
      name: "Filter Udara",
      price: 85000,
      unit: "pcs",
      inStock: true,
    });
    expect(customerList.items[0].stock).toBeUndefined();

    const mechList = await sparepartsService.listSpareparts({
      actor: { id: 4, role: "MECHANIC" },
      query: {},
    });
    expect(mechList.items[0].stock).toBe(3);

    await expect(
      sparepartsService.adjustSparepartStock({
        actor: adminActor,
        sparepartId: part.id,
        delta: -4,
        reason: "Keluar berlebih",
        ip: "127.0.0.1",
      })
    ).rejects.toMatchObject({ statusCode: 422, code: "INSUFFICIENT_STOCK" });

    const adjusted = await sparepartsService.adjustSparepartStock({
      actor: adminActor,
      sparepartId: part.id,
      delta: -2,
      reason: "Stock opname gudang",
      ip: "127.0.0.1",
    });
    expect(adjusted.stock).toBe(1);
  });

  it("prevents vehicle IDOR with 404 and frees license plate after soft delete", async () => {
    const budi = { id: 2, role: "CUSTOMER" };
    const sari = { id: 3, role: "CUSTOMER" };

    const car = await vehiclesService.createVehicle({
      actor: budi,
      data: { plateNumber: "B9999TLL", brand: "Honda", model: "Jazz", type: "CAR", year: 2020 },
    });

    // Active duplicate plate fails
    await expect(
      vehiclesService.createVehicle({
        actor: sari,
        data: { plateNumber: "B9999TLL", brand: "Honda", model: "Brio", type: "CAR", year: 2023 },
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "PLATE_ALREADY_EXISTS" });

    // Sari cannot view, update, delete, or read reminders/history of Budi's vehicle -> 404
    await expect(
      vehiclesService.getMyVehicleById({ actor: sari, vehicleId: car.id })
    ).rejects.toMatchObject({ statusCode: 404, code: "VEHICLE_NOT_FOUND" });
    await expect(
      vehiclesService.updateVehicle({ actor: sari, vehicleId: car.id, data: { color: "Merah" } })
    ).rejects.toMatchObject({ statusCode: 404, code: "VEHICLE_NOT_FOUND" });
    await expect(
      vehiclesService.deleteVehicle({ actor: sari, vehicleId: car.id })
    ).rejects.toMatchObject({ statusCode: 404, code: "VEHICLE_NOT_FOUND" });
    await expect(
      vehiclesService.getVehicleReminders({ actor: sari, vehicleId: car.id, query: {} })
    ).rejects.toMatchObject({ statusCode: 404, code: "VEHICLE_NOT_FOUND" });

    // Mechanic read-only access to /history returns empty structure
    const mechHist = await vehiclesService.getVehicleHistory({
      actor: { id: 4, role: "MECHANIC" },
      vehicleId: car.id,
      query: {},
    });
    expect(mechHist.data).toMatchObject({
      vehicle: { id: car.id, plateNumber: "B9999TLL" },
      items: [],
    });

    // Budi soft deletes car -> activePlate cleared -> Sari can now register B9999TLL
    await vehiclesService.deleteVehicle({ actor: budi, vehicleId: car.id });
    const reRegistered = await vehiclesService.createVehicle({
      actor: sari,
      data: { plateNumber: "B9999TLL", brand: "Honda", model: "Brio", type: "CAR", year: 2023 },
    });
    expect(reRegistered.plateNumber).toBe("B9999TLL");
  });

  it("supports marketing fields on services (badge, imageUrl, checklist) and managerName on outlets", async () => {
    const adminActor = { id: 1, role: "ADMIN" };

    // 1. Outlet dengan managerName
    const outlet = await outletsService.createOutlet({
      actor: adminActor,
      data: {
        name: "Cabang Utama Depok",
        address: "Jl. Margonda Raya No. 120",
        phone: "021-77889900",
        managerName: "Budi Santoso",
        latitude: -6.37,
        longitude: 106.83,
        openDays: [1, 2, 3, 4, 5, 6],
        openTime: "08:00",
        closeTime: "17:00",
        slotMinutes: 60,
        slotCapacity: 5,
        timezone: "Asia/Jakarta",
      },
      ip: "127.0.0.1",
    });
    expect(outlet.managerName).toBe("Budi Santoso");

    const publicOutlet = await outletsService.getPublicOutletById({ outletId: outlet.id });
    expect(publicOutlet.managerName).toBe("Budi Santoso");

    // 2. Service dengan badge, imageUrl, dan checklist
    const cat = await catalogCategories.createCategory({
      actor: adminActor,
      data: { name: "Paket Perawatan" },
      ip: "127.0.0.1",
    });

    const service = await catalogService.createService({
      actor: adminActor,
      data: {
        categoryId: cat.id,
        name: "Servis Berkala & Tune Up 3D",
        description: "Paket lengkap servis berkala",
        badge: "TERLARIS",
        imageUrl: "https://images.unsplash.com/photo-1486262715619-67b85e0b08d3",
        checklist: ["Scan OBD2", "Bersih Ruang Bakar", "Ganti Busi"],
        price: 550000,
        estimatedMinutes: 90,
      },
      ip: "127.0.0.1",
    });
    expect(service.badge).toBe("TERLARIS");
    expect(service.imageUrl).toBe("https://images.unsplash.com/photo-1486262715619-67b85e0b08d3");
    expect(service.checklist).toEqual(["Scan OBD2", "Bersih Ruang Bakar", "Ganti Busi"]);

    const publicSvc = await catalogService.getPublicServiceById({ serviceId: service.id });
    expect(publicSvc.badge).toBe("TERLARIS");
    expect(publicSvc.imageUrl).toBe("https://images.unsplash.com/photo-1486262715619-67b85e0b08d3");
    expect(publicSvc.checklist).toEqual(["Scan OBD2", "Bersih Ruang Bakar", "Ganti Busi"]);

    // Update marketing fields
    const updatedSvc = await catalogService.updateService({
      actor: adminActor,
      serviceId: service.id,
      data: {
        badge: "PROMO",
        price: 500000,
      },
      ip: "127.0.0.1",
    });
    expect(updatedSvc.badge).toBe("PROMO");
    expect(updatedSvc.price).toBe(500000);
  });
});
