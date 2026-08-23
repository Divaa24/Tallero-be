const { z } = require("zod");

const chatSchema = {
  body: z.object({
    message: z.string().min(1, "Message cannot be empty"),
  }),
};

module.exports = {
  chatSchema,
};
