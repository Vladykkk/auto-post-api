/**
 * Authentication routes
 * @module routes/auth
 */

const express = require("express");
const multer = require("multer");
const LinkedinController = require("../controllers/linkedinController");
const XController = require("../controllers/xController");
const BaseController = require("../controllers/baseController");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 512 * 1024 * 1024, // 512MB max file size
  },
});

// LinkedIn OAuth routes
router.get("/linkedin", LinkedinController.initiateAuth);
router.get("/linkedin/callback", LinkedinController.handleCallback);

// LinkedIn API routes
router.get(
  "/linkedin/user",
  authenticateToken,
  LinkedinController.getCurrentUser
);
router.get(
  "/linkedin/user/refresh",
  authenticateToken,
  LinkedinController.refreshProfile
);
router.get(
  "/linkedin/profile",
  authenticateToken,
  LinkedinController.refreshProfile
); // Alias

// X (Twitter) OAuth routes
router.get("/x", XController.initiateAuth);
router.get("/x/callback", XController.handleCallback);

// X API routes
router.get("/x/user", authenticateToken, XController.getCurrentUser);
router.get("/x/user/refresh", authenticateToken, XController.refreshProfile);

// Common logout route
router.post("/linkedin/logout", authenticateToken, BaseController.logout);
router.post("/x/logout", authenticateToken, BaseController.logout);

module.exports = router;
