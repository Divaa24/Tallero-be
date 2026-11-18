import request from "supertest";
import sharp from "sharp";
import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import app from "../../src/app.js";
import prisma, { pool } from "../../src/config/prisma.js";
import * as mail from "../../src/services/mail.service.js";
import { createBooking } from "../../src/services/bookings.service.js";
import { runPaymentSync } from "../../src/jobs/paymentSync.job.js";
import midtrans from "../../src/services/midtrans.service.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { resetTestDb } from "../helpers/db.js";
import { workshopFixture, readyBooking } from "../helpers/workshop.js";

describe("Real HTTP workshop lifecycle and regression guards", () => {
  let f;
  const call = (actor, method, path, body) =>
    request(app)[method](`/api/v1${path}`).set("Authorization", `Bearer ${actor.token}`).send(body);
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  beforeEach(async () => {
    await resetTestDb();
    f = await workshopFixture();
    vi.spyOn(mail, "sendMail").mockResolvedValue({ accepted: ["test"] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await resetTestDb();
    await prisma.$disconnect();
    await pool.end();
  });

  it("completes booking, check-in, work, approval, photos, cash, completion, review and invoice over HTTP", async () => {
    const avail = await call(
      f.customer,
      "get",
      `/outlets/${f.outlet.id}/availability?date=${f.date}&serviceIds=${f.service.id}`
    );
    expect(avail.status).toBe(200);
    expect(avail.body.data.totalEstimatedMinutes).toBe(60);
    const create = await call(f.customer, "post", "/bookings", {
      outletId: f.outlet.id,
      vehicleId: f.vehicle.id,
      scheduledAt: `${f.date}T10:00:00+07:00`,
      items: [{ type: "SERVICE", serviceId: f.service.id, quantity: 1 }],
    });
    expect(create.status).toBe(201);
    const id = create.body.data.id;
    expect((await call(f.otherCustomer, "get", `/bookings/${id}`)).status).toBe(404);
    const qr = await call(f.customer, "get", `/bookings/${id}/qr`);
    expect(qr.status).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${f.date}T09:30:00+07:00`));
    for (const key of ["admin", "customer", "otherCustomer", "mechanic", "otherMechanic"]) {
      f[key].token = signAccessToken({ userId: f[key].id, role: f[key].role, tokenVersion: 0 });
    }
    expect(
      (
        await call(f.admin, "post", "/bookings/check-in", {
          qrPayload: qr.body.data.qrPayload,
          odometerKm: 12000,
        })
      ).status
    ).toBe(200);
    expect(
      (await call(f.admin, "post", `/bookings/${id}/start`, { mechanicId: f.customer.id })).body
        .error.code
    ).toBe("INVALID_MECHANIC");
    expect(
      (await call(f.admin, "post", `/bookings/${id}/assign`, { mechanicId: f.mechanic.id })).status
    ).toBe(200);
    expect((await call(f.mechanic, "post", `/bookings/${id}/start`, {})).status).toBe(200);
    expect((await call(f.otherMechanic, "post", `/bookings/${id}/ready`, {})).status).toBe(403);
    const item = await call(f.mechanic, "post", `/bookings/${id}/items`, {
      type: "SPAREPART",
      sparepartId: f.sparepart.id,
      quantity: 2,
      note: "Oli perlu diganti",
    });
    expect(item.status).toBe(201);
    const approval = await call(f.admin, "post", `/bookings/${id}/approvals`, {
      note: "Pelanggan menyetujui melalui telepon",
      decisions: [{ itemId: item.body.data.id, decision: "APPROVE" }],
    });
    expect(approval.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "APPROVAL_DECISION_ON_BEHALF" } })).toBe(
      1
    );
    expect((await prisma.sparepart.findUnique({ where: { id: f.sparepart.id } })).stock).toBe(8);
    expect((await call(f.mechanic, "post", `/bookings/${id}/ready`, {})).status).toBe(422);
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "red" } })
      .png()
      .toBuffer();
    for (const type of ["BEFORE", "AFTER"]) {
      const upload = await request(app)
        .post(`/api/v1/bookings/${id}/photos`)
        .set("Authorization", `Bearer ${f.mechanic.token}`)
        .field("type", type)
        .attach("photo", png, "audit.png");
      expect(upload.status).toBe(201);
    }
    expect((await call(f.mechanic, "post", `/bookings/${id}/ready`, {})).status).toBe(200);
    expect((await call(f.admin, "post", `/bookings/${id}/complete`, {})).status).toBe(409);
    const cash = await call(f.admin, "post", `/bookings/${id}/payments/cash`, {});
    expect(cash.status).toBe(200);
    expect(cash.body.data.payment.amount).toBe(200000);
    expect((await call(f.admin, "post", `/bookings/${id}/complete`, {})).status).toBe(200);
    expect(await prisma.serviceReminder.count({ where: { sourceBookingId: id } })).toBe(1);
    const invoice = await call(f.customer, "get", `/bookings/${id}/invoice.pdf`);
    expect(invoice.status).toBe(200);
    expect(invoice.headers["content-type"]).toContain("application/pdf");
    const review = await call(f.customer, "post", `/bookings/${id}/review`, {
      rating: 5,
      comment: "Baik",
    });
    expect(review.status).toBe(201);
    const list = await request(app).get(`/api/v1/outlets/${f.outlet.id}/reviews`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(
      (
        await call(f.admin, "patch", `/admin/reviews/${review.body.data.id}/visibility`, {
          isHidden: true,
        })
      ).status
    ).toBe(200);
    expect(
      (await request(app).get(`/api/v1/outlets/${f.outlet.id}/reviews`)).body.data
    ).toHaveLength(0);
    expect((await call(f.customer, "post", `/bookings/${id}/review`, { rating: 5 })).status).toBe(
      409
    );
  });

  it("blocks mechanic payment sync before contacting gateway", async () => {
    const booking = await readyBooking(f);
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        type: "INVOICE",
        method: "MIDTRANS",
        orderId: "private-order",
        amount: 100000,
      },
    });
    const gateway = vi.spyOn(midtrans, "getStatus");
    expect((await call(f.otherMechanic, "post", "/payments/private-order/sync", {})).status).toBe(
      403
    );
    expect((await call(f.otherCustomer, "post", "/payments/private-order/sync", {})).status).toBe(
      404
    );
    expect(gateway).not.toHaveBeenCalled();
  });

  it("counts early morning bookings on their local outlet day and rejects invalid dates", async () => {
    await createBooking({
      actor: f.customer,
      data: {
        outletId: f.outlet.id,
        vehicleId: f.vehicle.id,
        scheduledAt: `${f.date}T06:00:00+07:00`,
        items: [{ type: "SERVICE", serviceId: f.service.id, quantity: 1 }],
      },
    });
    const response = await call(
      f.customer,
      "get",
      `/outlets/${f.outlet.id}/availability?date=${f.date}`
    );
    expect(response.status).toBe(200);
    expect(response.body.data.slots.find((s) => s.time === "06:00").booked).toBe(1);
    expect(
      (await call(f.customer, "get", `/outlets/${f.outlet.id}/availability?date=2026-02-30`)).status
    ).toBe(400);
  });

  it("closes DUE reminders when repeat service completes", async () => {
    const old = await readyBooking(f, "old");
    await prisma.serviceReminder.create({
      data: {
        vehicleId: f.vehicle.id,
        userId: f.customer.id,
        serviceId: f.service.id,
        sourceBookingId: old.id,
        dueDate: new Date(),
        status: "DUE",
      },
    });
    const booking = await readyBooking(f, "new");
    await call(f.admin, "post", `/bookings/${booking.id}/payments/cash`, {});
    expect((await call(f.admin, "post", `/bookings/${booking.id}/complete`, {})).status).toBe(200);
    const reminders = await prisma.serviceReminder.findMany({ orderBy: { id: "asc" } });
    expect(reminders.map((r) => r.status)).toEqual(["DONE", "SCHEDULED"]);
  });

  it("reports fully refunded receipt as zero net, not negative", async () => {
    const booking = await readyBooking(f);
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        type: "INVOICE",
        method: "MIDTRANS",
        orderId: "refunded-order",
        amount: 100000,
        status: "REFUNDED",
        paidAt: new Date(),
      },
    });
    const date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    const res = await call(f.admin, "get", `/admin/reports/summary?from=${date}&to=${date}`);
    expect(res.status).toBe(200);
    expect(res.body.data.revenue).toMatchObject({ gross: 100000, refunds: 100000, net: 0 });
  });

  it("reconciles expired local pending payments", async () => {
    const booking = await readyBooking(f);
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        type: "INVOICE",
        method: "MIDTRANS",
        orderId: "overdue-order",
        amount: 100000,
        expiresAt: new Date(Date.now() - 3600000),
      },
    });
    vi.spyOn(midtrans, "getStatus").mockResolvedValue({
      order_id: "overdue-order",
      status_code: "200",
      gross_amount: "100000.00",
      transaction_status: "expire",
      signature_key: "test",
    });
    vi.spyOn(midtrans, "verifySignature").mockReturnValue(true);
    const result = await runPaymentSync();
    expect(result.updated).toBe(1);
    expect((await prisma.payment.findUnique({ where: { orderId: "overdue-order" } })).status).toBe(
      "EXPIRED"
    );
  });
});
