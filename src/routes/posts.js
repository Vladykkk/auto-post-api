/**
 * Posts routes for social media platforms
 * @module routes/posts
 */

const express = require("express");
const multer = require("multer");
const LinkedinController = require("../controllers/linkedinController");
const XController = require("../controllers/xController");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 512 * 1024 * 1024, // 512MB max file size
  },
});

// LinkedIn post routes
router.post("/linkedin/post", authenticateToken, LinkedinController.createPost);
router.post(
  "/linkedin/upload",
  authenticateToken,
  upload.single("media"),
  LinkedinController.uploadMedia
);

// X (Twitter) post routes
router.post("/x/tweet", authenticateToken, XController.createTweet);
router.post(
  "/x/upload",
  authenticateToken,
  upload.single("media"),
  XController.uploadMedia
);

module.exports = router;
