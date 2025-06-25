/**
 * Authentication service for JWT operations
 * @module services/authService
 */

const jwt = require("jsonwebtoken");
const config = require("../config/environment");

/**
 * Creates a JWT token with user data from LinkedIn
 * @param {Object} userData - User data to encode in token
 * @param {string} userData.id - User ID
 * @param {string} userData.email - User email
 * @param {string} userData.name - User name
 * @param {string} accessToken - LinkedIn access token
 * @param {number} [expiresIn] - LinkedIn token expiration (optional)
 * @returns {string} JWT token
 */
function createToken(userData, accessToken, expiresIn) {
  const payload = {
    linkedinId: userData.id,
    email: userData.email,
    name: userData.name,
    accessToken,
    provider: "linkedin",
  };

  const options = {
    expiresIn: expiresIn ? `${expiresIn}s` : config.jwt.expiresIn,
  };

  return jwt.sign(payload, config.jwt.secret, options);
}

/**
 * Creates a JWT token with X (Twitter) user data
 * @param {Object} userData - User data to encode in token
 * @param {string} userData.id - User ID
 * @param {string} userData.username - X username
 * @param {string} userData.name - User name
 * @param {string} userData.email - User email (may be null)
 * @param {string} accessToken - X access token
 * @param {string} [refreshToken] - X refresh token (optional)
 * @param {number} [expiresIn] - X token expiration (optional)
 * @returns {string} JWT token
 */
function createXToken(userData, accessToken, refreshToken, expiresIn) {
  const payload = {
    xId: userData.id,
    username: userData.username,
    email: userData.email,
    name: userData.name,
    accessToken,
    refreshToken,
    provider: "x",
  };

  const options = {
    expiresIn: expiresIn ? `${expiresIn}s` : config.jwt.expiresIn,
  };

  return jwt.sign(payload, config.jwt.secret, options);
}

/**
 * Verifies a JWT token
 * @param {string} token - JWT token to verify
 * @returns {Promise<Object>} Decoded token payload
 * @throws {Error} If token is invalid or expired
 */
function verifyToken(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, config.jwt.secret, (err, decoded) => {
      if (err) {
        reject(new Error(`Token verification failed: ${err.message}`));
      } else {
        resolve(decoded);
      }
    });
  });
}

/**
 * Extracts and validates Bearer token from Authorization header
 * @param {string} authHeader - Authorization header value
 * @returns {string|null} Extracted token or null if invalid
 */
function extractBearerToken(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  return authHeader.split(" ")[1];
}

/**
 * Formats user data from JWT payload for API response
 * @param {Object} tokenPayload - Decoded JWT payload
 * @returns {Object} Formatted user data
 */
function formatUserFromToken(tokenPayload) {
  const { linkedinId, email, name, iat, exp } = tokenPayload;

  return {
    id: linkedinId,
    name,
    email,
    loginTime: new Date(iat * 1000).toISOString(),
    tokenExpires: new Date(exp * 1000).toISOString(),
  };
}

module.exports = {
  createToken,
  createXToken,
  verifyToken,
  extractBearerToken,
  formatUserFromToken,
};
