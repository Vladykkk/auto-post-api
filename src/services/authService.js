/**
 * Authentication service for JWT operations
 * @module services/authService
 */

const jwt = require("jsonwebtoken");
const config = require("../config/environment");

/**
 * Provider-specific token creation configurations
 */
const PROVIDER_CONFIGS = {
  linkedin: {
    userIdField: "linkedinId",
    defaultExpiration: config.jwt.expiresIn,
  },
  x: {
    userIdField: "xId",
    defaultExpiration: config.jwt.xTokenExpiresIn || config.jwt.expiresIn,
  },
  substack: {
    userIdField: "substackId",
    defaultExpiration: config.jwt.expiresIn,
  },
};

/**
 * Creates a JWT token for any provider
 * @param {string} provider - Provider name ('linkedin', 'x', 'substack')
 * @param {Object} userData - User data to encode in token
 * @param {string} accessToken - Provider access token
 * @param {string} [refreshToken] - Provider refresh token (optional)
 * @param {number} [expiresIn] - Custom expiration time in seconds (optional)
 * @returns {string} JWT token
 */
function createToken(
  provider,
  userData,
  accessToken,
  refreshToken = null,
  expiresIn = null
) {
  const providerConfig = PROVIDER_CONFIGS[provider];
  if (!providerConfig) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  const payload = {
    [providerConfig.userIdField]: userData.id,
    email: userData.email,
    name: userData.name,
    accessToken,
    provider,
  };

  // Add provider-specific fields
  if (provider === "x") {
    payload.username = userData.username;
  }

  if (refreshToken) {
    payload.refreshToken = refreshToken;
  }

  const options = {
    expiresIn: expiresIn ? `${expiresIn}s` : providerConfig.defaultExpiration,
  };

  return jwt.sign(payload, config.jwt.secret, options);
}

/**
 * Parses expiration string to seconds
 * @param {string} expirationStr - Expiration string (e.g., "7d", "24h", "3600s")
 * @returns {number} Expiration time in seconds
 */
function parseExpirationToSeconds(expirationStr) {
  if (typeof expirationStr === "number") return expirationStr;

  const str = expirationStr.toString();
  if (str.endsWith("d")) {
    return parseInt(str) * 24 * 60 * 60;
  } else if (str.endsWith("h")) {
    return parseInt(str) * 60 * 60;
  } else if (str.endsWith("s")) {
    return parseInt(str);
  } else if (str.endsWith("m")) {
    return parseInt(str) * 60;
  }

  // Default to 7 days if format is unclear
  return 7 * 24 * 60 * 60;
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
  const { provider, email, name, iat, exp } = tokenPayload;

  const baseUser = {
    name,
    email,
    provider,
    loginTime: new Date(iat * 1000).toISOString(),
    tokenExpires: new Date(exp * 1000).toISOString(),
  };

  // Add provider-specific fields
  if (provider === "linkedin") {
    baseUser.id = tokenPayload.linkedinId;
  } else if (provider === "x") {
    baseUser.id = tokenPayload.xId;
    baseUser.username = tokenPayload.username;
  } else if (provider === "substack") {
    baseUser.id = tokenPayload.substackId;
  }

  return baseUser;
}

/**
 * Checks if token needs refresh (expires within specified minutes)
 * @param {Object} tokenPayload - Decoded JWT payload
 * @param {number} [thresholdMinutes=30] - Minutes before expiration to trigger refresh
 * @returns {boolean} True if token needs refresh
 */
function needsRefresh(tokenPayload, thresholdMinutes = 30) {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = tokenPayload.exp - now;
  const threshold = thresholdMinutes * 60;

  return expiresIn <= threshold;
}

module.exports = {
  createToken,
  parseExpirationToSeconds,
  verifyToken,
  extractBearerToken,
  formatUserFromToken,
  needsRefresh,

  // Legacy compatibility
  createXToken: (userData, accessToken, refreshToken, expiresIn) =>
    createToken("x", userData, accessToken, refreshToken, expiresIn),
  createToken: (userData, accessToken, expiresIn) =>
    createToken("linkedin", userData, accessToken, null, expiresIn),
};
