// ==============================================================================
// TALLERO AUTO — ASSISTANT CONTROLLER
// Controller tipis untuk menu cepat dan query deterministik
// Sesuai aturan arsitektur AGENTS.md §2 (tanpa LLM, tanpa input teks bebas)
// ==============================================================================

import assistantService from "../services/assistant.service.js";
import { sendSuccess } from "../utils/response.js";

export const getMenu = async (req, res) => {
  const result = await assistantService.getMenu();

  return sendSuccess(res, {
    statusCode: 200,
    data: result,
  });
};

export const queryAssistant = async (req, res) => {
  const { intent } = req.valid.body;
  const result = await assistantService.queryAssistant({
    actor: req.user,
    intent,
    queryData: req.valid.body,
  });

  return sendSuccess(res, {
    statusCode: 200,
    data: result,
  });
};

export default {
  getMenu,
  queryAssistant,
};
