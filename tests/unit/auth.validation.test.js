import { describe, expect, it } from "vitest";
import {
  changePasswordSchema,
  loginSchema,
  normalizePhoneNumber,
  registerSchema,
  signedFileSchema,
  updateMeSchema,
  verifyOtpSchema,
} from "../../src/validations/auth.validation.js";

describe("auth.validation schemas", () => {
  it("normalizes Indonesian phone numbers to +62 format", () => {
    expect(normalizePhoneNumber("0812-3456-7890")).toBe("+6281234567890");
    expect(normalizePhoneNumber("62 812 3456 7890")).toBe("+6281234567890");
    expect(normalizePhoneNumber("+6281234567890")).toBe("+6281234567890");
  });

  it("lowercases email and rejects unknown role escalation on register", () => {
    const valid = registerSchema.body.parse({
      name: "  Budi Santoso  ",
      email: "  BUDI@Example.COM ",
      password: "Password123",
      phone: "081234567890",
    });

    expect(valid.email).toBe("budi@example.com");
    expect(valid.name).toBe("Budi Santoso");
    expect(valid.phone).toBe("+6281234567890");

    const massAssign = registerSchema.body.safeParse({
      name: "Attacker",
      email: "attacker@example.com",
      password: "Password123",
      phone: "081234567890",
      role: "ADMIN",
    });
    expect(massAssign.success).toBe(false);
  });

  it("enforces strong password rules (min 8 chars with letter and digit)", () => {
    expect(
      registerSchema.body.safeParse({
        name: "Budi",
        email: "budi@example.com",
        password: "short1",
        phone: "081234567890",
      }).success
    ).toBe(false);

    expect(
      registerSchema.body.safeParse({
        name: "Budi",
        email: "budi@example.com",
        password: "onlyletters",
        phone: "081234567890",
      }).success
    ).toBe(false);

    expect(
      registerSchema.body.safeParse({
        name: "Budi",
        email: "budi@example.com",
        password: "12345678",
        phone: "081234567890",
      }).success
    ).toBe(false);
  });

  it("validates OTP 6-digit format, login, changePassword, updateMe, and signedFile", () => {
    expect(verifyOtpSchema.body.safeParse({ email: "a@b.com", code: "012345" }).success).toBe(true);
    expect(verifyOtpSchema.body.safeParse({ email: "a@b.com", code: "12345" }).success).toBe(false);
    expect(loginSchema.body.safeParse({ email: "USER@B.COM", password: "x" }).success).toBe(true);

    expect(
      changePasswordSchema.body.safeParse({
        currentPassword: "Password123",
        newPassword: "Password123",
      }).success
    ).toBe(false);

    expect(updateMeSchema.body.safeParse({}).success).toBe(false);
    expect(updateMeSchema.body.safeParse({ name: "Baru", role: "ADMIN" }).success).toBe(false);
    expect(updateMeSchema.body.safeParse({ name: "Baru" }).success).toBe(true);

    expect(signedFileSchema.params.safeParse({ kind: "avatar", id: "../etc/passwd" }).success).toBe(
      false
    );
  });
});
