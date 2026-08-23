const express = require("express");
const router = express.Router();
const validate = require("../middlewares/validate.middleware");
const { verifyToken, authorizeRoles } = require("../middlewares/auth.middleware");
const { createServiceSchema, updateServiceSchema, getServiceSchema } = require("../schemas/service.schema");
const serviceController = require("../controllers/service.controller");

router.get("/", serviceController.getAllServices);

router.use(verifyToken);
router.use(authorizeRoles("ADMIN"));

router.post("/", validate(createServiceSchema), serviceController.createService);
router.put("/:id", validate(updateServiceSchema), serviceController.updateService);
router.delete("/:id", validate(getServiceSchema), serviceController.deleteService);

module.exports = router;
