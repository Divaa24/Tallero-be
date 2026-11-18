import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LEGAL_TRANSITIONS, transition } from "../../src/services/bookingStateMachine.service.js";

const ALL_STATUSES = [
  "PENDING",
  "CHECKED_IN",
  "IN_PROGRESS",
  "WAITING_APPROVAL",
  "READY_FOR_PICKUP",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

describe("bookingStateMachine", () => {
  let mockTx;
  let mockBooking;
  const scheduledAt = new Date("2026-11-20T10:00:00.000Z");

  beforeEach(() => {
    vi.restoreAllMocks();
    mockBooking = {
      id: 100,
      code: "TLR-20261120-ABC123",
      customerId: 10,
      outletId: 1,
      mechanicId: null,
      status: "PENDING",
      scheduledAt,
      slotEndAt: new Date("2026-11-20T11:00:00.000Z"),
      total: 250000,
      paymentStatus: "UNPAID",
      vehicleId: 5,
      invoiceNumber: null,
    };

    mockTx = {
      booking: {
        findUnique: vi.fn(async () => ({ ...mockBooking })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      bookingItem: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
        update: vi.fn(async () => ({})),
      },
      bookingPhoto: {
        count: vi.fn(async () => 1),
      },
      sparepart: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        update: vi.fn(async () => ({})),
      },
      bookingLog: {
        create: vi.fn(async (args) => args.data),
      },
    };
  });

  describe("Tabel Transisi Deklaratif (8x8 = 64 Kombinasi)", () => {
    it("menolak seluruh transisi status yang tidak terdaftar dalam LEGAL_TRANSITIONS dengan 409 INVALID_TRANSITION", async () => {
      const admin = { id: 1, role: "ADMIN" };

      for (const fromStatus of ALL_STATUSES) {
        const allowedTargets = LEGAL_TRANSITIONS[fromStatus] || [];
        for (const toStatus of ALL_STATUSES) {
          if (!allowedTargets.includes(toStatus)) {
            mockBooking.status = fromStatus;
            await expect(
              transition(mockTx, 100, toStatus, admin, {
                reason: "Alasan pembatalan",
                queueDate: new Date(),
                queueNumber: 1,
              })
            ).rejects.toMatchObject({
              statusCode: 409,
              code: "INVALID_TRANSITION",
            });
          }
        }
      }
    });
  });

  describe("Uji Statis (Grep): Perlindungan Satu Pintu Perubahan Status", () => {
    it("memastikan tidak ada file di src/ (selain bookingStateMachine.js) yang meng-update status booking secara langsung", () => {
      const srcDir = path.resolve(process.cwd(), "src");
      const filesWithViolation = [];

      const scanDirectory = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDirectory(fullPath);
          } else if (entry.isFile() && entry.name.endsWith(".js")) {
            // Abaikan bookingStateMachine.service.js dan bookingStateMachine.js
            if (
              entry.name === "bookingStateMachine.service.js" ||
              entry.name === "bookingStateMachine.js"
            )
              continue;

            const content = fs.readFileSync(fullPath, "utf-8");
            // Cari pemanggilan update/updateMany pada model booking yang memodifikasi status
            // Dilarang keras meng-update status booking di luar bookingStateMachine.js
            const bookingUpdateCallRegex =
              /(?:prisma|tx)\.booking\.(?:update|updateMany)\s*\(\s*\{[\s\S]*?\}\s*\)/g;
            let match;
            while ((match = bookingUpdateCallRegex.exec(content)) !== null) {
              const callBlock = match[0];
              // Pastikan tidak ada properti status di dalam pemanggilan update tersebut
              if (/\bstatus\s*:/.test(callBlock)) {
                filesWithViolation.push(path.relative(process.cwd(), fullPath));
                break;
              }
            }
          }
        }
      };

      scanDirectory(srcDir);
      expect(
        filesWithViolation,
        `Ditemukan manipulasi status booking langsung di luar bookingStateMachine.js: ${filesWithViolation.join(", ")}`
      ).toEqual([]);
    });
  });

  describe("Guards & Efek Samping Transisi", () => {
    it("permits customer cancellation before the 60-minute cutoff window", async () => {
      const actor = { id: 10, role: "CUSTOMER" };
      const now = new Date("2026-11-20T08:00:00.000Z");

      const result = await transition(mockTx, 100, "CANCELLED", actor, {
        now,
        reason: "Ada rapat dadakan",
      });

      expect(result.booking.status).toBe("CANCELLED");
      expect(result.booking.cancelReason).toBe("Ada rapat dadakan");
      expect(mockTx.booking.updateMany).toHaveBeenCalledWith({
        where: { id: 100, status: "PENDING" },
        data: expect.objectContaining({
          status: "CANCELLED",
          cancelledById: 10,
          cancelReason: "Ada rapat dadakan",
        }),
      });
      expect(mockTx.bookingLog.create).toHaveBeenCalledOnce();
      expect(result.events[0].event).toBe("booking:status_changed");
    });

    it("rejects customer cancellation after the 60-minute cutoff window with 422", async () => {
      const actor = { id: 10, role: "CUSTOMER" };
      const now = new Date("2026-11-20T09:15:00.000Z");

      await expect(transition(mockTx, 100, "CANCELLED", actor, { now })).rejects.toMatchObject({
        statusCode: 422,
        code: "CANCEL_CUTOFF_EXCEEDED",
      });
    });

    it("enforces IDOR protection when a customer attempts to cancel another user's booking", async () => {
      const otherCustomer = { id: 99, role: "CUSTOMER" };
      const now = new Date("2026-11-20T08:00:00.000Z");

      await expect(
        transition(mockTx, 100, "CANCELLED", otherCustomer, { now })
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "BOOKING_NOT_FOUND",
      });
    });

    it("requires a mandatory reason when an admin cancels a booking", async () => {
      const admin = { id: 1, role: "ADMIN" };
      const now = new Date("2026-11-20T09:30:00.000Z");

      await expect(
        transition(mockTx, 100, "CANCELLED", admin, { now, reason: "" })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "CANCEL_REASON_REQUIRED",
      });

      const res = await transition(mockTx, 100, "CANCELLED", admin, {
        now,
        reason: "Bengkel tutup darurat",
      });
      expect(res.booking.status).toBe("CANCELLED");
    });

    it("forbids mechanics from cancelling bookings with 403", async () => {
      const mechanic = { id: 2, role: "MECHANIC", outletId: 1 };
      const now = new Date("2026-11-20T08:00:00.000Z");

      await expect(transition(mockTx, 100, "CANCELLED", mechanic, { now })).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
      });
    });

    it("restores deducted sparepart stock when an admin cancels an IN_PROGRESS booking", async () => {
      mockBooking.status = "IN_PROGRESS";
      mockBooking.mechanicId = 20;

      mockTx.bookingItem.findMany.mockResolvedValueOnce([
        { id: 501, bookingId: 100, sparepartId: 10, quantity: 2, stockDeducted: true },
      ]);

      const admin = { id: 1, role: "ADMIN" };
      const now = new Date("2026-11-20T11:00:00.000Z");

      await transition(mockTx, 100, "CANCELLED", admin, {
        now,
        reason: "Kerusakan parah tidak dapat diperbaiki",
      });

      expect(mockTx.sparepart.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { stock: { increment: 2 } },
      });
      expect(mockTx.bookingItem.update).toHaveBeenCalledWith({
        where: { id: 501 },
        data: { stockDeducted: false },
      });
    });

    it("rejects NO_SHOW transition when now is still within grace period", async () => {
      mockBooking.status = "PENDING";
      const systemActor = { id: null, role: "SYSTEM" };
      // 30 menit setelah slot selesai (masih dalam grace period 60 menit)
      const now = new Date(mockBooking.slotEndAt.getTime() + 30 * 60 * 1000);

      await expect(transition(mockTx, 100, "NO_SHOW", systemActor, { now })).rejects.toMatchObject({
        statusCode: 422,
        code: "NO_SHOW_GRACE_PERIOD_ACTIVE",
      });
    });

    it("allows NO_SHOW transition after grace period expires", async () => {
      mockBooking.status = "PENDING";
      const systemActor = { id: null, role: "SYSTEM" };
      // 70 menit setelah slot selesai (grace period 60 menit telah lewat)
      const now = new Date(mockBooking.slotEndAt.getTime() + 70 * 60 * 1000);

      const res = await transition(mockTx, 100, "NO_SHOW", systemActor, { now });
      expect(res.booking.status).toBe("NO_SHOW");
    });

    it("rejects READY_FOR_PICKUP if before or after photo is missing with 422 PHOTOS_INCOMPLETE", async () => {
      mockBooking.status = "IN_PROGRESS";
      mockBooking.mechanicId = 20;
      const mechanic = { id: 20, role: "MECHANIC", outletId: 1 };

      // BEFORE ada 1, tapi AFTER ada 0
      mockTx.bookingPhoto.count
        .mockResolvedValueOnce(1) // BEFORE
        .mockResolvedValueOnce(0); // AFTER

      await expect(transition(mockTx, 100, "READY_FOR_PICKUP", mechanic)).rejects.toMatchObject({
        statusCode: 422,
        code: "PHOTOS_INCOMPLETE",
      });
    });

    it("rejects COMPLETED if paymentStatus is UNPAID with 409 BOOKING_NOT_PAID", async () => {
      mockBooking.status = "READY_FOR_PICKUP";
      mockBooking.paymentStatus = "UNPAID";
      const admin = { id: 1, role: "ADMIN" };

      await expect(transition(mockTx, 100, "COMPLETED", admin)).rejects.toMatchObject({
        statusCode: 409,
        code: "BOOKING_NOT_PAID",
      });
    });
  });
});
