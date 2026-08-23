const express = require("express");
const router = express.Router();
const validate = require("../middlewares/validate");
const { chatPromptSchema } = require("../schemas/chatSchema");
const chatController = require("../controllers/chatController");

router.post("/", validate(chatPromptSchema), chatController.handleChat);

module.exports = router;
