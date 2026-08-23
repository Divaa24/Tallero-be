const { z } = require("zod");

const chatPromptSchema = {
  body: z.object({
    message: z.string().min(1, "Pesan tidak boleh kosong"),
  }),
};

module.exports = {
  chatPromptSchema,
};
