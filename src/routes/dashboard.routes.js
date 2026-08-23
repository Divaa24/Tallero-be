const express = require("express");
const router = express.Router();
const { verifyToken, authorizeRoles } = require("../middlewares/auth.middleware");
const dashboardController = require("../controllers/dashboard.controller");

router.use(verifyToken);
router.use(authorizeRoles("ADMIN"));

router.get("/", dashboardController.getDashboardStats);

module.exports = router;
