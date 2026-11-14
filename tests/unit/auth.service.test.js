import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma, { withDeleted } from "../../src/config/prisma.js";
import env from "../../src/config/env.js";
import * as mailService from "../../src/services/mail.service.js";
import * as registrationOtp from "../../src/services/registrationOtp.js";
import * as authService from "../../src/services/auth.service.js";
import * as sessionTokens from "../../src/services/sessionTokens.js";
import { BadGatewayError } from "../../src/utils/errors.js";
import { hashPassword, hmacSha256, sha256, verifyPassword } from "../../src/utils/crypto.js";

const buildMockStore = () => {
  let seq = 1;
  const users = [];
  const registrationOtps = [];
  const passwordResetTokens = [];
  const refreshTokens = [];

  const matchesWhere = (row, where = {}) =>
    Object.entries(where).every(([key, val]) => {
      if (key === "OR" && Array.isArray(val)) return val.some((sub) => matchesWhere(row, sub));
      if (val && typeof val === "object" && !Array.isArray(val) && !(val instanceof Date)) {
        if ("gte" in val && !(row[key] >= val.gte)) return false;
        if ("gt" in val && !(row[key] > val.gt)) return false;
        if ("lte" in val && !(row[key] <= val.lte)) return false;
        if ("lt" in val && !(row[key] < val.lt)) return false;
        return true;
      }
      return row[key] === val;
    });

  const applySelect = (row, select) => {
    if (!row) return null;
    if (!select) return { ...row };
    const out = {};
    for (const [k, v] of Object.entries(select)) {
      if (v === true) out[k] = row[k];
    }
    return out;
  };

  const applyUpdate = (row, data) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && "increment" in v) {
        row[k] = (row[k] ?? 0) + v.increment;
      } else {
        row[k] = v;
      }
    }
    row.updatedAt = new Date();
  };

  const makeModelApi = (rows, { softDelete = false } = {}) => ({
    findUnique: async ({ where, select, include }) => {
      const found = rows.find(
        (r) => (!softDelete || r.deletedAt === null) && matchesWhere(r, where)
      );
      if (!found) return null;
      const out = select ? applySelect(found, select) : { ...found };
      if (include?.user) {
        const u = users.find((x) => x.id === found.userId);
        out.user = u ? applySelect(u, include.user.select) : null;
      }
      return out;
    },
    findFirst: async ({ where, orderBy, select }) => {
      let filtered = rows.filter(
        (r) => (!softDelete || r.deletedAt === null) && matchesWhere(r, where)
      );
      if (orderBy?.createdAt === "desc") {
        filtered = [...filtered].sort((a, b) => b.createdAt - a.createdAt);
      }
      return filtered[0] ? applySelect(filtered[0], select) : null;
    },
    count: async ({ where }) =>
      rows.filter((r) => (!softDelete || r.deletedAt === null) && matchesWhere(r, where)).length,
    create: async ({ data, select }) => {
      const row = {
        id: seq++,
        attempts: 0,
        consumedAt: null,
        usedAt: null,
        revokedAt: null,
        replacedById: null,
        deletedAt: null,
        isActive: true,
        isVerified: false,
        mustChangePassword: false,
        tokenVersion: 0,
        failedLoginCount: 0,
        lockedUntil: null,
        avatarKey: null,
        outletId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      rows.push(row);
      return applySelect(row, select);
    },
    update: async ({ where, data, select }) => {
      const found = rows.find((r) => matchesWhere(r, where));
      if (!found) throw new Error("Not found");
      applyUpdate(found, data);
      return applySelect(found, select);
    },
    updateMany: async ({ where, data }) => {
      const matched = rows.filter((r) => matchesWhere(r, where));
      matched.forEach((r) => applyUpdate(r, data));
      return { count: matched.length };
    },
    deleteMany: async ({ where }) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (matchesWhere(rows[i], where)) {
          rows.splice(i, 1);
          count++;
        }
      }
      return { count };
    },
  });

  const db = {
    users,
    registrationOtps,
    passwordResetTokens,
    refreshTokens,
    user: makeModelApi(users, { softDelete: true }),
    withDeletedUser: makeModelApi(users, { softDelete: false }),
    registrationOtp: makeModelApi(registrationOtps),
    passwordResetToken: makeModelApi(passwordResetTokens),
    refreshToken: makeModelApi(refreshTokens),
  };
  return db;
};

const wireMockPrisma = (store) => {
  for (const model of ["user", "registrationOtp", "passwordResetToken", "refreshToken"]) {
    for (const method of Object.keys(store[model])) {
      vi.spyOn(prisma[model], method).mockImplementation((...args) =>
        store[model][method](...args)
      );
    }
  }
  for (const method of Object.keys(store.withDeletedUser)) {
    vi.spyOn(withDeleted.user, method).mockImplementation((...args) =>
      store.withDeletedUser[method](...args)
    );
  }
  vi.spyOn(prisma, "$transaction").mockImplementation(async (fn) => fn(prisma));
};

describe("auth security flows (mocked DB & mail)", () => {
  let store;
  let sentMails;

  beforeEach(() => {
    vi.restoreAllMocks();
    store = buildMockStore();
    wireMockPrisma(store);
    sentMails = [];
    vi.spyOn(mailService, "sendMail").mockImplementation(async (payload) => {
      sentMails.push(payload);
      return { accepted: [payload.to], driver: "console" };
    });
  });

  it("registers CUSTOMER, stores HMAC OTP, prevents enumeration on verified email, and cleans OTP on 502 mail error", async () => {
    const res1 = await registrationOtp.register({
      name: "Budi",
      email: "budi@example.com",
      password: "Password123",
      phone: "+6281234567890",
    });

    expect(store.users).toHaveLength(1);
    expect(store.users[0].role).toBe("CUSTOMER");
    expect(store.registrationOtps).toHaveLength(1);

    const otpMatch = sentMails[0].text.match(/\b(\d{6})\b/);
    expect(otpMatch).toBeTruthy();
    const otpCode = otpMatch[1];
    expect(store.registrationOtps[0].codeHash).toBe(hmacSha256(otpCode, env.OTP_HMAC_SECRET));
    expect(store.registrationOtps[0].codeHash).not.toBe(otpCode);

    // Wrong OTP 5 times locks out that OTP
    for (let i = 0; i < 5; i++) {
      await expect(
        registrationOtp.verifyOtp({ email: "budi@example.com", code: "999999" })
      ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_OTP" });
    }
    expect(store.registrationOtps[0].attempts).toBe(5);
    expect(store.registrationOtps[0].consumedAt).not.toBeNull();

    // Even valid OTP code now fails because max attempts exceeded -> consumed
    await expect(
      registrationOtp.verifyOtp({ email: "budi@example.com", code: otpCode })
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_OTP" });

    // Resend within 60s hits cooldown
    await expect(registrationOtp.resendOtp({ email: "budi@example.com" })).rejects.toMatchObject({
      statusCode: 429,
      code: "OTP_COOLDOWN",
    });

    // Age previous OTP past cooldown and test 502 mail error cleans failed OTP row
    store.registrationOtps[0].createdAt = new Date(Date.now() - 120 * 1000);
    vi.spyOn(mailService, "sendMail").mockRejectedValueOnce(
      new BadGatewayError("Mail down", "EMAIL_DELIVERY_FAILED")
    );
    await expect(registrationOtp.resendOtp({ email: "budi@example.com" })).rejects.toMatchObject({
      statusCode: 502,
      code: "EMAIL_DELIVERY_FAILED",
    });
    expect(store.registrationOtps).toHaveLength(1);

    // Immediate resend succeeds because failed OTP was removed
    await registrationOtp.resendOtp({ email: "budi@example.com" });
    const otp2 = sentMails[1].text.match(/\b(\d{6})\b/)[1];
    const verified = await registrationOtp.verifyOtp({ email: "budi@example.com", code: otp2 });
    expect(verified.accessToken).toBeTypeOf("string");
    expect(verified.refreshToken).toBeTypeOf("string");
    expect(verified.user.isVerified).toBe(true);
    expect(verified.user.passwordHash).toBeUndefined();

    // Registering same verified email returns identical message without sending new mail or modifying user
    const res2 = await registrationOtp.register({
      name: "Spoofer",
      email: "budi@example.com",
      password: "Password999",
      phone: "+628111111111",
    });
    expect(res2).toEqual(res1);
    expect(sentMails).toHaveLength(2);
    expect(store.users[0].name).toBe("Budi");
  });

  it("enforces login security: dummyCompare on missing user, password check before status leak, and 5-fail lockout", async () => {
    const passwordHash = await hashPassword("ValidPass123");
    store.users.push({
      id: 1,
      name: "Sari",
      email: "sari@example.com",
      passwordHash,
      phone: "+6281234567890",
      address: null,
      avatarKey: crypto.randomUUID(),
      role: "CUSTOMER",
      outletId: null,
      isActive: true,
      isVerified: true,
      mustChangePassword: false,
      tokenVersion: 0,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
      deletedAt: null,
      createdAt: new Date(),
    });
    store.users.push({
      id: 2,
      name: "Suspended",
      email: "suspended@example.com",
      passwordHash,
      phone: "+6281234567891",
      role: "CUSTOMER",
      isActive: false,
      isVerified: true,
      mustChangePassword: false,
      tokenVersion: 0,
      failedLoginCount: 0,
      lockedUntil: null,
      deletedAt: null,
      createdAt: new Date(),
    });

    // Missing user -> 401
    await expect(
      authService.login({ email: "nobody@example.com", password: "ValidPass123" })
    ).rejects.toMatchObject({ statusCode: 401, code: "INVALID_CREDENTIALS" });

    // Inactive account with WRONG password returns 401 (never leaks disabled status)
    await expect(
      authService.login({ email: "suspended@example.com", password: "WrongPassword1" })
    ).rejects.toMatchObject({ statusCode: 401, code: "INVALID_CREDENTIALS" });

    // Inactive account with RIGHT password checks password first then reports 403 ACCOUNT_INACTIVE
    await expect(
      authService.login({ email: "suspended@example.com", password: "ValidPass123" })
    ).rejects.toMatchObject({ statusCode: 403, code: "ACCOUNT_INACTIVE" });

    // 5 failed logins lock account for 15 minutes
    for (let i = 0; i < 5; i++) {
      await expect(
        authService.login({ email: "sari@example.com", password: "WrongPassword1" })
      ).rejects.toMatchObject({ statusCode: 401, code: "INVALID_CREDENTIALS" });
    }
    expect(store.users[0].failedLoginCount).toBe(5);
    expect(store.users[0].lockedUntil).toBeInstanceOf(Date);

    // Attempt 6 with CORRECT password still blocked with 429 ACCOUNT_LOCKED
    await expect(
      authService.login({ email: "sari@example.com", password: "ValidPass123" })
    ).rejects.toMatchObject({ statusCode: 429, code: "ACCOUNT_LOCKED" });

    // Once lockout expires, valid login succeeds and resets counters
    store.users[0].lockedUntil = new Date(Date.now() - 1000);
    const loginRes = await authService.login({
      email: "sari@example.com",
      password: "ValidPass123",
    });
    expect(loginRes.user.avatarUrl).toMatch(
      /^\/api\/v1\/files\/avatar\/.+\?exp=\d+&sig=[a-f0-9]+$/
    );
    expect(store.users[0].failedLoginCount).toBe(0);
    expect(store.users[0].lockedUntil).toBeNull();
  });

  it("rotates refresh tokens and revokes entire family on reuse", async () => {
    const passwordHash = await hashPassword("ValidPass123");
    store.users.push({
      id: 1,
      name: "Budi",
      email: "budi@example.com",
      passwordHash,
      phone: "+6281234567890",
      role: "CUSTOMER",
      isActive: true,
      isVerified: true,
      mustChangePassword: false,
      tokenVersion: 0,
      failedLoginCount: 0,
      lockedUntil: null,
      deletedAt: null,
      createdAt: new Date(),
    });

    const session1 = await authService.login({
      email: "budi@example.com",
      password: "ValidPass123",
    });
    const session2 = await sessionTokens.rotateRefreshToken({
      rawRefreshToken: session1.refreshToken,
    });
    expect(session2.refreshToken).not.toBe(session1.refreshToken);

    // Reusing old refresh token 1 revokes entire family (including session2's active token!)
    await expect(
      sessionTokens.rotateRefreshToken({ rawRefreshToken: session1.refreshToken })
    ).rejects.toMatchObject({ statusCode: 401, code: "TOKEN_REUSE_DETECTED" });

    expect(store.refreshTokens.every((t) => t.revokedAt !== null)).toBe(true);

    // Therefore session2's refresh token is now also revoked
    await expect(
      sessionTokens.rotateRefreshToken({ rawRefreshToken: session2.refreshToken })
    ).rejects.toMatchObject({ statusCode: 401, code: "TOKEN_REUSE_DETECTED" });
  });

  it("handles forgotPassword (non-OTP link, generic response), resetPassword, and changePassword tokenVersion bump", async () => {
    const oldHash = await hashPassword("OldPass123");
    store.users.push({
      id: 1,
      name: "Budi",
      email: "budi@example.com",
      passwordHash: oldHash,
      phone: "+6281234567890",
      role: "CUSTOMER",
      isActive: true,
      isVerified: true,
      mustChangePassword: true,
      tokenVersion: 1,
      failedLoginCount: 0,
      lockedUntil: null,
      deletedAt: null,
      createdAt: new Date(),
    });

    const unknownForgot = await authService.forgotPassword({ email: "ghost@example.com" });
    const knownForgot = await authService.forgotPassword({ email: "budi@example.com" });
    expect(unknownForgot).toEqual(knownForgot);
    expect(sentMails).toHaveLength(1);

    const tokenMatch = sentMails[0].text.match(/token=([a-f0-9]+)/);
    expect(tokenMatch).toBeTruthy();
    const resetToken = tokenMatch[1];
    expect(store.passwordResetTokens[0].tokenHash).toBe(sha256(resetToken));

    await authService.resetPassword({ token: resetToken, newPassword: "NewPass123" });
    expect(await verifyPassword("NewPass123", store.users[0].passwordHash)).toBe(true);
    expect(store.users[0].mustChangePassword).toBe(false);
    expect(store.users[0].tokenVersion).toBe(2);

    // Reuse same reset token fails
    await expect(
      authService.resetPassword({ token: resetToken, newPassword: "AnotherPass1" })
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_RESET_TOKEN" });

    // changePassword validates current password & bumps tokenVersion again
    await expect(
      authService.changePassword({
        actor: { id: 1 },
        currentPassword: "WrongCurrent1",
        newPassword: "FinalPass123",
      })
    ).rejects.toMatchObject({ statusCode: 401, code: "INVALID_CURRENT_PASSWORD" });

    await authService.changePassword({
      actor: { id: 1 },
      currentPassword: "NewPass123",
      newPassword: "FinalPass123",
    });
    expect(store.users[0].tokenVersion).toBe(3);
  });
});
