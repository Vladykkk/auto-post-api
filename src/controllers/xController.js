/**
 * X (Twitter) authentication and API controller
 * @module controllers/xController
 */

const BaseController = require("./baseController");
const xService = require("../services/xService");
const authService = require("../services/authService");
const config = require("../config/environment");
const {
  createSuccessResponse,
  createErrorResponse,
} = require("../utils/response");

class XController extends BaseController {
  /**
   * Initiates X OAuth flow
   */
  static initiateAuth = BaseController.asyncHandler(async (req, res) => {
    if (!config.x.clientId) {
      return res.status(500).json(
        createErrorResponse("X OAuth not configured", {
          missingConfig: "X_CLIENT_ID",
        })
      );
    }

    const state = xService.generateState();
    const pkce = xService.generatePKCE();
    const authUrl = xService.generateAuthUrl(state, pkce.codeChallenge);

    // Store PKCE verifier in session
    req.session.codeVerifier = pkce.codeVerifier;
    req.session.state = state;

    res.redirect(authUrl);
  });

  /**
   * Handles X OAuth callback
   */
  static handleCallback = BaseController.asyncHandler(async (req, res) => {
    const { code, state, error: oauthError } = req.query;
    const { codeVerifier } = req.session;

    if (oauthError) {
      return res
        .status(400)
        .json(
          createErrorResponse("X authentication failed", { error: oauthError })
        );
    }

    if (!code || !codeVerifier) {
      return res
        .status(400)
        .json(
          createErrorResponse("Authorization code or PKCE verifier missing")
        );
    }

    // Exchange code for access token with PKCE
    const tokenData = await xService.exchangeCodeForToken(code, codeVerifier);

    // Get user profile
    const profileData = await xService.getUserProfile(tokenData.access_token);

    // Create JWT token with extended expiration
    const extendedExpirationSeconds = authService.parseExpirationToSeconds(
      config.jwt.xTokenExpiresIn
    );

    const userToken = authService.createToken(
      "x",
      profileData,
      tokenData.access_token,
      tokenData.refresh_token,
      extendedExpirationSeconds
    );

    // Redirect to frontend with token
    const redirectUrl = `${
      config.server.frontendUrl
    }/?token=${encodeURIComponent(userToken)}&provider=x`;
    res.redirect(redirectUrl);
  });

  /**
   * Get current X user info from JWT token
   */
  static getCurrentUser = (req, res) => {
    const providerError = BaseController.validateProvider(req, "x");
    if (providerError) {
      return res.status(400).json(providerError);
    }
    BaseController.getCurrentUser(req, res);
  };

  /**
   * Refresh user profile from X API
   */
  static refreshProfile = BaseController.asyncHandler(async (req, res) => {
    const providerError = BaseController.validateProvider(req, "x");
    if (providerError) {
      return res.status(400).json(providerError);
    }

    // Check and refresh token if needed
    const refreshedTokenData = await BaseController.refreshTokenIfNeeded(
      req.user,
      xService.refreshAccessToken
    );

    const profileData = await xService.getUserProfile(
      refreshedTokenData.accessToken
    );

    res.json(
      createSuccessResponse(profileData, "X user profile refreshed", {
        refreshed: true,
        timestamp: new Date().toISOString(),
        platform: "X",
      })
    );
  });

  /**
   * Creates a tweet on X
   */
  static createTweet = BaseController.asyncHandler(async (req, res) => {
    const providerError = BaseController.validateProvider(req, "x");
    if (providerError) {
      return res.status(400).json(providerError);
    }

    // Check and refresh token if needed
    const refreshedTokenData = await BaseController.refreshTokenIfNeeded(
      req.user,
      xService.refreshAccessToken
    );

    const { name, xId, username } = req.user;
    const { text, mediaIds, replyToTweetId, pollOptions, pollDurationMinutes } =
      req.body;

    // Validate required fields
    if (!text || text.trim().length === 0) {
      return res
        .status(400)
        .json(createErrorResponse("Tweet text is required", { field: "text" }));
    }

    if (text.length > 280) {
      return res.status(400).json(
        createErrorResponse("Tweet text exceeds 280 character limit", {
          field: "text",
          maxLength: 280,
          currentLength: text.length,
        })
      );
    }

    const tweetData = {
      text: text.trim(),
    };

    // Add optional fields
    if (mediaIds && mediaIds.length > 0) {
      tweetData.media = { media_ids: mediaIds };
    }

    if (replyToTweetId) {
      tweetData.reply = { in_reply_to_tweet_id: replyToTweetId };
    }

    if (pollOptions && pollOptions.length > 0) {
      tweetData.poll = {
        options: pollOptions,
        duration_minutes: pollDurationMinutes || 1440, // Default 24 hours
      };
    }

    const createdTweet = await xService.createTweet(
      refreshedTokenData.accessToken,
      tweetData
    );

    res.json(
      createSuccessResponse(createdTweet, "X tweet created successfully", {
        platform: "X",
        user: `${name} (@${username})`,
        timestamp: new Date().toISOString(),
      })
    );
  });

  /**
   * Upload media for X tweets
   */
  static uploadMedia = BaseController.asyncHandler(async (req, res) => {
    const providerError = BaseController.validateProvider(req, "x");
    if (providerError) {
      return res.status(400).json(providerError);
    }

    if (!req.file) {
      return res
        .status(400)
        .json(createErrorResponse("No file uploaded", { field: "media" }));
    }

    // Check and refresh token if needed
    const refreshedTokenData = await BaseController.refreshTokenIfNeeded(
      req.user,
      xService.refreshAccessToken
    );

    const { name, username } = req.user;
    const { mediaType, altText } = req.body;

    // Validate media type
    const validMediaTypes = ["image", "video"];
    if (!mediaType || !validMediaTypes.includes(mediaType)) {
      return res.status(400).json(
        createErrorResponse("Invalid or missing media type", {
          field: "mediaType",
          provided: mediaType,
          allowed: validMediaTypes,
        })
      );
    }

    // Validate file size (X limits: ~5MB for images, ~512MB for videos)
    const maxSize = mediaType === "video" ? 512 * 1024 * 1024 : 5 * 1024 * 1024;
    if (req.file.size > maxSize) {
      return res.status(400).json(
        createErrorResponse(
          `File too large. Maximum size for ${mediaType}: ${
            maxSize / (1024 * 1024)
          }MB`,
          {
            field: "media",
            size: req.file.size,
            maxSize: maxSize,
            mediaType: mediaType,
          }
        )
      );
    }

    try {
      const mediaInfo = await xService.uploadMedia(
        refreshedTokenData.accessToken,
        req.file.buffer,
        mediaType,
        altText
      );

      res.json(
        createSuccessResponse(mediaInfo, "X media uploaded successfully", {
          platform: "X",
          user: `${name} (@${username})`,
          mediaType: mediaType,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          timestamp: new Date().toISOString(),
        })
      );
    } catch (uploadError) {
      // Handle specific X API limitations
      if (
        uploadError.message.includes("403") ||
        uploadError.message.includes("Forbidden")
      ) {
        return res.status(403).json(
          createErrorResponse(
            "Media upload requires elevated X API access. Please apply for elevated access in your X Developer Portal.",
            {
              error: uploadError.message,
              solution:
                "Apply for elevated access at https://developer.twitter.com/en/portal/petition/essential/basic-info",
              workaround:
                "Use text-only tweets or include image URLs in tweet text",
              timestamp: new Date().toISOString(),
            }
          )
        );
      }
      throw uploadError;
    }
  });
}

module.exports = XController;
