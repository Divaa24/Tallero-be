import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma, withDeleted, lockOutlet, pool } from "../../src/config/prisma.js";
import { hashPassword } from "../../src/utils/crypto.js";
import { seedInitialAdmin } from "../../prisma/seed.js";
import { resetTestDb } from "../helpers/db.js";

describe("Integration: Soft-Delete, Global Omit, lockOutlet & Seed (PostgreSQL)", () => {
  let dbReady = false;

  beforeAll(async () => {
    try {
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
    await resetTestDb();
  });

  afterAll(async () => {
    try {
      if (dbReady) {
        await resetTestDb();
      }
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
  });

  it("find tidak mengembalikan record yang di-soft-delete, delete menjadi update, dan withDeleted bisa melihat", async () => {
    if (!dbReady) return;
    const passwordHash = await hashPassword("PasswordKuat123!");
    const user = await prisma.user.create({
      data: {
        name: "Budi Santoso",
        email: "budi.softdelete@tallero.test",
        passwordHash,
        phone: "+6281234567890",
        role: "CUSTOMER",
        isActive: true,
        isVerified: true,
      },
    });

    expect(user.passwordHash).toBeUndefined();

    const deleted = await prisma.user.delete({ where: { id: user.id } });
    expect(deleted.deletedAt).toBeInstanceOf(Date);

    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.user.findFirst({ where: { email: user.email } })).toBeNull();
    await expect(prisma.user.findFirstOrThrow({ where: { id: user.id } })).rejects.toThrow();
    expect(await prisma.user.findMany({ where: { id: user.id } })).toHaveLength(0);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);

    const agg = await prisma.user.aggregate({
      where: { id: user.id },
      _count: { _all: true },
    });
    expect(agg._count._all).toBe(0);

    const grouped = await prisma.user.groupBy({
      by: ["role"],
      where: { id: user.id },
    });
    expect(grouped).toHaveLength(0);

    const fromWithDeleted = await withDeleted.user.findUnique({ where: { id: user.id } });
    expect(fromWithDeleted).not.toBeNull();
    expect(fromWithDeleted.id).toBe(user.id);
    expect(fromWithDeleted.deletedAt).toBeInstanceOf(Date);
    expect(fromWithDeleted.passwordHash).toBeUndefined();

    const withSecret = await withDeleted.user.findUnique({
      where: { id: user.id },
      omit: { passwordHash: false },
    });
    expect(withSecret.passwordHash).toBe(passwordHash);
  });

  it("Vehicle.activePlate membebaskan plat nomor setelah soft-delete sehingga dapat didaftarkan kembali", async () => {
    if (!dbReady) return;
    const owner = await prisma.user.create({
      data: {
        name: "Siti Rahma",
        email: "siti.vehicle@tallero.test",
        passwordHash: await hashPassword("PasswordKuat123!"),
        phone: "+6281234567891",
      },
    });

    const v1 = await prisma.vehicle.create({
      data: {
        userId: owner.id,
        plateNumber: "B1234XYZ",
        activePlate: "B1234XYZ",
        brand: "Toyota",
        model: "Avanza",
        type: "CAR",
        year: 2022,
      },
    });

    await expect(
      prisma.vehicle.create({
        data: {
          userId: owner.id,
          plateNumber: "B1234XYZ",
          activePlate: "B1234XYZ",
          brand: "Honda",
          model: "Brio",
          type: "CAR",
          year: 2023,
        },
      })
    ).rejects.toThrow();

    const softDeletedV1 = await prisma.vehicle.delete({ where: { id: v1.id } });
    expect(softDeletedV1.deletedAt).toBeInstanceOf(Date);
    expect(softDeletedV1.activePlate).toBeNull();

    const v2 = await prisma.vehicle.create({
      data: {
        userId: owner.id,
        plateNumber: "B1234XYZ",
        activePlate: "B1234XYZ",
        brand: "Honda",
        model: "Brio",
        type: "CAR",
        year: 2023,
      },
    });

    expect(v2.id).not.toBe(v1.id);
    expect(v2.activePlate).toBe("B1234XYZ");
    expect(await prisma.vehicle.count({ where: { plateNumber: "B1234XYZ" } })).toBe(1);
    expect(await withDeleted.vehicle.count({ where: { plateNumber: "B1234XYZ" } })).toBe(2);
  });

  it("lockOutlet mengunci baris outlet di dalam prisma.$transaction dan delete inside tx tetap atomik", async () => {
    if (!dbReady) return;
    const outlet = await prisma.outlet.create({
      data: {
        name: "Tallero Jakarta Selatan",
        address: "Jl. Kemang Raya No. 10",
        latitude: -6.2607,
        longitude: 106.8135,
        openDays: [1, 2, 3, 4, 5, 6],
        openTime: "08:00",
        closeTime: "17:00",
        slotMinutes: 60,
        slotCapacity: 4,
      },
    });

    const lockedRow = await prisma.$transaction(async (tx) => {
      const row = await lockOutlet(tx, outlet.id);
      await tx.outlet.delete({ where: { id: outlet.id } });
      return row;
    });

    expect(lockedRow).toEqual({ id: outlet.id });
    expect(await prisma.outlet.findUnique({ where: { id: outlet.id } })).toBeNull();
    expect(await withDeleted.outlet.findUnique({ where: { id: outlet.id } })).not.toBeNull();
  });

  it("seedInitialAdmin bersifat idempotent (tidak duplikat jika dijalankan berulang)", async () => {
    if (!dbReady) return;
    const first = await seedInitialAdmin();
    expect(first.created).toBe(true);
    expect(first.user.role).toBe("ADMIN");

    const second = await seedInitialAdmin();
    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id);
  });
});
