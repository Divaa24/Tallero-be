import { describe, expect, it } from "vitest";
import { createStaffSchema } from "../../src/validations/users.validation.js";
import {
  assertValidOutletSchedule,
  createOutletClosureSchema,
  createOutletSchema,
} from "../../src/validations/outlets.validation.js";
import { createServiceSchema } from "../../src/validations/catalog.validation.js";
import {
  adjustSparepartStockSchema,
  updateSparepartSchema,
} from "../../src/validations/spareparts.validation.js";
import {
  createVehicleSchema,
  normalizePlateNumber,
} from "../../src/validations/vehicles.validation.js";

describe("Fase 3 validation schemas", () => {
  it("enforces MECHANIC outletId requirement and forbids outletId on ADMIN", () => {
    expect(
      createStaffSchema.body.safeParse({
        name: "Mekanik Satu",
        email: "mekanik@tallero.id",
        phone: "081234567890",
        role: "MECHANIC",
      }).success
    ).toBe(false);

    expect(
      createStaffSchema.body.safeParse({
        name: "Admin Baru",
        email: "admin2@tallero.id",
        phone: "081234567890",
        role: "ADMIN",
        outletId: 1,
      }).success
    ).toBe(false);

    expect(
      createStaffSchema.body.safeParse({
        name: "Mekanik Satu",
        email: "mekanik@tallero.id",
        phone: "081234567890",
        role: "MECHANIC",
        outletId: 1,
      }).success
    ).toBe(true);
  });

  it("validates outlet openTime < closeTime, divisible slotMinutes, unique openDays, and calendar closure date", () => {
    expect(() =>
      assertValidOutletSchedule({ openTime: "08:00", closeTime: "17:00", slotMinutes: 60 })
    ).not.toThrow();

    expect(() =>
      assertValidOutletSchedule({ openTime: "18:00", closeTime: "09:00", slotMinutes: 60 })
    ).toThrow(/lebih awal/i);

    expect(() =>
      assertValidOutletSchedule({ openTime: "08:00", closeTime: "17:00", slotMinutes: 70 })
    ).toThrow(/membagi habis/i);

    expect(
      createOutletSchema.body.safeParse({
        name: "Tallero Sudirman",
        address: "Jl. Jenderal Sudirman No. 10",
        managerName: "Budi Santoso",
        latitude: -6.2,
        longitude: 106.8,
        openDays: [1, 2, 3],
        openTime: "08:00",
        closeTime: "17:00",
        slotMinutes: 60,
        slotCapacity: 3,
      }).success
    ).toBe(true);

    expect(
      createOutletSchema.body.safeParse({
        name: "Tallero Sudirman",
        address: "Jl. Jenderal Sudirman No. 10",
        latitude: -6.2,
        longitude: 106.8,
        openDays: [1, 1, 2],
        openTime: "08:00",
        closeTime: "17:00",
        slotMinutes: 60,
        slotCapacity: 3,
      }).success
    ).toBe(false);

    expect(
      createOutletClosureSchema.body.safeParse({ date: "2026-02-30", reason: "Tanggal palsu" })
        .success
    ).toBe(false);
    expect(
      createOutletClosureSchema.body.safeParse({ date: "2026-12-25", reason: "Libur Natal" })
        .success
    ).toBe(true);
  });

  it("enforces positive integer price on services and accepts marketing fields (badge, imageUrl, checklist)", () => {
    expect(
      createServiceSchema.body.safeParse({
        categoryId: 1,
        name: "Ganti Oli",
        badge: "TERLARIS",
        imageUrl: "https://images.unsplash.com/photo-1",
        checklist: ["Ganti oli mesin 4L", "Cek filter"],
        price: 350000,
        estimatedMinutes: 30,
      }).success
    ).toBe(true);

    expect(
      createServiceSchema.body.safeParse({
        categoryId: 1,
        name: "Ganti Oli",
        price: 0,
        estimatedMinutes: 30,
      }).success
    ).toBe(false);

    expect(
      createServiceSchema.body.safeParse({
        categoryId: 1,
        name: "Ganti Oli",
        price: 150000.5,
        estimatedMinutes: 30,
      }).success
    ).toBe(false);

    expect(adjustSparepartStockSchema.body.safeParse({ delta: 0, reason: "Koreksi" }).success).toBe(
      false
    );
    expect(adjustSparepartStockSchema.body.safeParse({ delta: 5, reason: "ab" }).success).toBe(
      false
    );
    expect(updateSparepartSchema.body.safeParse({ name: "Oli Baru", stock: 99 }).success).toBe(
      false
    );
  });

  it("normalizes Indonesian vehicle license plates and rejects malformed formats", () => {
    expect(normalizePlateNumber(" b 1234 - xyz ")).toBe("B1234XYZ");

    const parsed = createVehicleSchema.body.parse({
      plateNumber: "d 456 abc",
      brand: "Honda",
      model: "Civic",
      type: "CAR",
      year: 2022,
    });
    expect(parsed.plateNumber).toBe("D456ABC");

    expect(
      createVehicleSchema.body.safeParse({
        plateNumber: "INVALID99999",
        brand: "Honda",
        model: "Beat",
        type: "MOTORCYCLE",
        year: 2022,
      }).success
    ).toBe(false);
  });
});
