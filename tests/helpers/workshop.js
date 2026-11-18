import { DateTime } from "luxon";
import prisma from "../../src/config/prisma.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { hashPassword } from "../../src/utils/crypto.js";

export const workshopFixture = async () => {
  const passwordHash = await hashPassword("TestPassword123!");
  const outlet = await prisma.outlet.create({
    data: {
      name: "Audit outlet",
      address: "Jalan Audit 10",
      latitude: -6.2,
      longitude: 106.8,
      openDays: [1, 2, 3, 4, 5, 6, 7],
      openTime: "00:00",
      closeTime: "23:00",
      slotMinutes: 60,
      slotCapacity: 5,
      timezone: "Asia/Jakarta",
    },
  });
  const otherOutlet = await prisma.outlet.create({
    data: {
      name: "Outlet lain",
      address: "Jalan Audit 20",
      latitude: -6.2,
      longitude: 106.8,
      openDays: [1, 2, 3, 4, 5, 6, 7],
      openTime: "00:00",
      closeTime: "23:00",
      slotMinutes: 60,
      slotCapacity: 5,
      timezone: "Asia/Jakarta",
    },
  });
  const actors = {};
  for (const [key, role, outletId] of [
    ["admin", "ADMIN", null],
    ["customer", "CUSTOMER", null],
    ["otherCustomer", "CUSTOMER", null],
    ["mechanic", "MECHANIC", outlet.id],
    ["otherMechanic", "MECHANIC", otherOutlet.id],
  ]) {
    const user = await prisma.user.create({
      data: {
        name: key,
        email: `${key}@audit.test`,
        phone: "+6281234567890",
        passwordHash,
        role,
        outletId,
        isVerified: true,
      },
    });
    actors[key] = { ...user, token: signAccessToken({ userId: user.id, role, tokenVersion: 0 }) };
  }
  const category = await prisma.category.create({ data: { name: "Audit service" } });
  const service = await prisma.service.create({
    data: {
      name: "Ganti oli",
      categoryId: category.id,
      price: 100000,
      estimatedMinutes: 60,
      reminderIntervalDays: 90,
      reminderIntervalKm: 5000,
    },
  });
  const sparepart = await prisma.sparepart.create({
    data: { sku: "AUDIT-OIL", name: "Oli", price: 50000, stock: 10, unit: "botol" },
  });
  const vehicle = await prisma.vehicle.create({
    data: {
      userId: actors.customer.id,
      plateNumber: "B1234AUD",
      activePlate: "B1234AUD",
      brand: "Toyota",
      model: "Avanza",
      type: "CAR",
      year: 2022,
      lastOdometerKm: 10000,
    },
  });
  const date = DateTime.now().setZone("Asia/Jakarta").plus({ days: 2 }).toISODate();
  return { ...actors, outlet, otherOutlet, category, service, sparepart, vehicle, date };
};

export const readyBooking = async (f, suffix = "1") =>
  prisma.booking.create({
    data: {
      code: `AUDIT-${suffix}`,
      customerId: f.customer.id,
      outletId: f.outlet.id,
      vehicleId: f.vehicle.id,
      mechanicId: f.mechanic.id,
      scheduledAt: new Date(`${f.date}T10:00:00+07:00`),
      slotEndAt: new Date(`${f.date}T11:00:00+07:00`),
      status: "READY_FOR_PICKUP",
      readyAt: new Date(),
      total: 100000,
      items: {
        create: {
          type: "SERVICE",
          serviceId: f.service.id,
          nameSnapshot: f.service.name,
          unitPrice: 100000,
          quantity: 1,
          subtotal: 100000,
          source: "CUSTOMER_BOOKING",
          approvalStatus: "APPROVED",
          requestedById: f.customer.id,
        },
      },
    },
  });
