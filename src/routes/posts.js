/**
 * Social Media Posts routes (LinkedIn & X)
 * @module routes/posts
 */

const express = require("express");
const multer = require("multer");
const authController = require("../controllers/authController");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Accept images and videos
    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("video/")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only image and video files are allowed"), false);
    }
  },
});

// LinkedIn post creation
router.post(
  "/linkedin/post",
  authenticateToken,
  authController.createLinkedInPost
);

// LinkedIn media upload
router.post(
  "/linkedin/upload",
  authenticateToken,
  upload.single("media"),
  authController.uploadLinkedInMedia
);

// X (Twitter) tweet creation
router.post("/x/tweet", authenticateToken, authController.createXTweet);

// X (Twitter) media upload
router.post(
  "/x/upload",
  authenticateToken,
  upload.single("media"),
  authController.uploadXMedia
);

module.exports = router;
