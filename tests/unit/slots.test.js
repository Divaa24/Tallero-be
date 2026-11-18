import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { generateOutletSlots, validateAndComputeBookingSlot } from "../../src/services/availability.service.js";

describe("slots service (Luxon slot calculations & validations)", () => {
  const baseOutlet = {
    id: 1,
    name: "Tallero Tebet",
    timezone: "Asia/Jakarta",
    openTime: "08:00",
    closeTime: "17:00",
    slotMinutes: 60,
    slotCapacity: 2,
    openDays: [1, 2, 3, 4, 5, 6], // Senin - Sabtu
  };

  it("generates grid slots from openTime to closeTime with capacity and status", () => {
    // Simulasi hari Rabu pukul 06:00 WIB (lead time 60 min -> 07:00, jadi slot 08:00 masih valid)
    const now = DateTime.fromISO("2026-11-18T06:00:00.000", { zone: "Asia/Jakarta" });
    const dateStr = "2026-11-18";

    // 1 booking aktif pada slot 09:00
    const slot09Ms = DateTime.fromISO("2026-11-18T09:00:00.000", {
      zone: "Asia/Jakarta",
    }).toMillis();
    const existingBookings = [{ scheduledAt: new Date(slot09Ms) }];

    const result = generateOutletSlots({
      outlet: baseOutlet,
      dateStr,
      now,
      existingBookings,
      closures: [],
    });

    expect(result.date).toBe(dateStr);
    expect(result.isDayOpen).toBe(true);
    expect(result.isClosure).toBe(false);
    expect(result.slots).toHaveLength(9); // 08:00 sampai 17:00 (9 slot 60 menit)

    // Slot 08:00 -> 0 booked -> AVAILABLE (sisa 2)
    expect(result.slots[0].time).toBe("08:00");
    expect(result.slots[0].status).toBe("AVAILABLE");
    expect(result.slots[0].remaining).toBe(2);

    // Slot 09:00 -> 1 booked -> LIMITED (sisa 1)
    expect(result.slots[1].time).toBe("09:00");
    expect(result.slots[1].status).toBe("LIMITED");
    expect(result.slots[1].remaining).toBe(1);
    expect(result.slots[1].booked).toBe(1);
  });

  it("marks past slots as PAST and closed days/closures as CLOSED", () => {
    // Sekarang pukul 10:30 WIB
    const now = DateTime.fromISO("2026-11-18T10:30:00.000", { zone: "Asia/Jakarta" });
    const dateStr = "2026-11-18";

    const result = generateOutletSlots({
      outlet: baseOutlet,
      dateStr,
      now,
      existingBookings: [],
      closures: [],
    });

    // 08:00, 09:00, 10:00, dan 11:00 (< 10:30 + 60 min = 11:30) harus berstatus PAST
    expect(result.slots[0].status).toBe("PAST");
    expect(result.slots[1].status).toBe("PAST");
    expect(result.slots[2].status).toBe("PAST");
    expect(result.slots[3].status).toBe("PAST");

    // 12:00 ke atas (> 11:30) harus AVAILABLE
    expect(result.slots[4].time).toBe("12:00");
    expect(result.slots[4].status).toBe("AVAILABLE");

    // Hari Minggu (ISO 7) ketika outlet hanya buka 1-6 -> semua CLOSED
    const sundayRes = generateOutletSlots({
      outlet: baseOutlet,
      dateStr: "2026-11-22",
      now,
      existingBookings: [],
    });
    expect(sundayRes.isDayOpen).toBe(false);
    expect(sundayRes.slots.every((s) => s.status === "CLOSED")).toBe(true);

    // Tanggal closure (hari libur) -> semua CLOSED
    const closureRes = generateOutletSlots({
      outlet: baseOutlet,
      dateStr: "2026-11-19",
      now,
      existingBookings: [],
      closures: [{ date: new Date("2026-11-19T00:00:00.000Z"), reason: "Renovasi Bengkel" }],
    });
    expect(closureRes.isClosure).toBe(true);
    expect(closureRes.slots.every((s) => s.status === "CLOSED")).toBe(true);
    expect(closureRes.closureReason).toBe("Renovasi Bengkel");
  });

  it("validates requested booking slot against lead time, advance window, openDays, closures, and grid", () => {
    const now = DateTime.fromISO("2026-11-18T10:00:00.000", { zone: "Asia/Jakarta" });

    // Valid slot (14:00 hari yang sama)
    const valid = validateAndComputeBookingSlot({
      outlet: baseOutlet,
      scheduledAt: "2026-11-18T14:00:00+07:00",
      now: now.toJSDate(),
      closures: [],
    });
    expect(valid.startDt.toFormat("HH:mm")).toBe("14:00");
    expect(valid.slotEndDt.toFormat("HH:mm")).toBe("15:00");

    // Terlalu dekat (< 60 menit lead time, mis. 10:30)
    expect(() =>
      validateAndComputeBookingSlot({
        outlet: baseOutlet,
        scheduledAt: "2026-11-18T10:30:00+07:00",
        now: now.toJSDate(),
      })
    ).toThrow(/minimal 60 menit/i);

    // Melebihi 30 hari ke depan
    expect(() =>
      validateAndComputeBookingSlot({
        outlet: baseOutlet,
        scheduledAt: "2026-12-30T10:00:00+07:00",
        now: now.toJSDate(),
      })
    ).toThrow(/maksimal 30 hari/i);

    // Hari tutup (Minggu 2026-11-22)
    expect(() =>
      validateAndComputeBookingSlot({
        outlet: baseOutlet,
        scheduledAt: "2026-11-22T10:00:00+07:00",
        now: now.toJSDate(),
      })
    ).toThrow(/outlet tutup/i);

    // Hari libur closure
    expect(() =>
      validateAndComputeBookingSlot({
        outlet: baseOutlet,
        scheduledAt: "2026-11-20T10:00:00+07:00",
        now: now.toJSDate(),
        closures: [{ date: new Date("2026-11-20T00:00:00.000Z"), reason: "Libur Nasional" }],
      })
    ).toThrow(/libur pada tanggal tersebut/i);

    // Menit tidak selaras dengan grid (mis. 10:15 padahal slot 60 menit)
    expect(() =>
      validateAndComputeBookingSlot({
        outlet: baseOutlet,
        scheduledAt: "2026-11-18T14:15:00+07:00",
        now: now.toJSDate(),
      })
    ).toThrow(/tidak sesuai dengan batas dan grid/i);
  });
});
