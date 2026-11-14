import { describe, it, expect } from "vitest";
import bcrypt from "bcrypt";
import {
  dummyCompare,
  generateNumericOtp,
  generateRandomToken,
  hashPassword,
  hmacSha256,
  safeCompare,
  sha256,
  verifyPassword,
} from "../../src/utils/crypto.js";

describe("Unit: utils/crypto.js", () => {
  it("hashPassword menghasilkan hash bcrypt cost 12 yang valid dan terverifikasi", async () => {
    const plain = "RahasiaTallero2026!";
    const hashed = await hashPassword(plain);

    expect(hashed).toMatch(/^\$2[aby]\$12\$/);
    expect(bcrypt.getRounds(hashed)).toBe(12);
    expect(await verifyPassword(plain, hashed)).toBe(true);
    expect(await verifyPassword("PasswordSalah123", hashed)).toBe(false);
  });

  it("dummyCompare selalu mengembalikan false dan menjalankan bcrypt compare", async () => {
    expect(await dummyCompare("apapun")).toBe(false);
    expect(await dummyCompare("")).toBe(false);
  });

  it("generateRandomToken, generateNumericOtp, sha256, hmacSha256, dan safeCompare bekerja aman", () => {
    const token32 = generateRandomToken(32);
    const token48 = generateRandomToken(48);
    expect(token32).toHaveLength(64);
    expect(token48).toHaveLength(96);
    expect(token48).not.toBe(generateRandomToken(48));

    const otp = generateNumericOtp();
    expect(otp).toMatch(/^\d{6}$/);

    expect(sha256("tallero")).toHaveLength(64);
    expect(hmacSha256("123456", "secret-key")).toBe(hmacSha256("123456", "secret-key"));
    expect(hmacSha256("123456", "secret-a")).not.toBe(hmacSha256("123456", "secret-b"));

    expect(safeCompare("abc123", "abc123")).toBe(true);
    expect(safeCompare("abc123", "abc124")).toBe(false);
    expect(safeCompare("short", "longer-string")).toBe(false);
    expect(safeCompare("abc", null)).toBe(false);
  });
});
