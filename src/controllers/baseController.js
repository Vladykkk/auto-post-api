/**
 * Base controller with common functionality
 * @module controllers/baseController
 */

const {
  createSuccessResponse,
  createErrorResponse,
} = require("../utils/response");
const authService = require("../services/authService");

/**
 * Base class for all controllers with common functionality
 */
class BaseController {
  /**
   * Handle async controller methods with automatic error handling
   * @param {Function} fn - Async controller function
   */
  static asyncHandler(fn) {
    return (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
  }

  /**
   * Validate provider in request
   * @param {Object} req - Express request object
   * @param {string} expectedProvider - Expected provider name
   * @returns {Object|null} Error response object or null if valid
   */
  static validateProvider(req, expectedProvider) {
    const { provider } = req.user;
    if (provider !== expectedProvider) {
      return createErrorResponse("Invalid token provider", {
        expected: expectedProvider,
        received: provider,
      });
    }
    return null;
  }

  /**
   * Get current user info from JWT token
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  static getCurrentUser(req, res) {
    try {
      const userData = authService.formatUserFromToken(req.user);
      res.json(createSuccessResponse(userData, "User information retrieved"));
    } catch (error) {
      res.status(500).json(
        createErrorResponse("Failed to get user information", {
          error: error.message,
        })
      );
    }
  }

  /**
   * Handle logout
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  static logout(req, res) {
    try {
      const { provider } = req.user;
      res.json(
        createSuccessResponse({ provider }, `${provider} logout successful`, {
          timestamp: new Date().toISOString(),
        })
      );
    } catch (error) {
      res
        .status(500)
        .json(createErrorResponse("Logout failed", { error: error.message }));
    }
  }

  /**
   * Refresh access token if needed
   * @param {Object} tokenData - Current token data from JWT
   * @param {Function} refreshFunction - Provider-specific refresh function
   * @returns {Promise<Object>} Updated token data or original if refresh not needed
   */
  static async refreshTokenIfNeeded(tokenData, refreshFunction) {
    try {
      if (!authService.needsRefresh(tokenData, 30)) {
        return tokenData;
      }

      if (!tokenData.refreshToken) {
        return tokenData;
      }

      const refreshedTokenData = await refreshFunction(tokenData.refreshToken);

      return {
        ...tokenData,
        accessToken: refreshedTokenData.access_token,
        refreshToken:
          refreshedTokenData.refresh_token || tokenData.refreshToken,
      };
    } catch (error) {
      // Return original token data if refresh fails
      return tokenData;
    }
  }
}

module.exports = BaseController;
