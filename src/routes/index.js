/**
 * Main routes configuration
 * @module routes/index
 */

const express = require("express");
const authRoutes = require("./auth");
const apiRoutes = require("./api");
const linkedinApiRoutes = require("./linkedinApi");
const xApiRoutes = require("./xApi");
const postsRoutes = require("./posts");
const { createSuccessResponse } = require("../utils/response");

const router = express.Router();

// Health check endpoint
router.get("/", (req, res) => {
  res.json(
    createSuccessResponse(
      {
        name: "Social Media OAuth API",
        version: "1.0.0",
        status: "healthy",
        timestamp: new Date().toISOString(),
      },
      "Social Media OAuth 2.0 Server (LinkedIn & X) is running!",
      {
        endpoints: {
          auth: {
            linkedin: {
              login: "/auth/linkedin",
              callback: "/auth/linkedin/callback",
              logout: "/api/auth/linkedin/logout",
            },
            x: {
              login: "/auth/x",
              callback: "/auth/x/callback",
              logout: "/api/auth/x/logout",
            },
          },
          api: {
            linkedin: {
              user: "/api/linkedin/user",
              userRefresh: "/api/linkedin/user/refresh",
              profile: "/api/linkedin/profile",
              createPost: "/api/posts/linkedin/post",
              uploadMedia: "/api/posts/linkedin/upload",
            },
            x: {
              user: "/api/x/user",
              userRefresh: "/api/x/user/refresh",
              createTweet: "/api/posts/x/tweet",
              uploadMedia: "/api/posts/x/upload",
            },
            substack: {
              createSession: "/api/substack/session",
              login: "/api/substack/login",
              verify: "/api/substack/verify",
              sessionStatus: "/api/substack/session/:sessionId",
              closeSession: "/api/substack/session/:sessionId",
            },
          },
        },
      }
    )
  );
});

// Mount route modules
router.use("/auth", authRoutes);
router.use("/api/posts", postsRoutes);

// API routes
router.use("/api/auth", apiRoutes);
router.use("/api/linkedin", linkedinApiRoutes);
router.use("/api/x", xApiRoutes);

// Legacy compatibility
router.use("/getProfile", linkedinApiRoutes);

module.exports = router;
