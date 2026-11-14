import { Router } from "express";
import authenticate from "../middlewares/authenticate.js";
import authorize from "../middlewares/authorize.js";
import validate from "../middlewares/validate.js";
import { listAuditLogsSchema } from "../validations/audit.validation.js";
import * as auditController from "../controllers/audit.controller.js";

const auditRouter = Router();

auditRouter.use(authenticate, authorize("ADMIN"));
auditRouter.get("/", validate(listAuditLogsSchema), auditController.listAuditLogs);

export default auditRouter;
