/**
 * Main application entry point
 * @module app
 */

const express = require("express");
const cors = require("cors");
const session = require("express-session");
const config = require("./src/config/environment");
const routes = require("./src/routes");
const {
  globalErrorHandler,
  notFoundHandler,
} = require("./src/middleware/errorHandler");

const app = express();

/**
 * Configure CORS middleware
 */
const corsOptions = {
  origin: config.cors.origins,
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
};

/**
 * Apply middleware
 */
app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

/**
 * Session middleware for OAuth state storage
 */
app.use(
  session({
    secret: config.jwt.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // Set to true in production with HTTPS
      httpOnly: true,
      maxAge: 10 * 60 * 1000, // 10 minutes
    },
  })
);

/**
 * Security headers middleware
 */
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

/**
 * Request logging middleware (development only)
 */
if (config.server.nodeEnv === "development") {
  app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path}`);
    next();
  });
}

/**
 * Apply routes
 */
app.use("/", routes);

/**
 * Error handling middleware (must be last)
 */
app.use(notFoundHandler);
app.use(globalErrorHandler);

/**
 * Start server
 */
const server = app.listen(config.server.port, () => {
  console.log("🚀 Social Media OAuth Server Started");
  console.log("=".repeat(50));
  console.log(`📍 Server: http://localhost:${config.server.port}`);
  console.log(
    `🔗 LinkedIn: http://localhost:${config.server.port}/auth/linkedin`
  );
  console.log(`🔗 X (Twitter): http://localhost:${config.server.port}/auth/x`);
  console.log(`🌍 Environment: ${config.server.nodeEnv}`);
  console.log(`🎯 Frontend URL: ${config.server.frontendUrl}`);
  console.log("=".repeat(50));

  // Configuration warnings
  const warnings = [];

  if (!config.linkedin.clientId || !config.linkedin.clientSecret) {
    warnings.push(
      "LinkedIn credentials not configured (LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET)"
    );
  }

  if (!config.x.clientId || !config.x.clientSecret) {
    warnings.push(
      "X credentials not configured (X_CLIENT_ID, X_CLIENT_SECRET)"
    );
  }

  if (!config.jwt.secret || config.jwt.secret === "your-secret-key") {
    warnings.push("JWT secret not configured or using default (JWT_SECRET)");
  }

  if (warnings.length > 0) {
    console.warn("⚠️  Configuration Warnings:");
    warnings.forEach((warning) => console.warn(`   • ${warning}`));
  }
});

/**
 * Graceful shutdown
 */
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("✅ Process terminated");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("🛑 SIGINT received, shutting down gracefully");
  server.close(() => {
    console.log("✅ Process terminated");
    process.exit(0);
  });
});

module.exports = app;
