const { z } = require("zod");

const createVehicleSchema = {
  body: z.object({
    licensePlate: z.string().min(1, "License plate is required"),
    brand: z.string().min(1, "Brand is required"),
    model: z.string().min(1, "Model is required"),
    type: z.string().optional(),
    year: z.number().int().min(1886, "Invalid year"),
  }),
};

module.exports = {
  createVehicleSchema,
};
