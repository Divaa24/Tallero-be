import { Router } from "express";
import authenticate from "../middlewares/authenticate.js";
import authorize from "../middlewares/authorize.js";
import validate from "../middlewares/validate.js";
import {
  createStaffSchema,
  listUsersSchema,
  updateUserSchema,
  updateUserStatusSchema,
  userIdParamSchema,
} from "../validations/users.validation.js";
import * as usersController from "../controllers/users.controller.js";

const adminUsersRouter = Router();

adminUsersRouter.use(authenticate, authorize("ADMIN"));

adminUsersRouter.get("/", validate(listUsersSchema), usersController.listUsers);
adminUsersRouter.post("/", validate(createStaffSchema), usersController.createStaff);
adminUsersRouter.get("/:id", validate(userIdParamSchema), usersController.getUser);
adminUsersRouter.patch("/:id", validate(updateUserSchema), usersController.updateUser);
adminUsersRouter.patch(
  "/:id/status",
  validate(updateUserStatusSchema),
  usersController.updateUserStatus
);
adminUsersRouter.delete("/:id", validate(userIdParamSchema), usersController.deleteUser);
adminUsersRouter.post("/:id/restore", validate(userIdParamSchema), usersController.restoreUser);

export default adminUsersRouter;
