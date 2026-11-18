import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect, vi } from "vitest";
import prisma, { pool } from "../../src/config/prisma.js";
import env from "../../src/config/env.js";
import * as crypto from "../../src/utils/crypto.js";
import { login } from "../../src/services/auth.service.js";
import { verifyOtp } from "../../src/services/registrationOtp.service.js";
import { resetTestDb } from "../helpers/db.js";
import { workshopFixture } from "../helpers/workshop.js";

describe("PostgreSQL authentication race guards", () => {
  let f;
  beforeAll(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
  beforeEach(async () => {
    await resetTestDb();
    f = await workshopFixture();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await resetTestDb();
    await prisma.$disconnect();
    await pool.end();
  });
  it("counts parallel failed logins and locks the account after five failures", async () => {
    await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        login({ email: f.customer.email, password: "WrongPassword123!" })
      )
    );
    const user = await prisma.user.findUnique({
      where: { id: f.customer.id },
      select: { failedLoginCount: true, lockedUntil: true },
    });
    expect(user.failedLoginCount).toBe(5);
    expect(user.lockedUntil.getTime()).toBeGreaterThan(Date.now());
    await expect(
      login({ email: f.customer.email, password: "TestPassword123!" })
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
  });
  it("invalidates an OTP after five concurrent wrong attempts", async () => {
    await prisma.user.update({ where: { id: f.customer.id }, data: { isVerified: false } });
    const otp = await prisma.registrationOtp.create({
      data: {
        userId: f.customer.id,
        codeHash: crypto.hmacSha256("123456", env.OTP_HMAC_SECRET),
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    await Promise.allSettled(
      Array.from({ length: 10 }, () => verifyOtp({ email: f.customer.email, code: "000000" }))
    );
    const current = await prisma.registrationOtp.findUnique({ where: { id: otp.id } });
    expect(current.attempts).toBe(5);
    expect(current.consumedAt).not.toBeNull();
    await expect(verifyOtp({ email: f.customer.email, code: "123456" })).rejects.toMatchObject({
      code: "INVALID_OTP",
    });
  });
  it("does not issue a session when password changes during verification", async () => {
    vi.spyOn(crypto, "verifyPassword").mockImplementationOnce(async () => {
      await prisma.user.update({
        where: { id: f.customer.id },
        data: {
          passwordHash: await crypto.hashPassword("NewPassword123!"),
          tokenVersion: { increment: 1 },
        },
      });
      return true;
    });
    await expect(
      login({ email: f.customer.email, password: "TestPassword123!" })
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(await prisma.refreshToken.count({ where: { userId: f.customer.id } })).toBe(0);
  });
});
