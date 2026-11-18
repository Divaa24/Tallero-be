import { Router } from "express";
import authenticate from "../middlewares/authenticate.js";
import authorize from "../middlewares/authorize.js";
import validate from "../middlewares/validate.js";
import {
  createOutletClosureSchema,
  createOutletSchema,
  deleteOutletClosureSchema,
  listAdminOutletsSchema,
  listPublicOutletsSchema,
  outletIdParamSchema,
  updateOutletSchema,
} from "../validations/outlets.validation.js";
import * as outletsController from "../controllers/outlets.controller.js";
import reviewsController from "../controllers/reviews.controller.js";
import { listReviewsQuerySchema } from "../validations/reviews.validation.js";

export const publicOutletsRouter = Router();
publicOutletsRouter.get(
  "/",
  validate(listPublicOutletsSchema),
  outletsController.listPublicOutlets
);
publicOutletsRouter.get("/:id", validate(outletIdParamSchema), outletsController.getPublicOutlet);
publicOutletsRouter.get(
  "/:id/reviews",
  validate(outletIdParamSchema),
  validate(listReviewsQuerySchema, "query"),
  reviewsController.listOutletReviews
);

export const adminOutletsRouter = Router();
adminOutletsRouter.use(authenticate, authorize("ADMIN"));

adminOutletsRouter.get("/", validate(listAdminOutletsSchema), outletsController.listAdminOutlets);
adminOutletsRouter.post("/", validate(createOutletSchema), outletsController.createOutlet);
adminOutletsRouter.patch("/:id", validate(updateOutletSchema), outletsController.updateOutlet);
adminOutletsRouter.delete("/:id", validate(outletIdParamSchema), outletsController.deleteOutlet);
adminOutletsRouter.post(
  "/:id/restore",
  validate(outletIdParamSchema),
  outletsController.restoreOutlet
);
adminOutletsRouter.post(
  "/:id/closures",
  validate(createOutletClosureSchema),
  outletsController.addOutletClosure
);
adminOutletsRouter.delete(
  "/:id/closures/:closureId",
  validate(deleteOutletClosureSchema),
  outletsController.removeOutletClosure
);
