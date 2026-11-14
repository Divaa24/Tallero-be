import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import {
  AppError,
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
  ValidationError,
} from "../../src/utils/errors.js";
import { sendError, sendSuccess } from "../../src/utils/response.js";
import { buildPaginationMeta, parsePagination, parseSort } from "../../src/utils/pagination.js";
import { validate } from "../../src/middlewares/validate.js";
import { errorHandler, notFoundHandler } from "../../src/middlewares/errorHandler.js";

const createMockRes = () => {
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
  return res;
};

describe("Unit: Foundation (errors, response, pagination, validate, errorHandler)", () => {
  it("kelas error memiliki statusCode dan code yang sesuai konvensi AGENTS.md §3", () => {
    expect(new ValidationError().statusCode).toBe(400);
    expect(new UnauthorizedError().statusCode).toBe(401);
    expect(new ForbiddenError().statusCode).toBe(403);
    expect(new NotFoundError().statusCode).toBe(404);
    expect(new ConflictError().statusCode).toBe(409);
    expect(new BusinessRuleError().statusCode).toBe(422);
    expect(new TooManyRequestsError().statusCode).toBe(429);
    expect(new AppError("err", 503, "SERVICE_DOWN").statusCode).toBe(503);
  });

  it("sendSuccess dan sendError membentuk JSON standar", () => {
    const res1 = createMockRes();
    sendSuccess(res1, {
      data: { ok: true },
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.payload).toEqual({
      success: true,
      data: { ok: true },
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res2 = createMockRes();
    sendError(res2, { statusCode: 400, code: "BAD", message: "Salah", details: [{ field: "x" }] });
    expect(res2.statusCode).toBe(400);
    expect(res2.payload).toEqual({
      success: false,
      error: { code: "BAD", message: "Salah", details: [{ field: "x" }] },
    });
  });

  it("pagination & sort membatasi limit maksimal 100 dan memvalidasi whitelist", () => {
    expect(parsePagination({ page: "2", limit: "500" })).toEqual({
      page: 2,
      limit: 100,
      skip: 100,
    });
    expect(buildPaginationMeta({ page: 1, limit: 20, total: 45 })).toEqual({
      page: 1,
      limit: 20,
      total: 45,
      totalPages: 3,
    });
    expect(parseSort("name:desc", ["name", "createdAt"])).toEqual({ name: "desc" });
    expect(parseSort("passwordHash:asc", ["name", "createdAt"])).toEqual({ createdAt: "desc" });
  });

  it("validate menyimpan hasil di req.valid tanpa memodifikasi req.query dan menerapkan .strict()", () => {
    const mw = validate({
      params: z.object({ id: z.coerce.number().int().positive() }),
      query: z.object({ page: z.coerce.number().int().min(1).default(1) }),
      body: z.object({ name: z.string().min(2) }),
    });

    const req = {
      params: { id: "7" },
      body: { name: "Tallero" },
    };
    Object.defineProperty(req, "query", {
      get: () => ({ page: "3" }),
      enumerable: true,
    });

    const nextOk = vi.fn();
    mw(req, createMockRes(), nextOk);
    expect(nextOk).toHaveBeenCalledWith();
    expect(req.valid).toEqual({
      params: { id: 7 },
      query: { page: 3 },
      body: { name: "Tallero" },
    });

    // Mass-assignment field tak dikenal -> 400 ValidationError
    const reqBad = {
      params: { id: "7" },
      query: {},
      body: { name: "Tallero", role: "ADMIN" },
    };
    const nextErr = vi.fn();
    mw(reqBad, createMockRes(), nextErr);
    expect(nextErr.mock.calls[0][0]).toBeInstanceOf(ValidationError);
    expect(nextErr.mock.calls[0][0].details[0].code).toBe("unrecognized_keys");
  });

  it("errorHandler menangani 404, Prisma P2002/P2025, Multer, JWT, dan error tak terduga tanpa stack trace", () => {
    const next404 = vi.fn();
    notFoundHandler({ method: "GET", originalUrl: "/api/v1/none" }, createMockRes(), next404);
    expect(next404.mock.calls[0][0]).toBeInstanceOf(NotFoundError);

    const resP2002 = createMockRes();
    errorHandler({ code: "P2002", meta: { target: ["email"] } }, {}, resP2002, () => {});
    expect(resP2002.statusCode).toBe(409);
    expect(resP2002.payload.error.code).toBe("DUPLICATE_RESOURCE");

    const resP2025 = createMockRes();
    errorHandler({ code: "P2025" }, {}, resP2025, () => {});
    expect(resP2025.statusCode).toBe(404);

    const resMulter = createMockRes();
    errorHandler(
      { name: "MulterError", code: "LIMIT_FILE_SIZE", field: "photo" },
      {},
      resMulter,
      () => {}
    );
    expect(resMulter.statusCode).toBe(400);
    expect(resMulter.payload.error.code).toBe("UPLOAD_LIMIT_FILE_SIZE");

    const resJwt = createMockRes();
    errorHandler({ name: "TokenExpiredError" }, {}, resJwt, () => {});
    expect(resJwt.statusCode).toBe(401);
    expect(resJwt.payload.error.code).toBe("TOKEN_EXPIRED");

    const resInternal = createMockRes();
    errorHandler(
      new Error("rahasia stack db"),
      { id: "1", method: "GET", originalUrl: "/" },
      resInternal,
      () => {}
    );
    expect(resInternal.statusCode).toBe(500);
    expect(resInternal.payload.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(resInternal.payload)).not.toContain("rahasia stack db");
  });
});
