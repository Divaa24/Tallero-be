import { Router } from "express";
import authenticate from "../middlewares/authenticate.js";
import authorize from "../middlewares/authorize.js";
import validate from "../middlewares/validate.js";
import {
  catalogIdParamSchema,
  createCategorySchema,
  createServiceSchema,
  listAdminServicesSchema,
  listCategoriesSchema,
  listPublicServicesSchema,
  updateCategorySchema,
  updateServiceSchema,
} from "../validations/catalog.validation.js";
import * as catalogController from "../controllers/catalog.controller.js";

export const publicCategoriesRouter = Router();
publicCategoriesRouter.get(
  "/",
  validate(listCategoriesSchema),
  catalogController.listPublicCategories
);

export const publicServicesRouter = Router();
publicServicesRouter.get(
  "/",
  validate(listPublicServicesSchema),
  catalogController.listPublicServices
);
publicServicesRouter.get(
  "/:id",
  validate(catalogIdParamSchema),
  catalogController.getPublicService
);

export const adminCategoriesRouter = Router();
adminCategoriesRouter.use(authenticate, authorize("ADMIN"));
adminCategoriesRouter.get(
  "/",
  validate(listCategoriesSchema),
  catalogController.listAdminCategories
);
adminCategoriesRouter.post("/", validate(createCategorySchema), catalogController.createCategory);
adminCategoriesRouter.patch(
  "/:id",
  validate(updateCategorySchema),
  catalogController.updateCategory
);
adminCategoriesRouter.delete(
  "/:id",
  validate(catalogIdParamSchema),
  catalogController.deleteCategory
);
adminCategoriesRouter.post(
  "/:id/restore",
  validate(catalogIdParamSchema),
  catalogController.restoreCategory
);

export const adminServicesRouter = Router();
adminServicesRouter.use(authenticate, authorize("ADMIN"));
adminServicesRouter.get(
  "/",
  validate(listAdminServicesSchema),
  catalogController.listAdminServices
);
adminServicesRouter.post("/", validate(createServiceSchema), catalogController.createService);
adminServicesRouter.patch("/:id", validate(updateServiceSchema), catalogController.updateService);
adminServicesRouter.delete("/:id", validate(catalogIdParamSchema), catalogController.deleteService);
adminServicesRouter.post(
  "/:id/restore",
  validate(catalogIdParamSchema),
  catalogController.restoreService
);
