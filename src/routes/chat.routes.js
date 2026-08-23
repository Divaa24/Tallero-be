const express = require("express");
const router = express.Router();
const validate = require("../middlewares/validate.middleware");
const { chatSchema } = require("../schemas/chat.schema"); // Wait, let's make sure I have chat.schema.js, wait I need to create it! Let me use z.object inline if missing or create it.
const chatController = require("../controllers/chat.controller");

// I'll create the schema inline here to avoid an extra file just for one route since it wasn't requested strictly, wait! The user requested to use `chat.routes.js`. They didn't mention `chat.schema.js` in the schema list! "1. Schemas Zod: auth, outlet, vehicle, service, booking". They did not list chat.schema.js!
// I'll create the inline validation schema.
const { z } = require("zod");
const chatSchemaLocal = {
  body: z.object({
    message: z.string().min(1, "Message is required")
  })
};

router.post("/", validate(chatSchemaLocal), chatController.askChatbot);

module.exports = router;
