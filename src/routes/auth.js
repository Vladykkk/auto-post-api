/**
 * Authentication routes
 * @module routes/auth
 */

const express = require("express");
const authController = require("../controllers/authController");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// LinkedIn OAuth routes
router.get("/linkedin", authController.initiateLinkedInAuth);
router.get("/linkedin/callback", authController.handleLinkedInCallback);

// X (Twitter) OAuth routes
router.get("/x", authController.initiateXAuth);
router.get("/x/callback", authController.handleXCallback);

// Protected routes - LinkedIn
router.get("/user", authenticateToken, authController.getCurrentUser);
router.get(
  "/user/refresh",
  authenticateToken,
  authController.refreshUserProfile
);
router.get("/profile", authenticateToken, authController.getDetailedProfile);

// Protected routes - X (Twitter)
router.get("/x/user", authenticateToken, authController.getCurrentXUser);
router.get(
  "/x/user/refresh",
  authenticateToken,
  authController.refreshXUserProfile
);

// Common protected routes
router.post("/linkedin/logout", authenticateToken, authController.logout);
router.post("/x/logout", authenticateToken, authController.logout);

module.exports = router;
