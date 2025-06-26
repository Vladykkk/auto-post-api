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

// X (Twitter) OAuth routes
router.get("/x", XController.initiateAuth);
router.get("/x/callback", XController.handleCallback);

module.exports = router;
