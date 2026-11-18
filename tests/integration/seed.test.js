import { beforeAll, afterAll, describe, it, expect } from "vitest";
import prisma, { pool } from "../../src/config/prisma.js";
import { seedDemoData } from "../../prisma/seed.js";
import { verifyBookingQrPayload } from "../../src/services/bookings.service.js";
import { resetTestDb } from "../helpers/db.js";

describe("Demo seed against the current PostgreSQL schema", () => {
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
    await resetTestDb();
  });
  afterAll(async () => {
    await resetTestDb();
    await prisma.$disconnect();
    await pool.end();
  });
  it("creates valid related demo records and remains idempotent", async () => {
    const first = await seedDemoData();
    const counts = async () =>
      Promise.all([
        prisma.user.count(),
        prisma.booking.count(),
        prisma.bookingItem.count(),
        prisma.serviceReminder.count(),
      ]);
    const before = await counts();
    expect(before.every((n) => n > 0)).toBe(true);
    expect(verifyBookingQrPayload(first.qrDemo).valid).toBe(true);
    await seedDemoData();
    expect(await counts()).toEqual(before);
  });
});
