import { DateTime } from "luxon";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../src/app.js";
import prisma from "../../src/config/prisma.js";
import * as mailService from "../../src/services/mail.service.js";
import { hashPassword } from "../../src/utils/crypto.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { resetTestDb } from "../helpers/db.js";

describe("Bookings API integration (/api/v1/bookings & /api/v1/outlets/:id/availability)", () => {
  const testDate = DateTime.now().setZone("Asia/Jakarta").plus({ days: 2 }).toISODate();
  let customerUser;
  let customerToken;
  let otherCustomer;
  let otherCustomerToken;
  let adminUser;
  let _adminToken;
  let outlet;
  let vehicleCar;
  let serviceCar;

  let dbReady = false;

  beforeAll(async () => {
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      dbReady = true;
      await resetTestDb();
    } catch (error) {
      dbReady = false;
      throw error;
    }
  });

  beforeEach(async () => {
    if (!dbReady) return;
    vi.restoreAllMocks();
    vi.spyOn(mailService, "sendMail").mockResolvedValue({ accepted: ["test"], driver: "console" });

    await resetTestDb();

    const passwordHash = await hashPassword("Password123");

    outlet = await prisma.outlet.create({
      data: {
        name: "Tallero Kebayoran",
        address: "Jl. Kyai Maja No. 12",
        latitude: -6.24,
        longitude: 106.79,
        openDays: [1, 2, 3, 4, 5, 6, 7],
        openTime: "08:00",
        closeTime: "17:00",
        slotMinutes: 60,
        slotCapacity: 2,
      },
    });

    customerUser = await prisma.user.create({
      data: {
        name: "Customer Satu",
        email: "customer1@tallero.test",
        passwordHash,
        phone: "+6281122334455",
        role: "CUSTOMER",
        isActive: true,
        isVerified: true,
      },
    });

    otherCustomer = await prisma.user.create({
      data: {
        name: "Customer Dua",
        email: "customer2@tallero.test",
        passwordHash,
        phone: "+6281122334456",
        role: "CUSTOMER",
        isActive: true,
        isVerified: true,
      },
    });

    adminUser = await prisma.user.create({
      data: {
        name: "Admin Bengkel",
        email: "admin.bengkel@tallero.test",
        passwordHash,
        phone: "+6281122334457",
        role: "ADMIN",
        isActive: true,
        isVerified: true,
      },
    });

    const category = await prisma.category.create({
      data: { name: "Servis Berkala" },
    });

    serviceCar = await prisma.service.create({
      data: {
        categoryId: category.id,
        name: "Servis 10.000 KM",
        price: 350000,
        estimatedMinutes: 60,
        vehicleType: "CAR",
      },
    });

    vehicleCar = await prisma.vehicle.create({
      data: {
        userId: customerUser.id,
        plateNumber: "B1234XYZ",
        activePlate: "B1234XYZ",
        brand: "Toyota",
        model: "Raize",
        type: "CAR",
        year: 2022,
      },
    });

    customerToken = signAccessToken({ userId: customerUser.id, role: "CUSTOMER", tokenVersion: 0 });
    otherCustomerToken = signAccessToken({
      userId: otherCustomer.id,
      role: "CUSTOMER",
      tokenVersion: 0,
    });
    _adminToken = signAccessToken({ userId: adminUser.id, role: "ADMIN", tokenVersion: 0 });
  });

  afterAll(async () => {
    try {
      if (dbReady) await resetTestDb();
    } finally {
      await prisma.$disconnect();
    }
  });

  it("checks availability, creates booking, retrieves QR, and cancels successfully", async () => {
    if (!dbReady) return;
    // 1. Cek availability slot
    const availRes = await request(app)
      .get(`/api/v1/outlets/${outlet.id}/availability?date=${testDate}&serviceIds=${serviceCar.id}`)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(availRes.status).toBe(200);
    expect(availRes.body.data.slots.length).toBeGreaterThan(0);
    expect(availRes.body.data.totalEstimatedMinutes).toBe(60);

    // 2. Buat booking baru
    const createRes = await request(app)
      .post("/api/v1/bookings")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        outletId: outlet.id,
        vehicleId: vehicleCar.id,
        scheduledAt: `${testDate}T10:00:00+07:00`,
        items: [{ type: "SERVICE", serviceId: serviceCar.id, quantity: 1 }],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.code).toMatch(
      new RegExp(`^TLR-${testDate.replaceAll("-", "")}-[A-Z0-9]{6}$`)
    );
    expect(createRes.body.data.total).toBe(350000);
    const bookingId = createRes.body.data.id;

    // 3. Ambil QR code check-in
    const qrRes = await request(app)
      .get(`/api/v1/bookings/${bookingId}/qr`)
      .set("Authorization", `Bearer ${customerToken}`);

    expect(qrRes.status).toBe(200);
    expect(qrRes.body.data.qrPayload).toMatch(/\.[a-f0-9]{16}$/);

    // 4. Customer lain tidak bisa melihat QR / booking -> 404
    const idorRes = await request(app)
      .get(`/api/v1/bookings/${bookingId}`)
      .set("Authorization", `Bearer ${otherCustomerToken}`);
    expect(idorRes.status).toBe(404);

    // 5. Batalkan booking oleh customer
    const cancelRes = await request(app)
      .post(`/api/v1/bookings/${bookingId}/cancel`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ reason: "Perubahan rencana" });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe("CANCELLED");
  });
});
