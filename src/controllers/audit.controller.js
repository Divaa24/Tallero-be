import { sendSuccess } from "../utils/response.js";
import * as auditService from "../services/audit.service.js";

export const listAuditLogs = async (req, res) => {
  const { items, meta } = await auditService.listAuditLogs({ query: req.valid.query });
  return sendSuccess(res, { data: items, meta });
};

export default {
  listAuditLogs,
};
