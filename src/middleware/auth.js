/**
 * Authentication middleware
 * @module middleware/auth
 */

const authService = require("../services/authService");
const { createApiResponse } = require("../utils/response");

/**
 * Middleware to authenticate JWT tokens
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 * @returns {void}
 */
async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = authService.extractBearerToken(authHeader);

    if (!token) {
      return res.status(401).json(
        createApiResponse(false, null, "Access token required", {
          expectedFormat: "Authorization: Bearer <token>",
        })
      );
    }

    const user = await authService.verifyToken(token);
    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json(
      createApiResponse(false, null, "Invalid or expired token", {
        error: error.message,
      })
    );
  }
}

/**
 * Optional authentication middleware - doesn't fail if no token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 * @returns {void}
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = authService.extractBearerToken(authHeader);

    if (token) {
      const user = await authService.verifyToken(token);
      req.user = user;
    }

    next();
  } catch (error) {
    // Continue without authentication if token is invalid
    next();
  }
}

module.exports = {
  authenticateToken,
  optionalAuth,
};
