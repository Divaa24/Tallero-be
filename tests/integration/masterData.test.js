import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../src/app.js";
import prisma, { withDeleted } from "../../src/config/prisma.js";
import * as mailService from "../../src/services/mail.service.js";
import { hashPassword } from "../../src/utils/crypto.js";
import { signAccessToken } from "../../src/utils/jwt.js";

/**
 * Integration tests Fase 3 terhadap PostgreSQL test database (TEST_DATABASE_URL).
 */
describe("Fase 3 Master Data & Vehicles Integration", () => {
  let adminUser;
  let customerA;
  let customerB;
  let mechanicUser;
  let outlet;
  let adminToken;
  let customerAToken;
  let customerBToken;
  let mechanicToken;

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(mailService, "sendMail").mockResolvedValue({ accepted: ["test"], driver: "console" });

    await withDeleted.$transaction([
      withDeleted.auditLog.deleteMany({}),
      withDeleted.bookingItem.deleteMany({}),
      withDeleted.booking.deleteMany({}),
      withDeleted.vehicle.deleteMany({}),
      withDeleted.sparepart.deleteMany({}),
      withDeleted.service.deleteMany({}),
      withDeleted.category.deleteMany({}),
      withDeleted.outletClosure.deleteMany({}),
      withDeleted.refreshToken.deleteMany({}),
      withDeleted.user.deleteMany({}),
      withDeleted.outlet.deleteMany({}),
    ]);

    const passwordHash = await hashPassword("Password123");

    outlet = await prisma.outlet.create({
      data: {
        name: "Tallero Pusat",
        address: "Jl. Gatot Subroto No. 1",
        latitude: -6.22,
        longitude: 106.82,
        openDays: [1, 2, 3, 4, 5, 6],
        openTime: "08:00",
        closeTime: "17:00",
        slotMinutes: 60,
        slotCapacity: 3,
      },
    });

    adminUser = await prisma.user.create({
      data: {
        name: "Admin Utama",
        email: "admin.master@tallero.test",
        passwordHash,
        phone: "+628111111101",
        role: "ADMIN",
        isActive: true,
        isVerified: true,
      },
    });

    mechanicUser = await prisma.user.create({
      data: {
        name: "Mekanik Budi",
        email: "mech.master@tallero.test",
        passwordHash,
        phone: "+628111111102",
        role: "MECHANIC",
        outletId: outlet.id,
        isActive: true,
        isVerified: true,
      },
    });

    customerA = await prisma.user.create({
      data: {
        name: "Pelanggan A",
        email: "cust.a@tallero.test",
        passwordHash,
        phone: "+628111111103",
        role: "CUSTOMER",
        isActive: true,
        isVerified: true,
      },
    });

    customerB = await prisma.user.create({
      data: {
        name: "Pelanggan B",
        email: "cust.b@tallero.test",
        passwordHash,
        phone: "+628111111104",
        role: "CUSTOMER",
        isActive: true,
        isVerified: true,
      },
    });

    adminToken = signAccessToken({ userId: adminUser.id, role: "ADMIN", tokenVersion: 0 });
    mechanicToken = signAccessToken({ userId: mechanicUser.id, role: "MECHANIC", tokenVersion: 0 });
    customerAToken = signAccessToken({ userId: customerA.id, role: "CUSTOMER", tokenVersion: 0 });
    customerBToken = signAccessToken({ userId: customerB.id, role: "CUSTOMER", tokenVersion: 0 });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("enforces vehicle IDOR 404, plate uniqueness, and plate reuse after soft delete", async () => {
    const createRes = await request(app)
      .post("/api/v1/vehicles")
      .set("Authorization", `Bearer ${customerAToken}`)
      .send({
        plateNumber: "B 7777 TLL",
        brand: "Toyota",
        model: "Innova",
        type: "CAR",
        year: 2022,
      });
    expect(createRes.status).toBe(201);
    const vehicleId = createRes.body.data.id;
    expect(createRes.body.data.plateNumber).toBe("B7777TLL");

    // Duplicate active plate rejected
    const dupRes = await request(app)
      .post("/api/v1/vehicles")
      .set("Authorization", `Bearer ${customerBToken}`)
      .send({
        plateNumber: "B7777TLL",
        brand: "Honda",
        model: "CRV",
        type: "CAR",
        year: 2023,
      });
    expect(dupRes.status).toBe(409);

    // IDOR: Customer B cannot access or mutate Customer A's vehicle -> 404
    const idorGet = await request(app)
      .get(`/api/v1/vehicles/${vehicleId}`)
      .set("Authorization", `Bearer ${customerBToken}`);
    expect(idorGet.status).toBe(404);

    // Soft delete frees plate so Customer B can register it
    const delRes = await request(app)
      .delete(`/api/v1/vehicles/${vehicleId}`)
      .set("Authorization", `Bearer ${customerAToken}`);
    expect(delRes.status).toBe(200);

    const reuseRes = await request(app)
      .post("/api/v1/vehicles")
      .set("Authorization", `Bearer ${customerBToken}`)
      .send({
        plateNumber: "B7777TLL",
        brand: "Honda",
        model: "CRV",
        type: "CAR",
        year: 2023,
      });
    expect(reuseRes.status).toBe(201);
  });

  it("keeps BookingItem snapshot price isolated when service price updates and logs audit", async () => {
    const catRes = await request(app)
      .post("/api/v1/admin/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Tune Up" });
    const categoryId = catRes.body.data.id;

    const svcRes = await request(app)
      .post("/api/v1/admin/services")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Tune Up Injeksi",
        price: 250000,
        estimatedMinutes: 60,
        vehicleType: "CAR",
      });
    const serviceId = svcRes.body.data.id;

    const vehicle = await prisma.vehicle.create({
      data: {
        userId: customerA.id,
        plateNumber: "B1111AAA",
        activePlate: "B1111AAA",
        brand: "Suzuki",
        model: "Ertiga",
        type: "CAR",
        year: 2020,
      },
    });

    const booking = await prisma.booking.create({
      data: {
        code: "BK-SNAP-001",
        customerId: customerA.id,
        outletId: outlet.id,
        vehicleId: vehicle.id,
        scheduledAt: new Date(Date.now() + 86400000),
        slotEndAt: new Date(Date.now() + 90000000),
        status: "PENDING",
        total: 250000,
      },
    });

    const item = await prisma.bookingItem.create({
      data: {
        bookingId: booking.id,
        type: "SERVICE",
        serviceId,
        nameSnapshot: "Tune Up Injeksi",
        unitPrice: 250000,
        quantity: 1,
        subtotal: 250000,
        source: "CUSTOMER_BOOKING",
        approvalStatus: "APPROVED",
        requestedById: customerA.id,
      },
    });

    // Reject delete when active booking exists
    const delBlocked = await request(app)
      .delete(`/api/v1/admin/services/${serviceId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(delBlocked.status).toBe(409);

    // Update price -> old BookingItem remains 250000 and audit log captures price diff
    const patchRes = await request(app)
      .patch(`/api/v1/admin/services/${serviceId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ price: 325000 });
    expect(patchRes.status).toBe(200);

    const storedItem = await prisma.bookingItem.findUnique({ where: { id: item.id } });
    expect(storedItem.unitPrice).toBe(250000);
    expect(storedItem.subtotal).toBe(250000);

    const auditRes = await request(app)
      .get("/api/v1/admin/audit-logs?action=SERVICE_PRICE_UPDATED")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.data).toHaveLength(1);
    expect(auditRes.body.data[0].before.price).toBe(250000);
    expect(auditRes.body.data[0].after.price).toBe(325000);
  });

  it("masks sparepart numeric stock from customers, blocks admin self-delete, and audits staff adjustments", async () => {
    const partRes = await request(app)
      .post("/api/v1/admin/spareparts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "BUSI-IR", name: "Busi Iridium", price: 95000, stock: 10, unit: "pcs" });
    expect(partRes.status).toBe(201);
    const partId = partRes.body.data.id;

    const custParts = await request(app)
      .get("/api/v1/spareparts")
      .set("Authorization", `Bearer ${customerAToken}`);
    expect(custParts.status).toBe(200);
    expect(custParts.body.data[0].inStock).toBe(true);
    expect(custParts.body.data[0].stock).toBeUndefined();

    const mechParts = await request(app)
      .get("/api/v1/spareparts")
      .set("Authorization", `Bearer ${mechanicToken}`);
    expect(mechParts.status).toBe(200);
    expect(mechParts.body.data[0].stock).toBe(10);

    const badAdj = await request(app)
      .post(`/api/v1/admin/spareparts/${partId}/adjust-stock`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ delta: -11, reason: "Melebihi stok" });
    expect(badAdj.status).toBe(422);

    const goodAdj = await request(app)
      .post(`/api/v1/admin/spareparts/${partId}/adjust-stock`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ delta: -3, reason: "Koreksi opname" });
    expect(goodAdj.status).toBe(200);
    expect(goodAdj.body.data.stock).toBe(7);

    // Admin cannot delete self
    const selfDel = await request(app)
      .delete(`/api/v1/admin/users/${adminUser.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(selfDel.status).toBe(409);
  });
});
