import { z } from "zod";

const INDONESIA_PHONE_REGEX = /^\+628\d{7,12}$/;

/**
 * Menormalisasi nomor telepon Indonesia ke format +628...
 * Menerima input berawalan 08..., 628..., atau +628... dengan spasi/strip opsional.
 */
export const normalizePhoneNumber = (raw) => {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/[\s\-().]/g, "");

  if (cleaned.startsWith("+62")) {
    return cleaned;
  }
  if (cleaned.startsWith("62")) {
    return `+${cleaned}`;
  }
  if (cleaned.startsWith("0")) {
    return `+62${cleaned.slice(1)}`;
  }
  return cleaned;
};

const emailField = z
  .string({ required_error: "Email wajib diisi" })
  .trim()
  .toLowerCase()
  .email("Format email tidak valid")
  .max(255, "Email maksimal 255 karakter");

const phoneField = z
  .string({ required_error: "Nomor telepon wajib diisi" })
  .transform(normalizePhoneNumber)
  .refine((val) => INDONESIA_PHONE_REGEX.test(val), {
    message: "Format nomor telepon harus nomor seluler Indonesia yang valid (mis. 08123456789)",
  });

const strongPasswordField = z
  .string({ required_error: "Password wajib diisi" })
  .min(8, "Password minimal 8 karakter")
  .max(128, "Password maksimal 128 karakter")
  .refine((val) => /[a-zA-Z]/.test(val) && /\d/.test(val), {
    message: "Password harus mengandung minimal satu huruf dan satu angka",
  });

const nameField = z
  .string({ required_error: "Nama wajib diisi" })
  .trim()
  .min(2, "Nama minimal 2 karakter")
  .max(100, "Nama maksimal 100 karakter");

export const registerSchema = {
  body: z
    .object({
      name: nameField,
      email: emailField,
      password: strongPasswordField,
      phone: phoneField,
      address: z.string().trim().max(500, "Alamat maksimal 500 karakter").optional(),
    })
    .strict(),
};

export const verifyOtpSchema = {
  body: z
    .object({
      email: emailField,
      code: z
        .string({ required_error: "Kode OTP wajib diisi" })
        .trim()
        .regex(/^\d{6}$/, "Kode OTP harus terdiri dari 6 digit angka"),
    })
    .strict(),
};

export const resendOtpSchema = {
  body: z
    .object({
      email: emailField,
    })
    .strict(),
};

export const loginSchema = {
  body: z
    .object({
      email: emailField,
      password: z
        .string({ required_error: "Password wajib diisi" })
        .min(1, "Password wajib diisi")
        .max(128, "Password maksimal 128 karakter"),
    })
    .strict(),
};

export const refreshSchema = {
  body: z
    .object({
      refreshToken: z.string().trim().min(1).optional(),
    })
    .strict()
    .optional()
    .default({}),
};

export const logoutSchema = {
  body: z
    .object({
      refreshToken: z.string().trim().min(1).optional(),
    })
    .strict()
    .optional()
    .default({}),
};

export const forgotPasswordSchema = {
  body: z
    .object({
      email: emailField,
    })
    .strict(),
};

export const resetPasswordSchema = {
  body: z
    .object({
      token: z
        .string({ required_error: "Token reset password wajib diisi" })
        .trim()
        .min(16, "Token reset password tidak valid"),
      newPassword: strongPasswordField,
    })
    .strict(),
};

export const changePasswordSchema = {
  body: z
    .object({
      currentPassword: z
        .string({ required_error: "Password saat ini wajib diisi" })
        .min(1, "Password saat ini wajib diisi")
        .max(128, "Password maksimal 128 karakter"),
      newPassword: strongPasswordField,
    })
    .strict()
    .refine((data) => data.currentPassword !== data.newPassword, {
      message: "Password baru tidak boleh sama dengan password saat ini",
      path: ["newPassword"],
    }),
};

export const updateMeSchema = {
  body: z
    .object({
      name: nameField.optional(),
      phone: phoneField.optional(),
      address: z.string().trim().max(500, "Alamat maksimal 500 karakter").nullable().optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
      message: "Minimal satu field profil harus diubah",
    }),
};

export const signedFileSchema = {
  params: z
    .object({
      kind: z.enum(["avatar"]),
      id: z
        .string()
        .trim()
        .regex(/^[a-zA-Z0-9_-]+$/, "ID berkas tidak valid"),
    })
    .strict(),
  query: z
    .object({
      exp: z.coerce.number().int().positive("Parameter kedaluwarsa tidak valid"),
      sig: z
        .string()
        .trim()
        .regex(/^[a-fA-F0-9]+$/, "Tanda tangan berkas tidak valid"),
    })
    .strict(),
};
