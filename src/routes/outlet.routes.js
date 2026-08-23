const express = require("express");
const router = express.Router();
const validate = require("../middlewares/validate.middleware");
const { verifyToken, authorizeRoles } = require("../middlewares/auth.middleware");
const { createOutletSchema, updateOutletSchema, getOutletSchema } = require("../schemas/outlet.schema");
const outletController = require("../controllers/outlet.controller");

router.get("/", outletController.getAllOutlets);

router.post("/", verifyToken, authorizeRoles("ADMIN"), validate(createOutletSchema), outletController.createOutlet);
router.put("/:id", verifyToken, authorizeRoles("ADMIN"), validate(updateOutletSchema), outletController.updateOutlet);
router.delete("/:id", verifyToken, authorizeRoles("ADMIN"), validate(getOutletSchema), outletController.deleteOutlet);

module.exports = router;
