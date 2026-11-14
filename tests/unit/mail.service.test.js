import { beforeEach, describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";
import env from "../../src/config/env.js";
import logger from "../../src/config/logger.js";
import {
  buildPasswordResetEmail,
  buildRegistrationOtpEmail,
  resetMailTransporterCache,
  sendMail,
} from "../../src/services/mail.service.js";
import { BadGatewayError } from "../../src/utils/errors.js";

describe("mail.service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetMailTransporterCache();
  });

  it("builds HTML-escaped registration OTP and reset password email templates", () => {
    const otpMail = buildRegistrationOtpEmail({
      name: '<script>alert("x")</script>',
      code: "042199",
      expiresMinutes: 10,
    });
    expect(otpMail.subject).toContain("Tallero Auto");
    expect(otpMail.html).toContain("&lt;script&gt;");
    expect(otpMail.html).not.toContain("<script>");
    expect(otpMail.text).toContain("042199");

    const resetMail = buildPasswordResetEmail({
      name: "Sari",
      resetUrl: "http://localhost:5173/reset-password?token=abc",
      expiresMinutes: 30,
    });
    expect(resetMail.text).toContain("token=abc");
    expect(resetMail.html).toContain("30 menit");
  });

  it("sends email via console driver in non-production without calling nodemailer", async () => {
    const originalDriver = env.EMAIL_DRIVER;
    const originalEnv = env.NODE_ENV;
    env.EMAIL_DRIVER = "console";
    env.NODE_ENV = "test";
    const logSpy = vi.spyOn(logger, "info").mockImplementation(() => {});

    try {
      const result = await sendMail({
        to: "customer@example.com",
        subject: "Test",
        text: "Isi pesan",
        html: "<p>Isi pesan</p>",
      });
      expect(result).toEqual({ accepted: ["customer@example.com"], driver: "console" });
      expect(logSpy).toHaveBeenCalledOnce();
    } finally {
      env.EMAIL_DRIVER = originalDriver;
      env.NODE_ENV = originalEnv;
    }
  });

  it("refuses console driver if NODE_ENV is production", async () => {
    const originalDriver = env.EMAIL_DRIVER;
    const originalEnv = env.NODE_ENV;
    env.EMAIL_DRIVER = "console";
    env.NODE_ENV = "production";

    try {
      await expect(sendMail({ to: "a@b.com", subject: "x", text: "x", html: "x" })).rejects.toThrow(
        /production/i
      );
    } finally {
      env.EMAIL_DRIVER = originalDriver;
      env.NODE_ENV = originalEnv;
    }
  });

  it("sends via gmail OAuth2 transporter and maps failures to 502 EMAIL_DELIVERY_FAILED", async () => {
    const originalDriver = env.EMAIL_DRIVER;
    env.EMAIL_DRIVER = "gmail";

    const sendMailMock = vi
      .fn()
      .mockResolvedValueOnce({ messageId: "msg-123" })
      .mockRejectedValueOnce(new Error("OAuth invalid_grant"));

    const createTransportSpy = vi
      .spyOn(nodemailer, "createTransport")
      .mockReturnValue({ sendMail: sendMailMock });
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(logger, "info").mockImplementation(() => {});

    try {
      const info = await sendMail({
        to: "customer@example.com",
        subject: "OTP",
        text: "123456",
        html: "<b>123456</b>",
      });
      expect(info.messageId).toBe("msg-123");
      expect(createTransportSpy).toHaveBeenCalledOnce();

      await expect(
        sendMail({
          to: "customer@example.com",
          subject: "OTP",
          text: "123456",
          html: "<b>123456</b>",
        })
      ).rejects.toMatchObject({
        statusCode: 502,
        code: "EMAIL_DELIVERY_FAILED",
      });

      try {
        await sendMail({ to: "a@b.com", subject: "s", text: "t", html: "h" });
      } catch (err) {
        expect(err).toBeInstanceOf(BadGatewayError);
      }
    } finally {
      env.EMAIL_DRIVER = originalDriver;
    }
  });
});
