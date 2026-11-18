import { beforeEach, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { signAccessToken } from "../../src/utils/jwt.js";
import env from "../../src/config/env.js";
import { handleSocketConnection, socketAuthMiddleware } from "../../src/config/socket.js";
import { emitRealtimeEvent, setSocketIoInstance } from "../../src/services/realtime.service.js";
import { runNoShowCheck } from "../../src/jobs/noShow.job.js";
import { initScheduler, stopScheduler } from "../../src/jobs/scheduler.js";

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
    lockCustomer: vi.fn(),
    lockBooking: vi.fn(),
    lockInvoices: vi.fn(),
  };
});

describe("Fase 5 Socket.IO Handshake Auth & Realtime Room Isolation", () => {
  let mockUsers;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockUsers = [
      {
        id: 10,
        email: "customer@gmail.com",
        name: "Customer A",
        role: "CUSTOMER",
        outletId: null,
        isActive: true,
        isVerified: true,
        tokenVersion: 1,
        deletedAt: null,
      },
      {
        id: 20,
        email: "mechanic@tallero.id",
        name: "Mechanic B",
        role: "MECHANIC",
        outletId: 1,
        isActive: true,
        isVerified: true,
        tokenVersion: 1,
        deletedAt: null,
      },
      {
        id: 1,
        email: "admin@tallero.id",
        name: "Admin C",
        role: "ADMIN",
        outletId: null,
        isActive: true,
        isVerified: true,
        tokenVersion: 1,
        deletedAt: null,
      },
      {
        id: 99,
        email: "inactive@tallero.id",
        name: "Deactivated User",
        role: "CUSTOMER",
        outletId: null,
        isActive: false,
        isVerified: true,
        tokenVersion: 1,
        deletedAt: null,
      },
      {
        id: 98,
        email: "unverified@tallero.id",
        name: "Unverified User",
        role: "CUSTOMER",
        outletId: null,
        isActive: true,
        isVerified: false,
        tokenVersion: 1,
        deletedAt: null,
      },
    ];

    storeRef.current = {
      user: {
        findUnique: vi.fn(async ({ where }) => {
          return mockUsers.find((u) => u.id === where.id) || null;
        }),
      },
    };
  });

  it("menolak koneksi socket tanpa token autentikasi (AUTH_TOKEN_MISSING)", async () => {
    const socket = {
      handshake: { auth: {} },
    };

    let capturedErr = null;
    await socketAuthMiddleware(socket, (err) => {
      capturedErr = err;
    });

    expect(capturedErr).toBeDefined();
    expect(capturedErr.data?.code).toBe("AUTH_TOKEN_MISSING");
  });

  it("menolak koneksi socket dengan token tidak valid atau expired (INVALID_TOKEN)", async () => {
    const socket = {
      handshake: { auth: { token: "invalid.jwt.token" } },
    };

    let capturedErr = null;
    await socketAuthMiddleware(socket, (err) => {
      capturedErr = err;
    });

    expect(capturedErr).toBeDefined();
    expect(capturedErr.data?.code).toBe("INVALID_TOKEN");
  });

  it.each([undefined, "bad", "0", "-1", "1.5"])(
    "menolak subject JWT tidak valid %s sebelum query database",
    async (sub) => {
      const token = jwt.sign(
        { ...(sub === undefined ? {} : { sub }), role: "ADMIN", tokenVersion: 1 },
        env.JWT_SECRET,
        { algorithm: "HS256" }
      );
      const next = vi.fn();
      await socketAuthMiddleware({ handshake: { auth: { token } } }, next);
      expect(next.mock.calls[0][0].data.code).toBe("INVALID_TOKEN");
      expect(storeRef.current.user.findUnique).not.toHaveBeenCalled();
    }
  );

  it("menolak koneksi socket untuk user yang dinonaktifkan (ACCOUNT_INACTIVE)", async () => {
    const token = signAccessToken({ userId: 99, role: "CUSTOMER", tokenVersion: 1 });

    const socket = {
      handshake: { auth: { token } },
    };

    let capturedErr = null;
    await socketAuthMiddleware(socket, (err) => {
      capturedErr = err;
    });

    expect(capturedErr).toBeDefined();
    expect(capturedErr.data?.code).toBe("ACCOUNT_INACTIVE");
  });

  it("menolak koneksi socket untuk user dengan tokenVersion lama / telah dicabut (TOKEN_REVOKED)", async () => {
    // Token berisi tokenVersion 0, sedangkan di database tokenVersion adalah 1
    const token = signAccessToken({ userId: 10, role: "CUSTOMER", tokenVersion: 0 });

    const socket = {
      handshake: { auth: { token } },
    };

    let capturedErr = null;
    await socketAuthMiddleware(socket, (err) => {
      capturedErr = err;
    });

    expect(capturedErr).toBeDefined();
    expect(capturedErr.data?.code).toBe("TOKEN_REVOKED");
  });

  it("menerima koneksi socket terautentikasi dan mengisolasi room per role (Customer, Mekanik, Admin)", async () => {
    // 1. Customer
    const customerToken = signAccessToken({ userId: 10, role: "CUSTOMER", tokenVersion: 1 });
    const customerSocket = {
      handshake: { auth: { token: customerToken } },
      joinedRooms: new Set(),
      join: function (r) {
        this.joinedRooms.add(r);
      },
      on: vi.fn(),
    };

    let custErr = null;
    await socketAuthMiddleware(customerSocket, (err) => {
      custErr = err;
    });
    expect(custErr).toBeUndefined();
    handleSocketConnection(customerSocket);

    // Customer hanya berada di room miliknya sendiri
    expect(customerSocket.joinedRooms.has("user:10")).toBe(true);
    expect(customerSocket.joinedRooms.has("admin")).toBe(false);
    expect(customerSocket.joinedRooms.has("outlet:1:staff")).toBe(false);

    // 2. Mekanik
    const mechanicToken = signAccessToken({ userId: 20, role: "MECHANIC", tokenVersion: 1 });
    const mechanicSocket = {
      handshake: { auth: { token: mechanicToken } },
      joinedRooms: new Set(),
      join: function (r) {
        this.joinedRooms.add(r);
      },
      on: vi.fn(),
    };

    await socketAuthMiddleware(mechanicSocket, () => {});
    handleSocketConnection(mechanicSocket);

    // Mekanik berada di room user-nya dan room staf outlet-nya
    expect(mechanicSocket.joinedRooms.has("user:20")).toBe(true);
    expect(mechanicSocket.joinedRooms.has("outlet:1:staff")).toBe(true);
    expect(mechanicSocket.joinedRooms.has("admin")).toBe(false);

    // 3. Admin
    const adminToken = signAccessToken({ userId: 1, role: "ADMIN", tokenVersion: 1 });
    const adminSocket = {
      handshake: { auth: { token: adminToken } },
      joinedRooms: new Set(),
      join: function (r) {
        this.joinedRooms.add(r);
      },
      on: vi.fn(),
    };

    await socketAuthMiddleware(adminSocket, () => {});
    handleSocketConnection(adminSocket);

    // Admin berada di room user-nya dan room global admin
    expect(adminSocket.joinedRooms.has("user:1")).toBe(true);
    expect(adminSocket.joinedRooms.has("admin")).toBe(true);
  });

  it("memastikan isolasi event realtime: User A tidak menerima event milik User B dan menolak broadcast global", () => {
    const emittedEvents = [];
    const mockSocketServer = {
      to: (room) => ({
        to: (r2) => ({
          emit: (ev, data) => emittedEvents.push({ rooms: [room, r2], ev, data }),
        }),
        emit: (ev, data) => emittedEvents.push({ rooms: [room], ev, data }),
      }),
      emit: vi.fn(), // Dilarang terpanggil
    };

    setSocketIoInstance(mockSocketServer);

    // 1. Emit ke User A (user:10)
    emitRealtimeEvent("booking:status_changed", { code: "TLR-A" }, ["user:10"]);
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].rooms).toEqual(["user:10"]);
    expect(emittedEvents[0].rooms.includes("user:20")).toBe(false);

    // 2. Broadcast global tanpa room otomatis ditolak (tidak memanggil io.emit)
    emitRealtimeEvent("booking:status_changed", { code: "TLR-GLOBAL" }, []);
    expect(mockSocketServer.emit).not.toHaveBeenCalled();
  });
});

describe("Fase 5 Background Jobs & Scheduler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("menjalankan runNoShowCheck: menandai booking PENDING yang telah melewati batas grace period menjadi NO_SHOW", async () => {
    const baseNow = new Date("2026-11-20T12:00:00.000Z");

    const mockBookings = [
      {
        id: 901,
        code: "TLR-EXP-001",
        outletId: 1,
        customerId: 10,
        status: "PENDING",
        scheduledAt: new Date("2026-11-20T09:00:00.000Z"),
        slotEndAt: new Date("2026-11-20T10:00:00.000Z"), // Selesai jam 10:00, grace period habis jam 11:00 (now: 12:00)
      },
      {
        id: 902,
        code: "TLR-ACTIVE-002",
        outletId: 1,
        customerId: 10,
        status: "PENDING",
        scheduledAt: new Date("2026-11-20T11:30:00.000Z"),
        slotEndAt: new Date("2026-11-20T12:30:00.000Z"), // Belum lewat
      },
    ];

    storeRef.current = {
      booking: {
        findMany: vi.fn(async () => [mockBookings[0]]),
        findUnique: vi.fn(async () => ({ ...mockBookings[0] })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      bookingLog: {
        create: vi.fn(async () => ({})),
      },
    };

    const summary = await runNoShowCheck(baseNow);
    expect(summary.markedCount).toBe(1);
    expect(summary.bookingIds).toEqual([901]);
  });

  it("menginisialisasi scheduler saat ENABLE_JOBS aktif dan dapat dihentikan dengan stopScheduler", () => {
    const origEnable = env.ENABLE_JOBS;

    // Saat dinonaktifkan
    env.ENABLE_JOBS = false;
    const resInactive = initScheduler();
    expect(resInactive.active).toBe(false);

    // Saat diaktifkan
    env.ENABLE_JOBS = true;
    const resActive = initScheduler();
    expect(resActive.active).toBe(true);
    expect(resActive.tasks.length).toBeGreaterThanOrEqual(1);

    // Stop scheduler
    expect(() => stopScheduler()).not.toThrow();

    env.ENABLE_JOBS = origEnable;
  });
});
