/**
 * Error handling middleware
 * @module middleware/errorHandler
 */

const config = require("../config/environment");
const { createErrorResponse } = require("../utils/response");

/**
 * Global error handler middleware
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 * @returns {void}
 */
function globalErrorHandler(err, req, res, next) {
  console.error("🚨 Global Error Handler:", {
    message: err.message,
    stack: config.server.nodeEnv === "development" ? err.stack : undefined,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString(),
  });

  // Default error response
  let statusCode = err.statusCode || 500;
  let message = err.message || "Internal Server Error";

  // Handle specific error types
  if (err.name === "ValidationError") {
    statusCode = 400;
    message = "Validation Error";
  } else if (err.name === "UnauthorizedError") {
    statusCode = 401;
    message = "Unauthorized";
  } else if (err.name === "CastError") {
    statusCode = 400;
    message = "Invalid Resource ID";
  }

  const errorResponse = createErrorResponse(
    message,
    config.server.nodeEnv === "development"
      ? { stack: err.stack, details: err }
      : undefined
  );

  res.status(statusCode).json(errorResponse);
}

/**
 * 404 Not Found handler
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {void}
 */
function notFoundHandler(req, res) {
  res.status(404).json(
    createErrorResponse(`Route ${req.method} ${req.originalUrl} not found`, {
      availableEndpoints: {
        auth: "/auth/linkedin",
        callback: "/auth/linkedin/callback",
        user: "/api/linkedin/user",
        profile: "/api/linkedin/profile",
      },
    })
  );
}

/**
 * Async error wrapper to catch async route errors
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Wrapped function
 */
function asyncWrapper(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  globalErrorHandler,
  notFoundHandler,
  asyncWrapper,
};
