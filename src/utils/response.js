/**
 * Response utilities for consistent API responses
 * @module utils/response
 */

/**
 * Creates a standardized API response object
 * @param {boolean} success - Whether the operation was successful
 * @param {*} data - Response data
 * @param {string} [message] - Optional message
 * @param {*} [meta] - Optional metadata
 * @returns {Object} Standardized response object
 */
function createApiResponse(success, data, message, meta) {
  const response = { success };

  if (data !== null && data !== undefined) {
    response.data = data;
  }

  if (message) {
    response.message = message;
  }

  if (meta) {
    response.meta = meta;
  }

  return response;
}

/**
 * Creates a success response
 * @param {*} data - Response data
 * @param {string} [message] - Optional success message
 * @param {*} [meta] - Optional metadata
 * @returns {Object} Success response object
 */
function createSuccessResponse(data, message, meta) {
  return createApiResponse(true, data, message, meta);
}

/**
 * Creates an error response
 * @param {string} message - Error message
 * @param {*} [details] - Optional error details
 * @returns {Object} Error response object
 */
function createErrorResponse(message, details) {
  return createApiResponse(false, null, message, details);
}

module.exports = {
  createApiResponse,
  createSuccessResponse,
  createErrorResponse,
};
