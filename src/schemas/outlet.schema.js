const { z } = require("zod");

const createOutletSchema = {
  body: z.object({
    name: z.string().min(1, "Name is required"),
    address: z.string().min(1, "Address is required"),
    phone: z.string().optional(),
    latitude: z.number(),
    longitude: z.number(),
    isActive: z.boolean().optional(),
  }),
};

const updateOutletSchema = {
  params: z.object({
    id: z.string().transform((val) => parseInt(val, 10)),
  }),
  body: z.object({
    name: z.string().optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    isActive: z.boolean().optional(),
  }),
};

const getOutletSchema = {
  params: z.object({
    id: z.string().transform((val) => parseInt(val, 10)),
  }),
};

module.exports = {
  createOutletSchema,
  updateOutletSchema,
  getOutletSchema,
};
