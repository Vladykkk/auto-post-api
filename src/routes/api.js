/**
 * Auth API routes
 * @module routes/api
 */

const express = require("express");
const BaseController = require("../controllers/baseController");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Logout routes (mounted on /api/auth)
router.post("/linkedin/logout", authenticateToken, BaseController.logout);
router.post("/x/logout", authenticateToken, BaseController.logout);

module.exports = router;
