import { z } from "zod";
import { normalizePhoneNumber } from "./auth.validation.js";

const INDONESIA_PHONE_REGEX = /^\+628\d{7,12}$/;

const phoneField = z
  .string({ required_error: "Nomor telepon wajib diisi" })
  .transform(normalizePhoneNumber)
  .refine((val) => INDONESIA_PHONE_REGEX.test(val), {
    message: "Format nomor telepon harus nomor seluler Indonesia yang valid (mis. 08123456789)",
  });

const emailField = z
  .string({ required_error: "Email wajib diisi" })
  .trim()
  .toLowerCase()
  .email("Format email tidak valid")
  .max(150, "Email maksimal 150 karakter");

const nameField = z
  .string({ required_error: "Nama wajib diisi" })
  .trim()
  .min(2, "Nama minimal 2 karakter")
  .max(100, "Nama maksimal 100 karakter");

const idParamSchema = z
  .object({
    id: z.coerce.number().int().positive("ID user harus berupa bilangan bulat positif"),
  })
  .strict();

const booleanQueryField = z
  .enum(["true", "false"])
  .transform((val) => val === "true")
  .optional();

export const listUsersSchema = {
  query: z
    .object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
      sort: z.string().trim().optional(),
      role: z.enum(["ADMIN", "MECHANIC", "CUSTOMER"]).optional(),
      outletId: z.coerce.number().int().positive().optional(),
      isActive: booleanQueryField,
      includeDeleted: booleanQueryField,
      search: z.string().trim().min(1).max(100).optional(),
    })
    .strict(),
};

export const userIdParamSchema = {
  params: idParamSchema,
};

export const createStaffSchema = {
  body: z
    .object({
      name: nameField,
      email: emailField,
      phone: phoneField,
      address: z.string().trim().max(500, "Alamat maksimal 500 karakter").optional(),
      role: z.enum(["ADMIN", "MECHANIC"], {
        message: "Role staf yang dibuat admin hanya boleh ADMIN atau MECHANIC",
      }),
      outletId: z.coerce.number().int().positive().nullable().optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
      if (data.role === "MECHANIC" && !data.outletId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Staf dengan role MECHANIC wajib memiliki outletId",
          path: ["outletId"],
        });
      }
      if (data.role === "ADMIN" && data.outletId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Role ADMIN bersifat global dan tidak boleh terikat outletId",
          path: ["outletId"],
        });
      }
    }),
};

export const updateUserSchema = {
  params: idParamSchema,
  body: z
    .object({
      name: nameField.optional(),
      phone: phoneField.optional(),
      address: z.string().trim().max(500, "Alamat maksimal 500 karakter").nullable().optional(),
      role: z.enum(["ADMIN", "MECHANIC"]).optional(),
      outletId: z.coerce.number().int().positive().nullable().optional(),
    })
    .strict()
    .refine((data) => Object.keys(data).length > 0, {
      message: "Minimal satu field harus diubah",
    }),
};

export const updateUserStatusSchema = {
  params: idParamSchema,
  body: z
    .object({
      isActive: z.boolean({ required_error: "Status isActive wajib berupa boolean" }),
    })
    .strict(),
};
