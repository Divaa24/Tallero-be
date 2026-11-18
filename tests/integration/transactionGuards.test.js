import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import prisma, { pool } from "../../src/config/prisma.js";
import { createBooking } from "../../src/services/bookings.service.js";
import {
  payCash,
  handleMidtransNotification,
  createMidtransInvoicePayment,
} from "../../src/services/payments.service.js";
import midtrans from "../../src/services/midtrans.service.js";
import { resetTestDb } from "../helpers/db.js";
import { workshopFixture, readyBooking } from "../helpers/workshop.js";

describe("PostgreSQL transaction invariants under parallel requests", () => {
  let f;
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  beforeEach(async () => {
    await resetTestDb();
    f = await workshopFixture();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await resetTestDb();
    await prisma.$disconnect();
    await pool.end();
  });
  const bookingInput = (vehicleId, outletId) => ({
    vehicleId,
    outletId,
    scheduledAt: `${f.date}T10:00:00+07:00`,
    items: [{ type: "SERVICE", serviceId: f.service.id, quantity: 1 }],
  });
  const mockGateway = () => {
    vi.spyOn(midtrans, "verifySignature").mockReturnValue(true);
    vi.spyOn(midtrans, "getStatus").mockImplementation(async (order) => ({
      order_id: order,
      status_code: "200",
      gross_amount: "100000.00",
      transaction_status: "settlement",
      transaction_id: `tx-${order}`,
      payment_type: "bank_transfer",
    }));
  };
  const webhook = (order) =>
    handleMidtransNotification({
      order_id: order,
      status_code: "200",
      gross_amount: "100000.00",
      signature_key: "test",
    });
  const pending = async (booking, order) =>
    prisma.payment.create({
      data: {
        bookingId: booking.id,
        orderId: order,
        type: "INVOICE",
        method: "MIDTRANS",
        amount: 100000,
      },
    });

  it("allows only one active booking per vehicle across different outlets", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        createBooking({
          actor: f.customer,
          data: bookingInput(f.vehicle.id, i % 2 ? f.outlet.id : f.otherOutlet.id),
        })
      )
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.booking.count()).toBe(1);
    for (const r of results.filter((r) => r.status === "rejected"))
      expect(r.reason.code).toBe("VEHICLE_HAS_ACTIVE_BOOKING");
  });

  it("enforces max three active bookings per customer across outlets", async () => {
    const vehicles = [];
    for (let i = 0; i < 8; i++)
      vehicles.push(
        await prisma.vehicle.create({
          data: {
            userId: f.customer.id,
            plateNumber: `B${2000 + i}AUD`,
            activePlate: `B${2000 + i}AUD`,
            brand: "Honda",
            model: "Brio",
            type: "CAR",
            year: 2022,
          },
        })
      );
    const results = await Promise.allSettled(
      vehicles.map((v, i) =>
        createBooking({
          actor: f.customer,
          data: bookingInput(v.id, i % 2 ? f.outlet.id : f.otherOutlet.id),
        })
      )
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await prisma.booking.count()).toBe(3);
    for (const r of results.filter((r) => r.status === "rejected"))
      expect(r.reason.code).toBe("MAX_ACTIVE_BOOKINGS_EXCEEDED");
  });

  it("records one cash payment for twenty simultaneous cashier requests", async () => {
    const booking = await readyBooking(f);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => payCash({ actor: f.admin, bookingId: booking.id }))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.payment.count({ where: { status: "PAID", bookingId: booking.id } })).toBe(
      1
    );
    expect(await prisma.auditLog.count({ where: { action: "PAYMENT_CASH_RECEIVED" } })).toBe(1);
    for (const r of results.filter((r) => r.status === "rejected"))
      expect(r.reason.code).toBe("BOOKING_ALREADY_PAID");
  });

  it("allocates distinct invoices to parallel payments for different bookings", async () => {
    const bookings = [];
    for (let i = 0; i < 8; i++) bookings.push(await readyBooking(f, String(i)));
    const results = await Promise.all(
      bookings.map((b) => payCash({ actor: f.admin, bookingId: b.id }))
    );
    expect(new Set(results.map((r) => r.invoiceNumber)).size).toBe(8);
    expect(await prisma.payment.count({ where: { status: "PAID" } })).toBe(8);
  });

  it("processes repeated settlement webhook exactly once", async () => {
    const booking = await readyBooking(f);
    await pending(booking, "settle-once");
    mockGateway();
    await Promise.all(Array.from({ length: 20 }, () => webhook("settle-once")));
    expect(await prisma.payment.count({ where: { status: "PAID" } })).toBe(1);
    expect(
      await prisma.notification.count({ where: { userId: f.customer.id, type: "PAYMENT" } })
    ).toBe(1);
  });

  it("classifies simultaneous second settlement as duplicate, including retries", async () => {
    const booking = await readyBooking(f);
    await pending(booking, "order-a");
    await pending(booking, "order-b");
    mockGateway();
    await Promise.all([webhook("order-a"), webhook("order-b")]);
    expect(await prisma.payment.count({ where: { status: "PAID" } })).toBe(1);
    expect(await prisma.payment.count({ where: { status: "DUPLICATE" } })).toBe(1);
    const duplicate = await prisma.payment.findFirst({ where: { status: "DUPLICATE" } });
    await webhook(duplicate.orderId);
    expect(await prisma.payment.count({ where: { status: "DUPLICATE" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "DUPLICATE_PAYMENT_DETECTED" } })).toBe(
      1
    );
  });

  it("serializes cash against settlement and preserves a single paid invoice", async () => {
    const booking = await readyBooking(f);
    await pending(booking, "cash-race");
    mockGateway();
    vi.spyOn(midtrans, "cancel").mockResolvedValue(null);
    await Promise.allSettled([
      payCash({ actor: f.admin, bookingId: booking.id }),
      webhook("cash-race"),
    ]);
    expect(await prisma.payment.count({ where: { status: "PAID" } })).toBe(1);
    expect((await prisma.booking.findUnique({ where: { id: booking.id } })).paymentStatus).toBe(
      "PAID"
    );
  });

  it("keeps only one pending Snap attempt when invoice creation is retried concurrently", async () => {
    const booking = await readyBooking(f);
    vi.spyOn(midtrans, "createSnapTransaction").mockResolvedValue({
      token: "sandbox-token",
      redirectUrl: "https://example.test/pay",
    });
    vi.spyOn(midtrans, "cancel").mockResolvedValue(null);
    await Promise.all([
      createMidtransInvoicePayment({ actor: f.customer, bookingId: booking.id }),
      createMidtransInvoicePayment({ actor: f.customer, bookingId: booking.id }),
    ]);
    expect(
      await prisma.payment.count({ where: { bookingId: booking.id, status: "PENDING" } })
    ).toBe(1);
    expect(
      await prisma.payment.count({ where: { bookingId: booking.id, status: "CANCELLED" } })
    ).toBe(1);
  });
});
