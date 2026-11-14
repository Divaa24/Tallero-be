import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../src/app.js";
import prisma from "../../src/config/prisma.js";
import * as mailService from "../../src/services/mail.service.js";
import { hashPassword } from "../../src/utils/crypto.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { resetTestDb } from "../helpers/db.js";

/**
 * Integration tests HTTP end-to-end dengan PostgreSQL test database (TEST_DATABASE_URL).
 */
describe("Auth API integration (/api/v1/auth & /api/v1/files)", () => {
  const capturedEmails = [];

  beforeAll(async () => {
    await prisma.$connect();
    await resetTestDb();
  });

  beforeEach(async () => {
    capturedEmails.length = 0;
    vi.restoreAllMocks();
    vi.spyOn(mailService, "sendMail").mockImplementation(async (payload) => {
      capturedEmails.push(payload);
      return { accepted: [payload.to], driver: "console" };
    });

    await resetTestDb();
  });

  afterAll(async () => {
    await resetTestDb();
    await prisma.$disconnect();
  });

  it("completes register -> verify OTP -> web httpOnly cookie refresh -> reuse detection -> logout-all", async () => {
    // Mass-assignment attempt blocked by Zod .strict()
    const badReg = await request(app).post("/api/v1/auth/register").send({
      name: "Hacker",
      email: "hacker@example.com",
      password: "Password123",
      phone: "081234567890",
      role: "ADMIN",
    });
    expect(badReg.status).toBe(400);

    const regRes = await request(app).post("/api/v1/auth/register").send({
      name: "Budi Integration",
      email: "BUDI.INT@Example.COM",
      password: "Password123",
      phone: "0812-3456-7890",
    });
    expect(regRes.status).toBe(200);
    expect(capturedEmails).toHaveLength(1);

    const otpCode = capturedEmails[0].text.match(/\b(\d{6})\b/)[1];
    const verifyRes = await request(app)
      .post("/api/v1/auth/verify-otp")
      .set("X-Client", "web")
      .send({ email: "budi.int@example.com", code: otpCode });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.accessToken).toBeTypeOf("string");
    expect(verifyRes.body.data.refreshToken).toBeUndefined();
    const cookies = verifyRes.headers["set-cookie"];
    expect(cookies.some((c) => c.startsWith("refreshToken=") && c.includes("HttpOnly"))).toBe(true);

    // Web client refreshes using httpOnly cookie
    const refreshRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("X-Client", "web")
      .set("Cookie", cookies);
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.refreshToken).toBeUndefined();

    // Reuse old cookie triggers 401 TOKEN_REUSE_DETECTED
    const reuseRes = await request(app)
      .post("/api/v1/auth/refresh")
      .set("X-Client", "web")
      .set("Cookie", cookies);
    expect(reuseRes.status).toBe(401);
    expect(reuseRes.body.error.code).toBe("TOKEN_REUSE_DETECTED");

    // Mobile login returns refreshToken in body
    const mobileLogin = await request(app).post("/api/v1/auth/login").send({
      email: "budi.int@example.com",
      password: "Password123",
    });
    expect(mobileLogin.status).toBe(200);
    expect(mobileLogin.body.data.refreshToken).toBeTypeOf("string");

    const accessToken = mobileLogin.body.data.accessToken;
    const logoutAllRes = await request(app)
      .post("/api/v1/auth/logout-all")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(logoutAllRes.status).toBe(200);

    // TokenVersion bumped -> old accessToken rejected immediately
    const meAfterLogoutAll = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(meAfterLogoutAll.status).toBe(401);
  });

  it("uploads avatar via sharp WebP conversion and serves via signed URL", async () => {
    const user = await prisma.user.create({
      data: {
        name: "Avatar User",
        email: "avatar@example.com",
        passwordHash: await hashPassword("Password123"),
        phone: "+6281234567892",
        role: "CUSTOMER",
        isActive: true,
        isVerified: true,
      },
    });

    const accessToken = signAccessToken({
      userId: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });

    const imgBuffer = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();

    const uploadRes = await request(app)
      .post("/api/v1/auth/me/avatar")
      .set("Authorization", `Bearer ${accessToken}`)
      .attach("avatar", imgBuffer, "test.png");

    expect(uploadRes.status).toBe(200);
    const avatarUrl = uploadRes.body.data.avatarUrl;
    expect(avatarUrl).toMatch(/^\/api\/v1\/files\/avatar\/.+\?exp=\d+&sig=[a-f0-9]+$/);

    const downloadRes = await request(app).get(avatarUrl);
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers["content-type"]).toContain("image/webp");

    const tamperedRes = await request(app).get(
      `${avatarUrl.replace(/sig=[a-f0-9]+/, `sig=${"0".repeat(64)}`)}`
    );
    expect(tamperedRes.status).toBe(403);
  });

  it("blocks mustChangePassword users with 403 PASSWORD_CHANGE_REQUIRED on PATCH /me until changed", async () => {
    const staff = await prisma.user.create({
      data: {
        name: "Temp Mechanic",
        email: "mech.temp@example.com",
        passwordHash: await hashPassword("TempPass123"),
        phone: "+6281234567893",
        role: "MECHANIC",
        isActive: true,
        isVerified: true,
        mustChangePassword: true,
      },
    });

    const token = signAccessToken({
      userId: staff.id,
      role: staff.role,
      tokenVersion: staff.tokenVersion,
    });

    const blocked = await request(app)
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Updated" });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    const changed = await request(app)
      .post("/api/v1/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: "TempPass123", newPassword: "NewStrongPass123" });
    expect(changed.status).toBe(200);
  });
});
