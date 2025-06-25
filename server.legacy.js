/**
 * LEGACY SERVER FILE - BACKUP OF ORIGINAL IMPLEMENTATION
 * This file is kept for reference. Use app.js for the refactored version.
 */

const express = require("express");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const cors = require("cors");
require("dotenv").config();

const app = express();

// Middleware
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:3001",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:3001",
    ],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Environment variables
const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";
const PORT = process.env.PORT || 3000;

// Routes

// Health check route
app.get("/", (req, res) => {
  res.json({
    message: "LinkedIn OAuth 2.0 Server is running!",
    endpoints: {
      login: "/auth/linkedin",
      callback: "/auth/linkedin/callback",
      profile: "/getProfile",
    },
  });
});

// Initiate LinkedIn OAuth
app.get("/auth/linkedin", (req, res) => {
  if (!CLIENT_ID) {
    return res.status(500).json({ error: "LinkedIn Client ID not configured" });
  }

  const state = Math.random().toString(36).substring(2, 15);
  const scope = "email profile openid";

  const linkedinAuthUrl = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&state=${state}&scope=${encodeURIComponent(scope)}`;

  console.log("Redirecting to LinkedIn OAuth URL:", linkedinAuthUrl);
  res.redirect(linkedinAuthUrl);
});

// Handle LinkedIn OAuth callback
app.get("/auth/linkedin/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error("LinkedIn OAuth error:", error);
    return res
      .status(400)
      .json({ error: "LinkedIn authentication failed", details: error });
  }

  if (!code) {
    return res.status(400).json({ error: "Authorization code not provided" });
  }

  try {
    console.log("Exchanging code for access token...");

    // Exchange authorization code for access token
    const tokenResponse = await axios.post(
      "https://www.linkedin.com/oauth/v2/accessToken",
      null,
      {
        params: {
          grant_type: "authorization_code",
          code: code,
          redirect_uri: REDIRECT_URI,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
        },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const { access_token, expires_in } = tokenResponse.data;
    console.log("Access token obtained successfully");

    // Get user profile information
    const profileData = await getUserProfile(access_token);

    // Create JWT token for your application
    const userToken = jwt.sign(
      {
        linkedinId: profileData.id,
        email: profileData.email,
        name: profileData.name,
        accessToken: access_token,
      },
      JWT_SECRET,
      { expiresIn: expires_in ? `${expires_in}s` : "1h" }
    );

    // Instead of returning JSON, redirect to frontend with token
    const redirectUrl = `${FRONTEND_URL}/?token=${encodeURIComponent(
      userToken
    )}`;

    console.log("✅ Redirecting to frontend:", redirectUrl);
    res.redirect(redirectUrl);
  } catch (error) {
    console.error(
      "Error during LinkedIn OAuth:",
      error.response?.data || error.message
    );
    res.status(500).json({
      error: "Authentication failed",
      details: error.response?.data || error.message,
    });
  }
});

// Get user profile with access token
app.get("/getProfile", authenticateToken, async (req, res) => {
  try {
    const { accessToken } = req.user;
    const profileData = await getUserProfile(accessToken);

    res.json({
      success: true,
      profile: profileData,
    });
  } catch (error) {
    console.error(
      "Error fetching profile:",
      error.response?.data || error.message
    );
    res.status(500).json({
      error: "Failed to fetch profile",
      details: error.response?.data || error.message,
    });
  }
});

// Get current user info from JWT token (no additional API calls needed)
app.get("/api/linkedin/user", authenticateToken, (req, res) => {
  try {
    // Extract user data from JWT payload
    const { linkedinId, email, name, iat, exp } = req.user;

    res.json({
      success: true,
      user: {
        id: linkedinId,
        name: name,
        email: email,
        loginTime: new Date(iat * 1000).toISOString(),
        tokenExpires: new Date(exp * 1000).toISOString(),
      },
    });
  } catch (error) {
    console.error("Error getting user info:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get user information",
    });
  }
});

// Refresh user profile data (makes API call to LinkedIn)
app.get("/api/linkedin/user/refresh", authenticateToken, async (req, res) => {
  try {
    const { accessToken } = req.user;
    const profileData = await getUserProfile(accessToken);

    res.json({
      success: true,
      user: profileData,
      refreshed: true,
    });
  } catch (error) {
    console.error(
      "Error refreshing user profile:",
      error.response?.data || error.message
    );
    res.status(500).json({
      success: false,
      error: "Failed to refresh user profile",
      details: error.response?.data || error.message,
    });
  }
});

// Helper function to get user profile from LinkedIn API using OpenID Connect
async function getUserProfile(accessToken) {
  try {
    // Use OpenID Connect userInfo endpoint
    const userInfoResponse = await axios.get(
      "https://api.linkedin.com/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const userInfo = userInfoResponse.data;

    return {
      id: userInfo.sub, // Subject identifier
      name: userInfo.name,
      firstName: userInfo.given_name,
      lastName: userInfo.family_name,
      email: userInfo.email,
      profilePicture: userInfo.picture,
      locale: userInfo.locale,
      emailVerified: userInfo.email_verified,
    };
  } catch (error) {
    console.error(
      "Error fetching LinkedIn profile:",
      error.response?.data || error.message
    );
    throw error;
  }
}

// Middleware to authenticate JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access token required" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Invalid or expired token" });
    }
    req.user = user;
    next();
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  console.log(`LinkedIn OAuth URL: http://localhost:${PORT}/auth/linkedin`);

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.warn(
      "⚠️  Warning: LinkedIn credentials not configured. Please set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in your .env file"
    );
  }
});
