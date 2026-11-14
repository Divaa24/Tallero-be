import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => {
  const models = [
    "user",
    "outlet",
    "outletClosure",
    "category",
    "service",
    "sparepart",
    "vehicle",
    "booking",
    "bookingItem",
    "serviceReminder",
    "auditLog",
  ];
  const client = {};
  for (const m of models) {
    client[m] = {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
      count: vi.fn(async () => 0),
      create: vi.fn(async () => null),
      update: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
      delete: vi.fn(async () => null),
    };
  }
  client.$transaction = async (fn) => fn(client);
  client.$queryRaw = vi.fn(async () => [{ ready: 1 }]);
  return { mockPrisma: client };
});

vi.mock("../../src/config/prisma.js", () => ({
  default: mockPrisma,
  prisma: mockPrisma,
  withDeleted: mockPrisma,
  lockOutlet: vi.fn(),
}));

import app from "../../src/app.js";
import prisma from "../../src/config/prisma.js";
import { signAccessToken } from "../../src/utils/jwt.js";

/**
 * Menguji matriks otorisasi penuh pada seluruh endpoint Fase 3 (Public / Customer / Mechanic / Admin / mustChangePassword)
 * dengan mem-mock Prisma client agar bisa berjalan melalui Express router tanpa ketergantungan DB eksternal.
 */
describe("Fase 3 Authorization Matrix (HTTP Endpoint × Role)", () => {
  const actorMap = {
    1: {
      id: 1,
      name: "Admin",
      email: "admin@tallero.test",
      role: "ADMIN",
      outletId: null,
      isActive: true,
      isVerified: true,
      mustChangePassword: false,
      tokenVersion: 0,
    },
    2: {
      id: 2,
      name: "Mechanic",
      email: "mech@tallero.test",
      role: "MECHANIC",
      outletId: 1,
      isActive: true,
      isVerified: true,
      mustChangePassword: false,
      tokenVersion: 0,
    },
    3: {
      id: 3,
      name: "Customer",
      email: "cust@tallero.test",
      role: "CUSTOMER",
      outletId: null,
      isActive: true,
      isVerified: true,
      mustChangePassword: false,
      tokenVersion: 0,
    },
    4: {
      id: 4,
      name: "PendingStaff",
      email: "pending@tallero.test",
      role: "ADMIN",
      outletId: null,
      isActive: true,
      isVerified: true,
      mustChangePassword: true,
      tokenVersion: 0,
    },
  };

  const makeToken = (id) => {
    const u = actorMap[id];
    return signAccessToken({ userId: u.id, role: u.role, tokenVersion: u.tokenVersion });
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(prisma.user, "findUnique").mockImplementation(async ({ where }) => {
      if (where?.id && actorMap[where.id]) {
        return { ...actorMap[where.id], outlet: null, deletedAt: null };
      }
      return null;
    });
    vi.spyOn(prisma.user, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.user, "count").mockResolvedValue(0);

    vi.spyOn(prisma.outlet, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.outlet, "count").mockResolvedValue(0);
    vi.spyOn(prisma.outlet, "findFirst").mockResolvedValue(null);

    vi.spyOn(prisma.category, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.category, "count").mockResolvedValue(0);

    vi.spyOn(prisma.service, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.service, "count").mockResolvedValue(0);
    vi.spyOn(prisma.service, "findFirst").mockResolvedValue(null);

    vi.spyOn(prisma.sparepart, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.sparepart, "count").mockResolvedValue(0);

    vi.spyOn(prisma.vehicle, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.vehicle, "count").mockResolvedValue(0);
    vi.spyOn(prisma.vehicle, "findFirst").mockResolvedValue(null);

    vi.spyOn(prisma.auditLog, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.auditLog, "count").mockResolvedValue(0);
  });

  const endpoints = [
    // Public catalog & outlets (semua role termasuk anonymous boleh akses; 404 jika item mock tidak ada)
    { method: "get", path: "/api/v1/outlets", allow: ["PUBLIC", "CUSTOMER", "MECHANIC", "ADMIN"] },
    {
      method: "get",
      path: "/api/v1/outlets/1",
      allow: ["PUBLIC", "CUSTOMER", "MECHANIC", "ADMIN"],
      okStatus: [404],
    },
    {
      method: "get",
      path: "/api/v1/categories",
      allow: ["PUBLIC", "CUSTOMER", "MECHANIC", "ADMIN"],
    },
    { method: "get", path: "/api/v1/services", allow: ["PUBLIC", "CUSTOMER", "MECHANIC", "ADMIN"] },
    {
      method: "get",
      path: "/api/v1/services/1",
      allow: ["PUBLIC", "CUSTOMER", "MECHANIC", "ADMIN"],
      okStatus: [404],
    },

    // Login required (semua role login)
    { method: "get", path: "/api/v1/spareparts", allow: ["CUSTOMER", "MECHANIC", "ADMIN"] },

    // Customer only (vehicles CRUD & reminders)
    { method: "get", path: "/api/v1/vehicles", allow: ["CUSTOMER"] },
    { method: "post", path: "/api/v1/vehicles", allow: ["CUSTOMER"], okStatus: [400] },
    { method: "get", path: "/api/v1/vehicles/1", allow: ["CUSTOMER"], okStatus: [404] },
    { method: "patch", path: "/api/v1/vehicles/1", allow: ["CUSTOMER"], okStatus: [400] },
    { method: "delete", path: "/api/v1/vehicles/1", allow: ["CUSTOMER"], okStatus: [404] },
    { method: "get", path: "/api/v1/vehicles/1/reminders", allow: ["CUSTOMER"], okStatus: [404] },

    // Customer + Staff read-only (vehicle history)
    {
      method: "get",
      path: "/api/v1/vehicles/1/history",
      allow: ["CUSTOMER", "MECHANIC", "ADMIN"],
      okStatus: [404],
    },

    // Admin only endpoints
    { method: "get", path: "/api/v1/admin/users", allow: ["ADMIN"] },
    { method: "post", path: "/api/v1/admin/users", allow: ["ADMIN"], okStatus: [400] },
    { method: "get", path: "/api/v1/admin/users/999", allow: ["ADMIN"], okStatus: [404] },
    { method: "patch", path: "/api/v1/admin/users/999", allow: ["ADMIN"], okStatus: [400] },
    { method: "patch", path: "/api/v1/admin/users/999/status", allow: ["ADMIN"], okStatus: [400] },
    { method: "delete", path: "/api/v1/admin/users/999", allow: ["ADMIN"], okStatus: [404, 500] },
    {
      method: "post",
      path: "/api/v1/admin/users/999/restore",
      allow: ["ADMIN"],
      okStatus: [404, 500],
    },
    { method: "post", path: "/api/v1/admin/outlets", allow: ["ADMIN"], okStatus: [400] },
    { method: "patch", path: "/api/v1/admin/outlets/1", allow: ["ADMIN"], okStatus: [400] },
    { method: "delete", path: "/api/v1/admin/outlets/1", allow: ["ADMIN"], okStatus: [404, 500] },
    { method: "post", path: "/api/v1/admin/outlets/1/closures", allow: ["ADMIN"], okStatus: [400] },
    {
      method: "delete",
      path: "/api/v1/admin/outlets/1/closures/1",
      allow: ["ADMIN"],
      okStatus: [404, 500],
    },
    {
      method: "post",
      path: "/api/v1/admin/outlets/1/restore",
      allow: ["ADMIN"],
      okStatus: [404, 500],
    },
    { method: "post", path: "/api/v1/admin/categories", allow: ["ADMIN"], okStatus: [400] },
    { method: "patch", path: "/api/v1/admin/categories/1", allow: ["ADMIN"], okStatus: [400] },
    {
      method: "delete",
      path: "/api/v1/admin/categories/1",
      allow: ["ADMIN"],
      okStatus: [404, 500],
    },
    {
      method: "post",
      path: "/api/v1/admin/categories/1/restore",
      allow: ["ADMIN"],
      okStatus: [404, 500],
    },
    { method: "post", path: "/api/v1/admin/services", allow: ["ADMIN"], okStatus: [400] },
    { method: "patch", path: "/api/v1/admin/services/1", allow: ["ADMIN"], okStatus: [400] },
    { method: "delete", path: "/api/v1/admin/services/1", allow: ["ADMIN"], okStatus: [404, 500] },
    {
      method: "post",
      path: "/api/v1/admin/services/1/restore",
      allow: ["ADMIN"],
      okStatus: [404, 500],
    },
    { method: "post", path: "/api/v1/admin/spareparts", allow: ["ADMIN"], okStatus: [400] },
    { method: "patch", path: "/api/v1/admin/spareparts/1", allow: ["ADMIN"], okStatus: [400] },
    {
      method: "post",
      path: "/api/v1/admin/spareparts/1/adjust-stock",
      allow: ["ADMIN"],
      okStatus: [400],
    },
    {
      method: "delete",
      path: "/api/v1/admin/spareparts/1",
      allow: ["ADMIN"],
      okStatus: [404, 500],
    },
    {
      method: "post",
      path: "/api/v1/admin/spareparts/1/restore",
      allow: ["ADMIN"],
      okStatus: [404, 500],
    },
    { method: "get", path: "/api/v1/admin/audit-logs", allow: ["ADMIN"] },
  ];

  const roles = [
    { label: "PUBLIC", token: null },
    { label: "CUSTOMER", token: () => makeToken(3) },
    { label: "MECHANIC", token: () => makeToken(2) },
    { label: "ADMIN", token: () => makeToken(1) },
    { label: "MUST_CHANGE_PASSWORD", token: () => makeToken(4) },
  ];

  it("enforces expected allow/401/403 status codes across all Fase 3 routes and roles", async () => {
    for (const ep of endpoints) {
      for (const role of roles) {
        const req = request(app)[ep.method](ep.path);
        const token = typeof role.token === "function" ? role.token() : null;
        if (token) {
          req.set("Authorization", `Bearer ${token}`);
        }

        const res = await req;
        const isPublicRoute = ep.allow.includes("PUBLIC");

        if (role.label === "PUBLIC" && !isPublicRoute) {
          expect(res.status, `${ep.method.toUpperCase()} ${ep.path} as ${role.label}`).toBe(401);
          continue;
        }

        if (role.label === "MUST_CHANGE_PASSWORD" && !isPublicRoute) {
          expect(res.status, `${ep.method.toUpperCase()} ${ep.path} as ${role.label}`).toBe(403);
          expect(res.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
          continue;
        }

        if (!isPublicRoute && !ep.allow.includes(role.label)) {
          expect(res.status, `${ep.method.toUpperCase()} ${ep.path} as ${role.label}`).toBe(403);
          expect(res.body.error.code).toBe("FORBIDDEN");
          continue;
        }

        const allowedStatuses = ep.okStatus ?? [200];
        expect(
          [200, ...allowedStatuses],
          `${ep.method.toUpperCase()} ${ep.path} as ${role.label} got ${res.status}`
        ).toContain(res.status);
      }
    }
  });
});
