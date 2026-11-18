import { DateTime } from "luxon";
// ==============================================================================
// TALLERO AUTO — REAL POSTGRESQL CONCURRENCY & SECURITY AUDIT TEST
// Memakai PostgreSQL Asli (TEST_DATABASE_URL), Tanpa Mock Prisma
// 20 Request Paralel × 10 Iterasi = 200 Transaksi Konkuren Real
// Sesuai AGENTS.md §4.16, §5, §8 & FASE 11B
// ==============================================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, pool } from "../../src/config/prisma.js";
import { createBooking, getBookingById } from "../../src/services/bookings.service.js";
import { handleMidtransNotification } from "../../src/services/payments.service.js";
import { hashPassword } from "../../src/utils/crypto.js";
import { NotFoundError, ForbiddenError } from "../../src/utils/errors.js";
import { resetTestDb } from "../helpers/db.js";

describe("Integration: Real PostgreSQL Concurrency & Security Proof", () => {
  const testDate = DateTime.now().setZone("Asia/Jakarta").plus({ days: 2 }).toISODate();
  let outlet;
  let service;
  let category;
  let customerA;
  let customerB;
  let vehicleA;
  let dbReady = false;
  const parallelCustomers = [];

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReady = true;
      await resetTestDb();
    } catch (error) {
      dbReady = false;
      throw error;
    }

    // 1. Setup Outlet dengan slotCapacity = 1 (Tepat 1 slot per jam)
    outlet = await prisma.outlet.create({
      data: {
        name: "Tallero Auto Concurrency Test Outlet",
        address: "Jl. Konkurensi No. 99",
        latitude: -6.2,
        longitude: 106.8,
        openDays: [1, 2, 3, 4, 5, 6, 7],
        openTime: "08:00",
        closeTime: "20:00",
        slotMinutes: 60,
        slotCapacity: 1, // Kapasitas ketat = 1
        timezone: "Asia/Jakarta",
        isActive: true,
      },
    });

    category = await prisma.category.create({
      data: { name: "Servis Rutin Test" },
    });

    service = await prisma.service.create({
      data: {
        categoryId: category.id,
        name: "Tune Up Standar Test",
        price: 250000,
        estimatedMinutes: 45,
        isActive: true,
      },
    });

    const pwdHash = await hashPassword("KuatPassword123!");

    customerA = await prisma.user.create({
      data: {
        name: "Customer A",
        email: "cust.a.real@tallero.test",
        passwordHash: pwdHash,
        phone: "+628110000001",
        role: "CUSTOMER",
        isActive: true,
        isVerified: true,
      },
    });

    customerB = await prisma.user.create({
      data: {
        name: "Customer B",
        email: "cust.b.real@tallero.test",
        passwordHash: pwdHash,
        phone: "+628110000002",
        role: "CUSTOMER",
        isActive: true,
        isVerified: true,
      },
    });

    vehicleA = await prisma.vehicle.create({
      data: {
        userId: customerA.id,
        plateNumber: "B1001AAA",
        brand: "Honda",
        model: "Civic",
        type: "CAR",
        year: 2022,
      },
    });

    await prisma.vehicle.create({
      data: {
        userId: customerB.id,
        plateNumber: "B1002BBB",
        brand: "Toyota",
        model: "Yaris",
        type: "CAR",
        year: 2023,
      },
    });

    // Buat 20 customer unik dan 20 kendaraan unik untuk stress test konkurensi
    for (let i = 1; i <= 20; i++) {
      const u = await prisma.user.create({
        data: {
          name: `Concurrent Customer ${i}`,
          email: `concurrent.cust${i}@tallero.test`,
          passwordHash: pwdHash,
          phone: `+62819000000${String(i).padStart(2, "0")}`,
          role: "CUSTOMER",
          isActive: true,
          isVerified: true,
        },
      });

      const v = await prisma.vehicle.create({
        data: {
          userId: u.id,
          plateNumber: `B${2000 + i}CC${i}`,
          brand: "Suzuki",
          model: "Swift",
          type: "CAR",
          year: 2021,
        },
      });

      parallelCustomers.push({ user: u, vehicle: v });
    }
  });

  afterAll(async () => {
    try {
      if (dbReady) await resetTestDb();
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
  });

  // ============================================================================
  // UJI 1: STRESS TEST KONKURENSI (20 REQUEST PARALEL × 10 ITERASI)
  // ============================================================================
  it("mencegah overbooking pada 20 request paralel yang diulang 10× berturut-turut pada PostgreSQL asli", async () => {
    if (!dbReady) return;
    // 10 slot waktu berbeda (jam 09:00 s.d 18:00) pada hari yang sama
    const testHours = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
    expect(testHours).toHaveLength(10);

    let totalWins = 0;
    let totalRejected = 0;

    for (let iter = 0; iter < testHours.length; iter++) {
      const hour = testHours[iter];
      const scheduledAtIso = `${testDate}T${String(hour).padStart(2, "0")}:00:00+07:00`;

      // 20 request paralel bersaing memperebutkan 1 kapasitas slot yang sama
      const promises = parallelCustomers.map((pc) =>
        createBooking({
          actor: pc.user,
          data: {
            outletId: outlet.id,
            vehicleId: pc.vehicle.id,
            scheduledAt: scheduledAtIso,
            items: [{ type: "SERVICE", serviceId: service.id, quantity: 1 }],
            customerNotes: `Concurrent attempt slot ${hour}:00`,
          },
        })
      );

      const results = await Promise.allSettled(promises);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // TEPAT 1 request yang berhasil menangkap slot
      expect(fulfilled).toHaveLength(1);
      // TEPAT 19 request yang kalah dan ditolak dengan 409 SLOT_FULL
      expect(rejected).toHaveLength(19);

      for (const rej of rejected) {
        expect(rej.reason.statusCode).toBe(409);
        expect(rej.reason.code).toBe("SLOT_FULL");
      }

      // Verifikasi di PostgreSQL: hanya ada tepat 1 booking tersimpan untuk slot ini
      const bookedInDb = await prisma.booking.count({
        where: {
          outletId: outlet.id,
          scheduledAt: new Date(scheduledAtIso),
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
        },
      });
      expect(bookedInDb).toBe(1);

      totalWins += fulfilled.length;
      totalRejected += rejected.length;

      // Bersihkan booking setelah iterasi agar tidak menabrak aturan '1 booking aktif per kendaraan'
      await prisma.bookingItem.deleteMany({});
      await prisma.bookingLog.deleteMany({});
      await prisma.booking.deleteMany({});
    }

    // Rekapitulasi 20 request × 10 iterasi = 200 request total
    expect(totalWins).toBe(10);
    expect(totalRejected).toBe(190);
  });

  // ============================================================================
  // UJI 2: PERTAHANAN IDOR BOOKING SCOPE DI POSTGRESQL ASLI
  // ============================================================================
  it("menegakkan pertahanan IDOR pada PostgreSQL asli: Customer B menerima 404 saat mengakses booking milik Customer A", async () => {
    if (!dbReady) return;
    // Customer A membuat 1 booking
    const bookingA = await createBooking({
      actor: customerA,
      data: {
        outletId: outlet.id,
        vehicleId: vehicleA.id,
        scheduledAt: `${testDate}T10:00:00+07:00`,
        items: [{ type: "SERVICE", serviceId: service.id, quantity: 1 }],
      },
    });

    expect(bookingA.id).toBeDefined();

    // Customer A membaca miliknya sendiri -> Sukses (200)
    const readByOwner = await getBookingById({ actor: customerA, bookingId: bookingA.id });
    expect(readByOwner.id).toBe(bookingA.id);

    // Customer B mencoba mengakses booking milik Customer A
    // AGENTS.md §4.10: Resource milik orang lain -> 404 NOT_FOUND (bukan 403)
    await expect(getBookingById({ actor: customerB, bookingId: bookingA.id })).rejects.toThrow(
      NotFoundError
    );

    // Bersihkan
    await prisma.bookingItem.deleteMany({});
    await prisma.bookingLog.deleteMany({});
    await prisma.booking.deleteMany({});
  });

  // ============================================================================
  // UJI 3: VERIFIKASI TANDA TANGAN WEBHOOK MIDTRANS
  // ============================================================================
  it("menolak webhook Midtrans dengan signature palsu (403 ForbiddenError)", async () => {
    if (!dbReady) return;
    // Siapkan booking & payment dummy
    const booking = await prisma.booking.create({
      data: {
        code: "TLR-20261117-FAKE01",
        customerId: customerA.id,
        outletId: outlet.id,
        vehicleId: vehicleA.id,
        scheduledAt: new Date("2026-11-17T11:00:00Z"),
        slotEndAt: new Date("2026-11-17T12:00:00Z"),
        status: "READY_FOR_PICKUP",
        total: 250000,
        paymentStatus: "UNPAID",
      },
    });

    const payment = await prisma.payment.create({
      data: {
        bookingId: booking.id,
        orderId: "INV-20261117-FAKE01",
        amount: 250000,
        status: "PENDING",
        type: "INVOICE",
        method: "MIDTRANS",
      },
    });

    // Webhook payload dengan signature palsu / tidak cocok
    const fakeWebhookPayload = {
      order_id: payment.orderId,
      status_code: "200",
      gross_amount: "250000.00",
      signature_key: "forged_invalid_signature_hash_hex_1234567890abcdef",
      transaction_status: "settlement",
    };

    // Wajib melempar ForbiddenError("Verifikasi tanda tangan webhook Midtrans gagal")
    await expect(handleMidtransNotification(fakeWebhookPayload)).rejects.toThrow(ForbiddenError);
  });
});
