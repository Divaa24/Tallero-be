import nodemailer from "nodemailer";
import env from "../config/env.js";
import logger from "../config/logger.js";
import { BadGatewayError } from "../utils/errors.js";

let cachedGmailTransporter = null;

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const getGmailTransporter = () => {
  if (cachedGmailTransporter) {
    return cachedGmailTransporter;
  }

  cachedGmailTransporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      type: "OAuth2",
      user: env.GMAIL_USER,
      clientId: env.GMAIL_CLIENT_ID,
      clientSecret: env.GMAIL_CLIENT_SECRET,
      refreshToken: env.GMAIL_REFRESH_TOKEN,
    },
  });

  return cachedGmailTransporter;
};

/**
 * Mengirim email melalui driver yang dikonfigurasi (console untuk dev/test, gmail OAuth2 untuk produksi).
 * Kegagalan pengiriman melemparkan BadGatewayError (502 EMAIL_DELIVERY_FAILED).
 */
export const sendMail = async ({ to, subject, html, text }) => {
  if (env.EMAIL_DRIVER === "console") {
    if (env.NODE_ENV === "production") {
      throw new Error("Driver email console dilarang di environment production");
    }

    logger.info(
      {
        mail: {
          driver: "console",
          to,
          subject,
          text,
        },
      },
      "Email terkirim via driver console (non-production)"
    );

    return { accepted: [to], driver: "console" };
  }

  try {
    const transporter = getGmailTransporter();
    const info = await transporter.sendMail({
      from: `Tallero Auto <${env.GMAIL_USER}>`,
      to,
      subject,
      html,
      text,
    });

    logger.info(
      {
        mail: {
          driver: "gmail",
          to,
          subject,
          messageId: info.messageId,
        },
      },
      "Email terkirim via Gmail OAuth2"
    );

    return info;
  } catch (error) {
    logger.error({ err: error, to, subject }, "Gagal mengirim email melalui Gmail OAuth2");
    throw new BadGatewayError(
      "Gagal mengirim email verifikasi/notifikasi. Silakan coba beberapa saat lagi.",
      "EMAIL_DELIVERY_FAILED"
    );
  }
};

/**
 * Template email kode OTP verifikasi pendaftaran akun.
 */
export const buildRegistrationOtpEmail = ({ name, code, expiresMinutes }) => {
  const safeName = escapeHtml(name || "Pelanggan");
  const safeCode = escapeHtml(code);

  const subject = "Kode Verifikasi Pendaftaran Tallero Auto";
  const text = [
    `Halo ${name || "Pelanggan"},`,
    "",
    `Kode OTP verifikasi akun Tallero Auto Anda adalah: ${code}`,
    `Kode ini berlaku selama ${expiresMinutes} menit dan tidak boleh dibagikan kepada siapa pun.`,
    "",
    "Jika Anda tidak merasa mendaftar, abaikan email ini.",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
      <h2>Verifikasi Akun Tallero Auto</h2>
      <p>Halo <strong>${safeName}</strong>,</p>
      <p>Gunakan kode OTP berikut untuk mengaktifkan akun Anda:</p>
      <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px; margin: 16px 0;">${safeCode}</p>
      <p>Kode ini berlaku selama <strong>${expiresMinutes} menit</strong> dan hanya dapat digunakan satu kali.</p>
      <p style="color: #6b7280; font-size: 12px;">Jika Anda tidak merasa mendaftar di Tallero Auto, abaikan email ini.</p>
    </div>
  `.trim();

  return { subject, text, html };
};

/**
 * Template email tautan reset password (tanpa OTP).
 */
export const buildPasswordResetEmail = ({ name, resetUrl, expiresMinutes }) => {
  const safeName = escapeHtml(name || "Pelanggan");
  const safeUrl = escapeHtml(resetUrl);

  const subject = "Reset Password Akun Tallero Auto";
  const text = [
    `Halo ${name || "Pelanggan"},`,
    "",
    "Kami menerima permintaan untuk mereset password akun Tallero Auto Anda.",
    `Silakan buka tautan berikut dalam ${expiresMinutes} menit: ${resetUrl}`,
    "",
    "Jika Anda tidak meminta reset password, abaikan email ini.",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
      <h2>Reset Password Tallero Auto</h2>
      <p>Halo <strong>${safeName}</strong>,</p>
      <p>Klik tombol di bawah ini untuk membuat password baru:</p>
      <p style="margin: 20px 0;">
        <a href="${safeUrl}" style="background-color: #111827; color: #ffffff; padding: 12px 20px; text-decoration: none; border-radius: 6px;">
          Reset Password
        </a>
      </p>
      <p>Tautan ini berlaku selama <strong>${expiresMinutes} menit</strong> dan hanya dapat digunakan satu kali.</p>
      <p style="color: #6b7280; font-size: 12px;">Atau salin tautan ini: ${safeUrl}</p>
    </div>
  `.trim();

  return { subject, text, html };
};

/**
 * Template email undangan akun staf baru dengan password sementara (wajib diganti saat login pertama).
 */
export const buildStaffInviteEmail = ({ name, email, role, temporaryPassword }) => {
  const safeName = escapeHtml(name || "Staf");
  const safeEmail = escapeHtml(email);
  const safeRole = escapeHtml(role);
  const safePass = escapeHtml(temporaryPassword);

  const subject = "Akun Staf Tallero Auto Telah Dibuat";
  const text = [
    `Halo ${name || "Staf"},`,
    "",
    `Akun staf Tallero Auto Anda (${role}) telah dibuat oleh Admin.`,
    `Email: ${email}`,
    `Password sementara: ${temporaryPassword}`,
    "",
    "Anda wajib mengganti password sementara ini segera setelah login pertama.",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
      <h2>Selamat Datang di Tallero Auto</h2>
      <p>Halo <strong>${safeName}</strong>,</p>
      <p>Akun staf Anda dengan role <strong>${safeRole}</strong> telah diaktifkan.</p>
      <p>Email login: <strong>${safeEmail}</strong></p>
      <p>Password sementara: <code style="font-size: 16px; background: #f3f4f6; padding: 4px 8px;">${safePass}</code></p>
      <p>Demi keamanan, Anda wajib mengganti password ini pada login pertama.</p>
    </div>
  `.trim();

  return { subject, text, html };
};

/**
 * Template email pemberitahuan kendaraan siap diambil
 */
export const buildReadyForPickupEmail = ({ name, bookingCode, outletName, total }) => {
  const safeName = escapeHtml(name || "Pelanggan");
  const safeCode = escapeHtml(bookingCode);
  const safeOutlet = escapeHtml(outletName);
  const formattedTotal = Number(total || 0).toLocaleString("id-ID");

  const subject = `Kendaraan Anda Siap Diambil — Booking ${bookingCode}`;
  const text = [
    `Halo ${name || "Pelanggan"},`,
    "",
    `Pengerjaan servis pada kendaraan Anda (Kode: ${bookingCode}) telah selesai dikerjakan dan siap diambil di outlet ${outletName}.`,
    `Total tagihan: Rp ${formattedTotal}`,
    "",
    "Terima kasih telah mempercayakan kendaraan Anda di Tallero Auto.",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937;">
      <h2>Kendaraan Anda Siap Diambil</h2>
      <p>Halo <strong>${safeName}</strong>,</p>
      <p>Pengerjaan servis untuk reservasi <strong>${safeCode}</strong> telah selesai dengan baik.</p>
      <p>Lokasi pengambilan: <strong>${safeOutlet}</strong></p>
      <p>Total tagihan: <strong>Rp ${formattedTotal}</strong></p>
      <p>Silakan datang ke kasir outlet kami untuk menyelesaikan pembayaran dan serah terima kendaraan.</p>
    </div>
  `.trim();

  return { subject, text, html };
};

export const resetMailTransporterCache = () => {
  cachedGmailTransporter = null;
};

export default {
  sendMail,
  buildRegistrationOtpEmail,
  buildPasswordResetEmail,
  buildStaffInviteEmail,
  buildReadyForPickupEmail,
  resetMailTransporterCache,
};
