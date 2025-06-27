/**
 * Substack API routes
 * @module routes/substackApi
 */

const express = require("express");
const substackService = require("../services/substackService");
const {
  createSuccessResponse,
  createErrorResponse,
} = require("../utils/response");

const router = express.Router();

/**
 * Create a new browser session for Substack automation
 * POST /api/substack/session
 */
router.post("/session", async (req, res) => {
  try {
    const result = await substackService.createSession();
    res.json(
      createSuccessResponse(result, "Browser session created successfully")
    );
  } catch (error) {
    res.status(500).json(
      createErrorResponse("Failed to create browser session", {
        error: error.message,
      })
    );
  }
});

/**
 * Initiate Substack login with email
 * POST /api/substack/login
 */
router.post("/login", async (req, res) => {
  try {
    const { sessionId, email } = req.body;

    if (!sessionId || !email) {
      return res
        .status(400)
        .json(createErrorResponse("Session ID and email are required"));
    }

    const result = await substackService.initiateLogin(sessionId, email);
    res.json(createSuccessResponse(result, "Login initiated successfully"));
  } catch (error) {
    res.status(500).json(
      createErrorResponse("Failed to initiate login", {
        error: error.message,
      })
    );
  }
});

/**
 * Submit verification code for Substack login
 * POST /api/substack/verify
 */
router.post("/verify", async (req, res) => {
  try {
    const { sessionId, verificationCode } = req.body;

    if (!sessionId || !verificationCode) {
      return res
        .status(400)
        .json(
          createErrorResponse("Session ID and verification code are required")
        );
    }

    const result = await substackService.submitVerificationCode(
      sessionId,
      verificationCode
    );
    res.json(
      createSuccessResponse(result, "Verification completed successfully")
    );
  } catch (error) {
    res.status(500).json(
      createErrorResponse("Failed to verify code", {
        error: error.message,
      })
    );
  }
});

/**
 * Wait for email verification (when user clicks link in email)
 * POST /api/substack/wait-verification
 */
router.post("/wait-verification", async (req, res) => {
  try {
    const { sessionId, timeoutMs = 300000 } = req.body; // 5 minutes default

    if (!sessionId) {
      return res
        .status(400)
        .json(createErrorResponse("Session ID is required"));
    }

    const result = await substackService.waitForEmailVerification(
      sessionId,
      timeoutMs
    );
    res.json(createSuccessResponse(result, "Email verification completed"));
  } catch (error) {
    res.status(500).json(
      createErrorResponse("Email verification failed", {
        error: error.message,
      })
    );
  }
});

/**
 * Alias for wait-verification (for convenience)
 * POST /api/substack/wait-verify
 */
router.post("/wait-verify", async (req, res) => {
  try {
    const { sessionId, timeoutMs = 300000 } = req.body; // 5 minutes default

    if (!sessionId) {
      return res
        .status(400)
        .json(createErrorResponse("Session ID is required"));
    }

    const result = await substackService.waitForEmailVerification(
      sessionId,
      timeoutMs
    );
    res.json(createSuccessResponse(result, "Email verification completed"));
  } catch (error) {
    res.status(500).json(
      createErrorResponse("Email verification failed", {
        error: error.message,
      })
    );
  }
});

/**
 * Get all active sessions (for debugging)
 * GET /api/substack/sessions
 */
router.get("/sessions", async (req, res) => {
  try {
    const activeSessions = await substackService.getAllActiveSessions();
    res.json(
      createSuccessResponse(activeSessions, "Active sessions retrieved")
    );
  } catch (error) {
    res.status(500).json(
      createErrorResponse("Failed to get active sessions", {
        error: error.message,
      })
    );
  }
});

/**
 * Get session status
 * GET /api/substack/session/:sessionId
 */
router.get("/session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const status = await substackService.getSessionStatus(sessionId);

    if (!status.exists) {
      return res.status(404).json(
        createErrorResponse("Session not found", {
          sessionId,
          hint: "Session may have expired, been cleaned up, or server restarted. Check /api/substack/sessions for active sessions.",
        })
      );
    }

    res.json(createSuccessResponse(status, "Session status retrieved"));
  } catch (error) {
    res.status(500).json(
      createErrorResponse("Failed to get session status", {
        error: error.message,
      })
    );
  }
});

/**
 * Reconnect to a persistent session
 * POST /api/substack/session/:sessionId/reconnect
 */
router.post("/session/:sessionId/reconnect", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await substackService.reconnectSession(sessionId);
    res.json(createSuccessResponse(result, "Session reconnection completed"));
  } catch (error) {
    res.status(500).json(
      createErrorResponse("Failed to reconnect session", {
        error: error.message,
      })
    );
  }
});

/**
 * Close browser session
 * DELETE /api/substack/session/:sessionId
 */
router.delete("/session/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const success = await substackService.closeSession(sessionId);

    if (!success) {
      return res
        .status(404)
        .json(createErrorResponse("Session not found or already closed"));
    }

    res.json(
      createSuccessResponse({ closed: true }, "Session closed successfully")
    );
  } catch (error) {
    res.status(500).json(
      createErrorResponse("Failed to close session", {
        error: error.message,
      })
    );
  }
});

/**
 * Get current page state for debugging
 * GET /api/substack/session/:sessionId/state
 */
router.get("/session/:sessionId/state", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const pageState = await substackService.getPageState(sessionId);
    res.json(createSuccessResponse(pageState, "Page state retrieved"));
  } catch (error) {
    res.status(500).json(
      createErrorResponse("Failed to get page state", {
        error: error.message,
      })
    );
  }
});

/**
 * Get current user info from Substack JWT token
 * GET /api/substack/user
 */
router.get("/user", async (req, res) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json(
        createErrorResponse("Authorization token required", {
          hint: "Include 'Authorization: Bearer <substackAuthToken>' header",
        })
      );
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify and decode the JWT token
    const jwt = require("jsonwebtoken");
    const config = require("../config/environment");

    let decoded;
    try {
      decoded = jwt.verify(token, config.jwt.secret);
    } catch (jwtError) {
      return res.status(401).json(
        createErrorResponse("Invalid or expired token", {
          error: jwtError.message,
        })
      );
    }

    // Check if it's a Substack token
    if (decoded.provider !== "substack") {
      return res.status(400).json(
        createErrorResponse("Invalid token provider", {
          expected: "substack",
          received: decoded.provider,
        })
      );
    }

    // Return user info from the token
    const userInfo = {
      provider: decoded.provider,
      email: decoded.email,
      name: decoded.name,
      profileUrl: decoded.profileUrl,
      isLoggedIn: decoded.isLoggedIn,
      loginTime: decoded.loginTime,
      tokenIssuedAt: new Date(decoded.iat * 1000).toISOString(),
      tokenExpiresAt: new Date(decoded.exp * 1000).toISOString(),
      authTokens: decoded.authTokens, // Include auth cookies/tokens for API calls
    };

    res.json(createSuccessResponse(userInfo, "Substack user info retrieved"));
  } catch (error) {
    res.status(500).json(
      createErrorResponse("Failed to get user info", {
        error: error.message,
      })
    );
  }
});

/**
 * Create a post on Substack
 * POST /api/substack/post
 */
router.post("/post", async (req, res) => {
  try {
    const { sessionId, title, content, subtitle, isDraft = false } = req.body;

    // Validate required fields
    if (!sessionId) {
      return res
        .status(400)
        .json(createErrorResponse("Session ID is required"));
    }

    if (!title || !content) {
      return res
        .status(400)
        .json(createErrorResponse("Title and content are required"));
    }

    // Validate content length (Substack has limits)
    if (title.length > 200) {
      return res
        .status(400)
        .json(createErrorResponse("Title too long (max 200 characters)"));
    }

    if (content.length > 100000) {
      return res
        .status(400)
        .json(createErrorResponse("Content too long (max 100,000 characters)"));
    }

    const postData = {
      title: title.trim(),
      content: content.trim(),
      subtitle: subtitle ? subtitle.trim() : "",
      isDraft,
    };

    const result = await substackService.createPost(sessionId, postData);
    res.json(
      createSuccessResponse(
        result,
        `Post ${isDraft ? "saved as draft" : "published"} successfully`
      )
    );
  } catch (error) {
    res.status(500).json(
      createErrorResponse("Failed to create post", {
        error: error.message,
      })
    );
  }
});

// Update session status manually (for avoiding re-authentication)
router.put("/session/:sessionId/status", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { status, userData } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
        meta: { field: "status" },
      });
    }

    // Get session from persistent storage
    const session = await substackService.getSessionStatus(sessionId);
    if (!session.exists) {
      return res.status(404).json({
        success: false,
        message: "Session not found",
        meta: { sessionId },
      });
    }

    // Update session in persistent storage
    const updatedSession = {
      id: sessionId,
      status: status,
      email: session.email,
      createdAt: session.createdAt,
      userData: userData || session.userData,
    };

    await substackService.updateSessionStatus(sessionId, updatedSession);

    res.json({
      success: true,
      message: "Session status updated successfully",
      data: {
        sessionId,
        oldStatus: session.status,
        newStatus: status,
      },
    });
  } catch (error) {
    console.error("Error updating session status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update session status",
      meta: { error: error.message },
    });
  }
});

/**
 * Refresh session authentication tokens
 * POST /api/substack/session/:sessionId/refresh
 */
router.post("/session/:sessionId/refresh", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await substackService.refreshSessionAuth(sessionId);

    if (result.success) {
      res.json(
        createSuccessResponse(result, "Session authentication refreshed")
      );
    } else {
      res.status(500).json(
        createErrorResponse("Failed to refresh session authentication", {
          error: result.error,
        })
      );
    }
  } catch (error) {
    res.status(500).json(
      createErrorResponse("Failed to refresh session authentication", {
        error: error.message,
      })
    );
  }
});

module.exports = router;
