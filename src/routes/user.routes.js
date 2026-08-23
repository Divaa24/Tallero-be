const express = require("express");
const router = express.Router();
const validate = require("../middlewares/validate.middleware");
const { verifyToken, authorizeRoles } = require("../middlewares/auth.middleware");
const { createUserSchema, updateUserSchema, getUserSchema } = require("../schemas/user.schema");
const userController = require("../controllers/user.controller");

router.use(verifyToken);
router.use(authorizeRoles("ADMIN"));

router.get("/", userController.getAllUsers);
router.post("/", validate(createUserSchema), userController.createUser);
router.get("/:id", validate(getUserSchema), userController.getUserById);
router.put("/:id", validate(updateUserSchema), userController.updateUser);
router.delete("/:id", validate(getUserSchema), userController.deleteUser);

module.exports = router;
