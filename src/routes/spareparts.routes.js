import { Router } from "express";
import authenticate from "../middlewares/authenticate.js";
import authorize from "../middlewares/authorize.js";
import validate from "../middlewares/validate.js";
import {
  adjustSparepartStockSchema,
  createSparepartSchema,
  listSparepartsSchema,
  sparepartIdParamSchema,
  updateSparepartSchema,
} from "../validations/spareparts.validation.js";
import * as sparepartsController from "../controllers/spareparts.controller.js";

export const sparepartsRouter = Router();
sparepartsRouter.use(authenticate, authorize("CUSTOMER", "MECHANIC", "ADMIN"));
sparepartsRouter.get("/", validate(listSparepartsSchema), sparepartsController.listSpareparts);

export const adminSparepartsRouter = Router();
adminSparepartsRouter.use(authenticate, authorize("ADMIN"));
adminSparepartsRouter.get(
  "/",
  validate(listSparepartsSchema),
  sparepartsController.listAdminSpareparts
);
adminSparepartsRouter.post(
  "/",
  validate(createSparepartSchema),
  sparepartsController.createSparepart
);
adminSparepartsRouter.patch(
  "/:id",
  validate(updateSparepartSchema),
  sparepartsController.updateSparepart
);
adminSparepartsRouter.post(
  "/:id/adjust-stock",
  validate(adjustSparepartStockSchema),
  sparepartsController.adjustSparepartStock
);
adminSparepartsRouter.delete(
  "/:id",
  validate(sparepartIdParamSchema),
  sparepartsController.deleteSparepart
);
adminSparepartsRouter.post(
  "/:id/restore",
  validate(sparepartIdParamSchema),
  sparepartsController.restoreSparepart
);
