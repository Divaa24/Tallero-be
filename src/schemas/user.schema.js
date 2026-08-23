const { z } = require("zod");

const createUserSchema = {
  body: z.object({
    name: z.string().min(1, "Name is required").max(100),
    email: z.string().email("Invalid email format").max(100),
    password: z.string().min(6, "Password must be at least 6 characters"),
    phone: z.string().min(1, "Phone number is required"),
    address: z.string().optional(),
    role: z.enum(["ADMIN", "MECHANIC", "CUSTOMER"]).optional(),
    isActive: z.boolean().optional(),
  }),
};

const updateUserSchema = {
  params: z.object({
    id: z.string().transform((val) => parseInt(val, 10)),
  }),
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    role: z.enum(["ADMIN", "MECHANIC", "CUSTOMER"]).optional(),
    isActive: z.boolean().optional(),
  }),
};

const getUserSchema = {
  params: z.object({
    id: z.string().transform((val) => parseInt(val, 10)),
  }),
};

module.exports = {
  createUserSchema,
  updateUserSchema,
  getUserSchema,
};
