import { describe, expect, it } from "vitest";
import {
  cancelBookingSchema,
  createBookingSchema,
  listBookingsSchema,
  outletAvailabilitySchema,
} from "../../src/validations/bookings.validation.js";

describe("bookings validation schemas (Zod strict & business constraints)", () => {
  it("rejects unauthorized price and status manipulation from client (.strict())", () => {
    // Upaya manipulasi harga atau total oleh client
    const hackedBody = {
      outletId: 1,
      vehicleId: 2,
      scheduledAt: "2026-11-20T10:00:00+07:00",
      items: [{ type: "SERVICE", serviceId: 5, quantity: 1 }],
      price: 1000,
      total: 1000,
      status: "COMPLETED",
    };

    const parsed = createBookingSchema.body.safeParse(hackedBody);
    expect(parsed.success).toBe(false);

    // Upaya manipulasi harga di dalam item array
    const hackedItemBody = {
      outletId: 1,
      vehicleId: 2,
      scheduledAt: "2026-11-20T10:00:00+07:00",
      items: [{ type: "SERVICE", serviceId: 5, quantity: 1, unitPrice: 500, subtotal: 500 }],
    };
    const parsedItem = createBookingSchema.body.safeParse(hackedItemBody);
    expect(parsedItem.success).toBe(false);
  });

  it("requires at least one SERVICE item in booking items", () => {
    const sparepartsOnly = {
      outletId: 1,
      vehicleId: 2,
      scheduledAt: "2026-11-20T10:00:00+07:00",
      items: [{ type: "SPAREPART", sparepartId: 10, quantity: 2 }],
    };

    const res = createBookingSchema.body.safeParse(sparepartsOnly);
    expect(res.success).toBe(false);
    expect(res.error.issues[0].message).toMatch(/minimal satu layanan/i);
  });

  it("validates cross-field rules for item types SERVICE vs SPAREPART", () => {
    // SERVICE tanpa serviceId
    expect(
      createBookingSchema.body.safeParse({
        outletId: 1,
        vehicleId: 2,
        scheduledAt: "2026-11-20T10:00:00+07:00",
        items: [{ type: "SERVICE", quantity: 1 }],
      }).success
    ).toBe(false);

    // SERVICE dengan sparepartId
    expect(
      createBookingSchema.body.safeParse({
        outletId: 1,
        vehicleId: 2,
        scheduledAt: "2026-11-20T10:00:00+07:00",
        items: [{ type: "SERVICE", serviceId: 1, sparepartId: 2, quantity: 1 }],
      }).success
    ).toBe(false);

    // Valid booking dengan 1 SERVICE dan 1 SPAREPART
    const valid = createBookingSchema.body.safeParse({
      outletId: 1,
      vehicleId: 2,
      scheduledAt: "2026-11-20T10:00:00+07:00",
      items: [
        { type: "SERVICE", serviceId: 1, quantity: 1 },
        { type: "SPAREPART", sparepartId: 3, quantity: 2 },
      ],
      customerNotes: "Tolong periksa rem juga",
    });
    expect(valid.success).toBe(true);
  });

  it("validates availability query parsing (date and comma-separated serviceIds)", () => {
    const parsed = outletAvailabilitySchema.query.parse({
      date: "2026-11-25",
      serviceIds: "1, 2, 5",
    });
    expect(parsed.date).toBe("2026-11-25");
    expect(parsed.serviceIds).toEqual([1, 2, 5]);

    expect(outletAvailabilitySchema.query.safeParse({ date: "25-11-2026" }).success).toBe(false);
  });

  it("validates cancelBookingSchema and listBookingsSchema filters", () => {
    expect(cancelBookingSchema.body.safeParse({ reason: "Urusan mendadak" }).success).toBe(true);
    expect(cancelBookingSchema.body.safeParse({ unknownField: true }).success).toBe(false);

    const listParsed = listBookingsSchema.query.parse({
      status: "PENDING",
      date: "2026-11-20",
      outletId: 1,
      search: "TLR-2026",
    });
    expect(listParsed.status).toBe("PENDING");
    expect(listParsed.search).toBe("TLR-2026");
  });
});
