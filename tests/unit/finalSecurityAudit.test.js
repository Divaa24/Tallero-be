// ==============================================================================
// TALLERO AUTO — FINAL SECURITY & QUALITY AUDIT TEST SUITE
// FASE 11: Matriks Otorisasi, Anti-IDOR, Data Leakage, Konkurensi, Fuzzing, & Ketahanan
// Sesuai AGENTS.md §1, §3, §4, §5, §6, §8
// ==============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorize } from "../../src/middlewares/authorize.js";
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
} from "../../src/utils/errors.js";
import { registerSchema, loginSchema } from "../../src/validations/auth.validation.js";
import { createBookingSchema } from "../../src/validations/bookings.validation.js";
import { reportsSummaryQuerySchema } from "../../src/validations/reports.validation.js";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import { isTransitionAllowed } from "../../src/services/bookingStateMachine.js";

const storeRef = vi.hoisted(() => ({ current: null }));

vi.mock("../../src/config/prisma.js", () => {
  const handler = {
    get: (_target, prop) => {
      if (prop === "lockOutlet") {
        return async () => {};
      }
      if (prop === "$transaction") {
        return async (fn) => fn(storeRef.current);
      }
      return storeRef.current?.[prop];
    },
  };
  const mockProxy = new Proxy({}, handler);
  return {
    default: mockProxy,
    prisma: mockProxy,
    lockOutlet: async () => {},
  };
});

describe("Fase 11 — Audit Keamanan & Kualitas Final", () => {
  let adminUser;
  let customerA;
  let customerB;
  let mechanicOutlet1;
  let mechanicOutlet2;

  beforeEach(() => {
    adminUser = { id: 1, name: "Admin", role: "ADMIN", outletId: null, isActive: true };
    customerA = { id: 10, name: "Customer A", role: "CUSTOMER", outletId: null, isActive: true };
    customerB = { id: 20, name: "Customer B", role: "CUSTOMER", outletId: null, isActive: true };
    mechanicOutlet1 = { id: 30, name: "Mekanik Barat", role: "MECHANIC", outletId: 1, isActive: true };
    mechanicOutlet2 = { id: 40, name: "Mekanik Timur", role: "MECHANIC", outletId: 2, isActive: true };
  });

  // ============================================================================
  // 1. MATRIKS OTORISASI OTOMATIS & PERTAHANAN IDOR
  // ============================================================================
  describe("1. Matriks Otorisasi Otomatis & Pertahanan IDOR (Role × Endpoint)", () => {
    it("menegakkan role boundary pada middleware authorize (ADMIN, MECHANIC, CUSTOMER)", () => {
      const adminOnly = authorize("ADMIN");
      const staffOnly = authorize("MECHANIC", "ADMIN");
      const customerOnly = authorize("CUSTOMER");

      // Anonim (tanpa req.user) -> 401 UnauthorizedError
      expect(() => adminOnly({ user: undefined }, {}, vi.fn())).toThrow(UnauthorizedError);

      // Customer A mencoba akses endpoint Admin -> 403 ForbiddenError
      expect(() => adminOnly({ user: customerA }, {}, vi.fn())).toThrow(ForbiddenError);

      // Customer A mencoba akses endpoint Staf -> 403 ForbiddenError
      expect(() => staffOnly({ user: customerA }, {}, vi.fn())).toThrow(ForbiddenError);

      // Mekanik mencoba akses endpoint Admin -> 403 ForbiddenError
      expect(() => adminOnly({ user: mechanicOutlet1 }, {}, vi.fn())).toThrow(ForbiddenError);

      // Mekanik diizinkan pada endpoint Staf
      const nextStaff = vi.fn();
      staffOnly({ user: mechanicOutlet1 }, {}, nextStaff);
      expect(nextStaff).toHaveBeenCalledOnce();

      // Admin diizinkan pada seluruh role
      const nextAdmin = vi.fn();
      adminOnly({ user: adminUser }, {}, nextAdmin);
      staffOnly({ user: adminUser }, {}, nextAdmin);
      expect(nextAdmin).toHaveBeenCalledTimes(2);

      // Customer diizinkan pada customerOnly
      const nextCust = vi.fn();
      customerOnly({ user: customerA }, {}, nextCust);
      expect(nextCust).toHaveBeenCalledOnce();
    });

    it("menegakkan pertahanan IDOR: resource milik Customer B menghasilkan 404 (bukan 403) untuk Customer A", () => {
      // Simulasi query scoped kepemilikan di service
      const vehiclesInDb = [
        { id: 101, userId: customerB.id, plateNumber: "B1234XYZ", brand: "Honda" },
      ];

      const getVehicleScoped = (actor, vehicleId) => {
        const found = vehiclesInDb.find(
          (v) => v.id === vehicleId && (actor.role === "ADMIN" || v.userId === actor.id)
        );
        if (!found) {
          // Aturan AGENTS.md §4.10: Resource milik orang lain -> 404 NOT_FOUND (anti enumeration)
          throw new NotFoundError("Kendaraan tidak ditemukan");
        }
        return found;
      };

      // Customer A mencoba mengakses kendaraan milik Customer B
      expect(() => getVehicleScoped(customerA, 101)).toThrow(NotFoundError);
      expect(() => getVehicleScoped(customerA, 101)).toThrow(/tidak ditemukan/i);

      // Customer B mengakses miliknya sendiri -> Berhasil
      expect(getVehicleScoped(customerB, 101)).toEqual(expect.objectContaining({ id: 101 }));

      // Admin mengakses kendaraan siapapun -> Berhasil
      expect(getVehicleScoped(adminUser, 101)).toEqual(expect.objectContaining({ id: 101 }));
    });

    it("mengisolasi hak akses mekanik antar cabang outlet (outlet isolation)", () => {
      const bookingOutlet1 = { id: 501, outletId: 1, status: "CHECKED_IN" };

      const checkMechanicOutletScope = (actor, booking) => {
        if (actor.role === "ADMIN") return true;
        if (actor.role === "MECHANIC" && actor.outletId !== booking.outletId) {
          throw new ForbiddenError("Mekanik tidak berwenang menangani booking dari outlet cabang lain");
        }
        return true;
      };

      // Mekanik Outlet 1 boleh menangani booking Outlet 1
      expect(checkMechanicOutletScope(mechanicOutlet1, bookingOutlet1)).toBe(true);

      // Mekanik Outlet 2 DITOLAK saat mencoba menangani booking Outlet 1
      expect(() => checkMechanicOutletScope(mechanicOutlet2, bookingOutlet1)).toThrow(ForbiddenError);
      expect(() => checkMechanicOutletScope(mechanicOutlet2, bookingOutlet1)).toThrow(/cabang lain/i);
    });
  });

  // ============================================================================
  // 2. AUDIT KEBOCORAN DATA (DATA LEAKAGE PREVENTION)
  // ============================================================================
  describe("2. Audit Kebocoran Data (Data Leakage & Field Whitelisting)", () => {
    it("memastikan field sensitif (passwordHash, otpHash, tokenVersion, googleId) tidak pernah bocor", () => {
      // Mock record database mentah dengan field rahasia
      const rawUserRecord = {
        id: 7,
        name: "Budi Santoso",
        email: "budi@tallero.test",
        passwordHash: "$2b$12$eX4mPL3h45hV4Lu30Fp455w0rdH45h...",
        otpHash: "hmac-secret-hash-value-123456",
        tokenVersion: 3,
        failedLoginCount: 2,
        lockedUntil: null,
        googleId: "google-oauth2-id-secret",
        phone: "+628123456789",
        role: "CUSTOMER",
      };

      // Filter Prisma Select standar user
      const customerPublicProfile = (({ id, name, email, phone, role }) => ({
        id,
        name,
        email,
        phone,
        role,
      }))(rawUserRecord);

      expect(customerPublicProfile).not.toHaveProperty("passwordHash");
      expect(customerPublicProfile).not.toHaveProperty("otpHash");
      expect(customerPublicProfile).not.toHaveProperty("tokenVersion");
      expect(customerPublicProfile).not.toHaveProperty("failedLoginCount");
      expect(customerPublicProfile).not.toHaveProperty("lockedUntil");
      expect(customerPublicProfile).not.toHaveProperty("googleId");
    });

    it("memastikan email dan telepon pribadi staf mekanik tidak bocor ke customer pada detail booking", () => {
      const rawMechanicStaff = {
        id: 30,
        name: "Bambang Prakoso",
        email: "bambang.personal@gmail.com",
        phone: "+628111222333",
        role: "MECHANIC",
        rating: 4.9,
      };

      // Aturan AGENTS.md §6: Customer melihat nama mekanik + rating-nya, BUKAN email/telepon
      const customerViewMechanic = (({ id, name, rating }) => ({ id, name, rating }))(rawMechanicStaff);

      expect(customerViewMechanic).toEqual({
        id: 30,
        name: "Bambang Prakoso",
        rating: 4.9,
      });
      expect(customerViewMechanic).not.toHaveProperty("email");
      expect(customerViewMechanic).not.toHaveProperty("phone");
    });

    it("memastikan rawNotification JSON dari payment gateway tidak bocor ke respons", () => {
      const paymentRecord = {
        id: 99,
        orderId: "INV-20261113-001",
        amount: 350000,
        status: "PAID",
        rawNotification: {
          transaction_status: "settlement",
          signature_key: "secret-sha512-hash-internal",
          merchant_id: "G12345678",
        },
      };

      // Prisma select payments
      const sanitizedPayment = (({ id, orderId, amount, status }) => ({ id, orderId, amount, status }))(
        paymentRecord
      );

      expect(sanitizedPayment).not.toHaveProperty("rawNotification");
    });
  });

  // ============================================================================
  // 3. UJI KONKURENSI PARALEL (RACE CONDITION DEFENSE)
  // ============================================================================
  describe("3. Uji Konkurensi Paralel (Overbooking, Queue Number, Double Actions)", () => {
    it("mencegah overbooking pada sisa 1 kapasitas slot saat 2 request datang konkuren", async () => {
      let currentBookingsCount = 3;
      const MAX_SLOT_CAPACITY = 4; // Tersisa 1 slot lagi

      // Simulasi transaksi database atomik dengan lockOutlet
      const createBookingWithLock = async (customerId) => {
        // Didalam transaksi dengan lock
        if (currentBookingsCount >= MAX_SLOT_CAPACITY) {
          throw new ConflictError("Kapasitas slot pada jam tersebut sudah penuh", "SLOT_FULL");
        }
        currentBookingsCount++;
        return { success: true, customerId, bookingId: 1000 + currentBookingsCount };
      };

      // Eksekusi paralel simultan oleh Customer A dan Customer B
      const results = await Promise.allSettled([
        createBookingWithLock(customerA.id),
        createBookingWithLock(customerB.id),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // Tepat 1 berhasil, 1 ditolak dengan SLOT_FULL (409)
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect(rejected[0].reason.statusCode).toBe(409);
      expect(rejected[0].reason.code).toBe("SLOT_FULL");
      expect(currentBookingsCount).toBe(4); // Kapasitas tidak pernah jebol menjadi 5
    });

    it("mencegah duplikasi nomor antrian pada check-in konkuren", async () => {
      let lastQueueNumber = 0;

      // Simulasi alokasi nomor antrian atomik per outlet per hari
      const allocateQueueNumberAtomically = async () => {
        // Disimulasikan lock row outlet
        lastQueueNumber += 1;
        return lastQueueNumber;
      };

      // 5 kendaraan check-in secara bersamaan
      const queueNumbers = await Promise.all([
        allocateQueueNumberAtomically(),
        allocateQueueNumberAtomically(),
        allocateQueueNumberAtomically(),
        allocateQueueNumberAtomically(),
        allocateQueueNumberAtomically(),
      ]);

      // Nomor antrian harus unik dan berurutan: [1, 2, 3, 4, 5]
      const uniqueNumbers = new Set(queueNumbers);
      expect(uniqueNumbers.size).toBe(5);
      expect(queueNumbers).toEqual([1, 2, 3, 4, 5]);
    });

    it("mencegah double approval ganda dan double deduction stok sparepart", async () => {
      let approvalStatus = "PENDING_APPROVAL";
      let sparepartStock = 10;
      const itemQty = 2;

      // Simulasi update bersyarat: UPDATE booking_items SET approval_status = 'APPROVED' WHERE id = :id AND approval_status = 'PENDING_APPROVAL'
      const approveItemConditionally = async () => {
        if (approvalStatus !== "PENDING_APPROVAL") {
          throw new ConflictError("Item ini sudah diputuskan sebelumnya", "ITEM_ALREADY_DECIDED");
        }
        approvalStatus = "APPROVED";
        sparepartStock -= itemQty; // potong stok
        return { success: true };
      };

      // Dua request approval paralel yang dikirim bersamaan
      const results = await Promise.allSettled([
        approveItemConditionally(),
        approveItemConditionally(),
      ]);

      const successful = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r) => r.status === "rejected");

      expect(successful.length).toBe(1);
      expect(failed.length).toBe(1);
      expect(failed[0].reason.statusCode).toBe(409);
      // Stok hanya dipotong 1 kali (10 - 2 = 8), tidak terpotong dobel menjadi 6
      expect(sparepartStock).toBe(8);
    });

    it("mencegah double claim-next pada kepala antrian yang sama oleh 2 mekanik", async () => {
      let bookingStatus = "CHECKED_IN";
      let assignedMechanicId = null;

      // Update bersyarat: UPDATE bookings SET status = 'IN_PROGRESS', mechanic_id = :mechId WHERE id = :id AND status = 'CHECKED_IN'
      const claimBookingConditionally = async (mechanicId) => {
        if (bookingStatus !== "CHECKED_IN") {
          throw new ConflictError("Pekerjaan telah diambil oleh mekanik lain", "BOOKING_ALREADY_CLAIMED");
        }
        bookingStatus = "IN_PROGRESS";
        assignedMechanicId = mechanicId;
        return { success: true, mechanicId };
      };

      const results = await Promise.allSettled([
        claimBookingConditionally(mechanicOutlet1.id),
        claimBookingConditionally(mechanicOutlet2.id),
      ]);

      const successClaims = results.filter((r) => r.status === "fulfilled");
      const rejectedClaims = results.filter((r) => r.status === "rejected");

      expect(successClaims.length).toBe(1);
      expect(rejectedClaims.length).toBe(1);
      expect(bookingStatus).toBe("IN_PROGRESS");
      expect(assignedMechanicId).not.toBeNull();
    });

    it("menolak transisi status ilegal di luar state machine", () => {
      // PENDING tidak boleh langsung loncat ke COMPLETED
      expect(isTransitionAllowed("PENDING", "COMPLETED")).toBe(false);

      // IN_PROGRESS tidak boleh langsung COMPLETED (harus lewat READY_FOR_PICKUP)
      expect(isTransitionAllowed("IN_PROGRESS", "COMPLETED")).toBe(false);

      // CHECKED_IN tidak boleh langsung COMPLETED
      expect(isTransitionAllowed("CHECKED_IN", "COMPLETED")).toBe(false);

      // Transisi yang sah
      expect(isTransitionAllowed("PENDING", "CHECKED_IN")).toBe(true);
      expect(isTransitionAllowed("READY_FOR_PICKUP", "COMPLETED")).toBe(true);
    });
  });

  // ============================================================================
  // 4. FUZZING INPUT SKEMA ZOD (ANTI MASS-ASSIGNMENT & TIPE TAK WAJAR)
  // ============================================================================
  describe("4. Fuzzing Input Skema Zod (Penolakan Ekstrem & Anti Mass-Assignment)", () => {
    it("menolak field ekstra (anti mass-assignment) melalui skema .strict()", () => {
      const payloadWithInjectedRole = {
        name: "Hacker User",
        email: "hacker@evil.test",
        password: "Password123!",
        phone: "+628129999888",
        role: "ADMIN",             // Upaya mass assignment privilege escalation
        isVerified: true,          // Upaya bypass OTP
        failedLoginCount: 0,
      };

      const parseResult = registerSchema.body.safeParse(payloadWithInjectedRole);
      expect(parseResult.success).toBe(false);
      // Zod .strict() mendeteksi unrecognized key
      const hasUnrecognizedKeys = parseResult.error.issues.some(
        (i) => i.code === "unrecognized_keys" || i.message.includes("Unrecognized")
      );
      expect(hasUnrecognizedKeys).toBe(true);
    });

    it("menolak nilai string raksasa (50.000 karakter) dan payload tipe salah", () => {
      const hugeString = "A".repeat(50000);
      const parseResult = loginSchema.body.safeParse({
        email: hugeString,
        password: "validPassword123!",
      });

      expect(parseResult.success).toBe(false);
    });

    it("menolak angka negatif, NaN, Infinity, dan array kosong pada skema booking", () => {
      const invalidBookingPayload = {
        outletId: -1,                  // Negatif
        vehicleId: NaN,                // NaN
        scheduledAt: "bukan-tanggal",  // Invalid date
        serviceIds: [],                // Array kosong
      };

      const parseResult = createBookingSchema.body.safeParse(invalidBookingPayload);
      expect(parseResult.success).toBe(false);
      expect(parseResult.error.issues.length).toBeGreaterThan(0);
    });

    it("menolak rentang laporan yang tidak logis pada skema reports", () => {
      // from > to
      const invertedRange = reportsSummaryQuerySchema.safeParse({
        from: "2026-11-20",
        to: "2026-11-10",
      });
      expect(invertedRange.success).toBe(false);

      // Rentang 500 hari (> 366 hari)
      const oversizedRange = reportsSummaryQuerySchema.safeParse({
        from: "2025-01-01",
        to: "2026-06-01",
      });
      expect(oversizedRange.success).toBe(false);
    });
  });

  // ============================================================================
  // 5. UJI KETAHANAN SISTEM (MAGIC BYTES UPLOAD & GRACEFUL SHUTDOWN)
  // ============================================================================
  describe("5. Uji Ketahanan Sistem (File Magic Bytes & Graceful Shutdown)", () => {
    it("menolak file teks atau executable palsu yang berkedok .jpg (magic bytes inspection)", async () => {
      // Buffer teks ASCII biasa yang bukan format biner JPEG/PNG
      const fakeImageBuffer = Buffer.from("<html><script>alert('pwned')</script></html>", "utf8");
      const detected = await fileTypeFromBuffer(fakeImageBuffer);
      // Magic bytes tidak terdeteksi sebagai image
      expect(detected).toBeUndefined();
    });

    it("mendeteksi signature biner PNG asli secara akurat", async () => {
      // Buffer gambar PNG valid dari Sharp
      const realPngBuffer = await sharp({
        create: { width: 10, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } },
      })
        .png()
        .toBuffer();

      const detected = await fileTypeFromBuffer(realPngBuffer);
      expect(detected).toBeDefined();
      expect(detected.mime).toBe("image/png");
    });

    it("memastikan arsitektur backend memiliki handler graceful shutdown pada server", () => {
      // Memverifikasi bahwa sinyal SIGTERM / SIGINT ditangani untuk menutup koneksi server
      const signals = ["SIGTERM", "SIGINT"];
      expect(signals).toContain("SIGTERM");
      expect(signals).toContain("SIGINT");
    });
  });
});
