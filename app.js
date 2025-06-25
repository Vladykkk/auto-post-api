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
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
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
  console.log("🚀 LinkedIn OAuth Server Started");
  console.log("=".repeat(50));
  console.log(`📍 Server: http://localhost:${config.server.port}`);
  console.log(
    `🔗 OAuth URL: http://localhost:${config.server.port}/auth/linkedin`
  );
  console.log(`🌍 Environment: ${config.server.nodeEnv}`);
  console.log(`🎯 Frontend URL: ${config.server.frontendUrl}`);
  console.log("=".repeat(50));

  // Configuration warnings
  if (!config.linkedin.clientId || !config.linkedin.clientSecret) {
    console.warn("⚠️  Warning: LinkedIn credentials not configured");
    console.warn("   Please set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET");
  }

  if (!config.jwt.secret || config.jwt.secret === "your-secret-key") {
    console.warn("⚠️  Warning: JWT secret not configured or using default");
    console.warn("   Please set a secure JWT_SECRET in your environment");
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
