const express = require("express");
const router = express.Router();
const validate = require("../middlewares/validate.middleware");
const { verifyToken } = require("../middlewares/auth.middleware");
const { createVehicleSchema, deleteVehicleSchema } = require("../schemas/vehicle.schema");
const vehicleController = require("../controllers/vehicle.controller");

router.use(verifyToken);

router.get("/my", vehicleController.getMyVehicles);
router.post("/", validate(createVehicleSchema), vehicleController.addVehicle);
// Need to add deleteVehicleSchema validation but keeping simple mapping
router.delete("/:id", vehicleController.deleteVehicle);

module.exports = router;
