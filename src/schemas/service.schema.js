const { z } = require("zod");

const createServiceSchema = {
  body: z.object({
    categoryId: z.number().int("Category ID must be an integer"),
    name: z.string().min(1, "Name is required"),
    price: z.number().positive("Price must be a positive number"),
    estimatedTime: z.number().int().positive("Estimated time must be positive in minutes"),
    description: z.string().optional(),
  }),
};

const updateServiceSchema = {
  params: z.object({
    id: z.string().transform((val) => parseInt(val, 10)),
  }),
  body: z.object({
    categoryId: z.number().int().optional(),
    name: z.string().optional(),
    price: z.number().positive().optional(),
    estimatedTime: z.number().int().positive().optional(),
    description: z.string().optional(),
  }),
};

const getServiceSchema = {
  params: z.object({
    id: z.string().transform((val) => parseInt(val, 10)),
  }),
};

module.exports = {
  createServiceSchema,
  updateServiceSchema,
  getServiceSchema,
};
