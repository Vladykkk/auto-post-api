/**
 * X (Twitter) API routes
 * @module routes/xApi
 */

const express = require("express");
const XController = require("../controllers/xController");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// X API routes (mounted on /api/x)
router.get("/user", authenticateToken, XController.getCurrentUser);
router.get("/user/refresh", authenticateToken, XController.refreshProfile);

module.exports = router;
