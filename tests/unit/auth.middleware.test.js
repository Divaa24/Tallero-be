import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "../../src/config/prisma.js";
import env from "../../src/config/env.js";
import { signAccessToken, verifyAccessToken } from "../../src/utils/jwt.js";
import authenticate from "../../src/middlewares/authenticate.js";
import { authorize, authorizePasswordChangeAllowed } from "../../src/middlewares/authorize.js";

describe("jwt, authenticate, and authorize middlewares", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("pins HS256 and rejects none-algorithm or expired tokens", () => {
    const valid = signAccessToken({ userId: 7, role: "CUSTOMER", tokenVersion: 2 });
    expect(verifyAccessToken(valid)).toEqual({
      userId: 7,
      role: "CUSTOMER",
      tokenVersion: 2,
    });

    const unsignedToken = jwt.sign({ sub: "7", role: "ADMIN", tokenVersion: 2 }, null, {
      algorithm: "none",
    });
    expect(() => verifyAccessToken(unsignedToken)).toThrow(/tidak valid/i);

    const expiredToken = jwt.sign({ sub: "7", role: "CUSTOMER", tokenVersion: 2 }, env.JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: -5,
    });
    expect(() => verifyAccessToken(expiredToken)).toThrow(/berakhir/i);
  });

  it("verifies active, verified, non-deleted user and tokenVersion against DB in authenticate", async () => {
    const token = signAccessToken({ userId: 10, role: "CUSTOMER", tokenVersion: 3 });

    const findUniqueSpy = vi.spyOn(prisma.user, "findUnique").mockResolvedValueOnce({
      id: 10,
      name: "Budi",
      email: "budi@example.com",
      role: "CUSTOMER",
      outletId: null,
      isActive: true,
      isVerified: true,
      mustChangePassword: false,
      tokenVersion: 3,
    });

    const req = { headers: { authorization: `Bearer ${token}` } };
    const next = vi.fn();
    await authenticate(req, {}, next);
    expect(findUniqueSpy).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 10 } }));
    expect(req.user).toMatchObject({ id: 10, role: "CUSTOMER", mustChangePassword: false });
    expect(next).toHaveBeenCalledOnce();

    // TokenVersion mismatch after change-password -> 401
    findUniqueSpy.mockResolvedValueOnce({
      id: 10,
      name: "Budi",
      email: "budi@example.com",
      role: "CUSTOMER",
      outletId: null,
      isActive: true,
      isVerified: true,
      mustChangePassword: false,
      tokenVersion: 4,
    });

    await expect(
      authenticate({ headers: { authorization: `Bearer ${token}` } }, {}, vi.fn())
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "UNAUTHORIZED",
    });

    // Deactivated user -> 401
    findUniqueSpy.mockResolvedValueOnce({
      id: 10,
      isActive: false,
      isVerified: true,
      tokenVersion: 3,
    });
    await expect(
      authenticate({ headers: { authorization: `Bearer ${token}` } }, {}, vi.fn())
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("blocks mustChangePassword users on authorize() while permitting password-change flow", () => {
    const tempStaffReq = {
      user: { id: 2, role: "MECHANIC", mustChangePassword: true },
    };

    expect(() => authorize("MECHANIC", "ADMIN")(tempStaffReq, {}, vi.fn())).toThrowError(
      /wajib mengganti password/i
    );
    try {
      authorize("MECHANIC", "ADMIN")(tempStaffReq, {}, vi.fn());
    } catch (err) {
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe("PASSWORD_CHANGE_REQUIRED");
    }

    const next = vi.fn();
    authorizePasswordChangeAllowed("MECHANIC", "ADMIN")(tempStaffReq, {}, next);
    expect(next).toHaveBeenCalledOnce();

    expect(() =>
      authorize("ADMIN")(
        { user: { id: 3, role: "CUSTOMER", mustChangePassword: false } },
        {},
        vi.fn()
      )
    ).toThrow(/izin/i);
  });
});
