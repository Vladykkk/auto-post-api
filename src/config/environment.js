/**
 * Environment configuration with validation
 * @module config/environment
 */

require("dotenv").config();

/**
 * Validates required environment variables
 * @param {Object} config - Configuration object
 * @throws {Error} If required variables are missing
 */
function validateConfig(config) {
  const required = [
    "LINKEDIN_CLIENT_ID",
    "LINKEDIN_CLIENT_SECRET",
    "JWT_SECRET",
  ];
  const missing = required.filter((key) => !config[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

const config = {
  // LinkedIn OAuth Configuration
  linkedin: {
    clientId: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    redirectUri:
      process.env.REDIRECT_URI ||
      "http://localhost:3000/auth/linkedin/callback",
    scope: "openid profile email w_member_social",
  },

  // X (Twitter) OAuth Configuration
  x: {
    clientId: process.env.X_CLIENT_ID,
    clientSecret: process.env.X_CLIENT_SECRET,
    redirectUri:
      process.env.X_REDIRECT_URI || "http://localhost:3000/auth/x/callback",
    scope: "tweet.read tweet.write users.read follows.read follows.write",
  },

  // JWT Configuration
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || "24h",
  },

  // Server Configuration
  server: {
    port: parseInt(process.env.PORT) || 3000,
    frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
    nodeEnv: process.env.NODE_ENV || "development",
  },

  // CORS Configuration
  cors: {
    origins: [
      "http://localhost:5173",
      "http://localhost:3001",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:3001",
    ],
  },
};

// Validate configuration in production
if (config.server.nodeEnv === "production") {
  validateConfig(config.linkedin);
  validateConfig(config.jwt);
}

module.exports = config;
