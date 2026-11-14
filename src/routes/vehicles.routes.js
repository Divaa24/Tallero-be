import { Router } from "express";
import authenticate from "../middlewares/authenticate.js";
import authorize from "../middlewares/authorize.js";
import validate from "../middlewares/validate.js";
import {
  createVehicleSchema,
  listVehiclesSchema,
  updateVehicleSchema,
  vehicleIdParamSchema,
  vehicleSubListSchema,
} from "../validations/vehicles.validation.js";
import * as vehiclesController from "../controllers/vehicles.controller.js";

const vehiclesRouter = Router();

vehiclesRouter.use(authenticate);

vehiclesRouter.get(
  "/",
  authorize("CUSTOMER"),
  validate(listVehiclesSchema),
  vehiclesController.listVehicles
);
vehiclesRouter.post(
  "/",
  authorize("CUSTOMER"),
  validate(createVehicleSchema),
  vehiclesController.createVehicle
);
vehiclesRouter.get(
  "/:id",
  authorize("CUSTOMER"),
  validate(vehicleIdParamSchema),
  vehiclesController.getVehicle
);
vehiclesRouter.patch(
  "/:id",
  authorize("CUSTOMER"),
  validate(updateVehicleSchema),
  vehiclesController.updateVehicle
);
vehiclesRouter.delete(
  "/:id",
  authorize("CUSTOMER"),
  validate(vehicleIdParamSchema),
  vehiclesController.deleteVehicle
);
vehiclesRouter.get(
  "/:id/history",
  authorize("CUSTOMER", "MECHANIC", "ADMIN"),
  validate(vehicleSubListSchema),
  vehiclesController.getVehicleHistory
);
vehiclesRouter.get(
  "/:id/reminders",
  authorize("CUSTOMER"),
  validate(vehicleSubListSchema),
  vehiclesController.getVehicleReminders
);

export default vehiclesRouter;
