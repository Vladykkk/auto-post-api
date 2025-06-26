/**
 * LinkedIn API routes
 * @module routes/linkedinApi
 */

const express = require("express");
const LinkedinController = require("../controllers/linkedinController");
const BaseController = require("../controllers/baseController");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// LinkedIn API routes (mounted on /api/linkedin)
router.get("/user", authenticateToken, LinkedinController.getCurrentUser);
router.get(
  "/user/refresh",
  authenticateToken,
  LinkedinController.refreshProfile
);
router.get("/profile", authenticateToken, LinkedinController.refreshProfile); // Alias

module.exports = router;
