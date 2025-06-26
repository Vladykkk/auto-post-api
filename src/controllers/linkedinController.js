/**
 * LinkedIn authentication and API controller
 * @module controllers/linkedinController
 */

const BaseController = require("./baseController");
const linkedinService = require("../services/linkedinService");
const authService = require("../services/authService");
const config = require("../config/environment");
const {
  createSuccessResponse,
  createErrorResponse,
} = require("../utils/response");

class LinkedinController extends BaseController {
  /**
   * Initiates LinkedIn OAuth flow
   */
  static initiateAuth = BaseController.asyncHandler(async (req, res) => {
    if (!config.linkedin.clientId) {
      return res.status(500).json(
        createErrorResponse("LinkedIn OAuth not configured", {
          missingConfig: "LINKEDIN_CLIENT_ID",
        })
      );
    }

    const state = linkedinService.generateState();
    const authUrl = linkedinService.generateAuthUrl(state);
    res.redirect(authUrl);
  });

  /**
   * Handles LinkedIn OAuth callback
   */
  static handleCallback = BaseController.asyncHandler(async (req, res) => {
    const { code, error: oauthError } = req.query;

    if (oauthError) {
      return res.status(400).json(
        createErrorResponse("LinkedIn authentication failed", {
          error: oauthError,
        })
      );
    }

    if (!code) {
      return res
        .status(400)
        .json(createErrorResponse("Authorization code not provided"));
    }

    // Exchange code for access token
    const tokenData = await linkedinService.exchangeCodeForToken(code);

    // Get user profile
    const profileData = await linkedinService.getUserProfile(
      tokenData.access_token
    );

    // Create JWT token
    const userToken = authService.createToken(
      "linkedin",
      profileData,
      tokenData.access_token,
      null,
      tokenData.expires_in
    );

    // Redirect to frontend with token
    const redirectUrl = `${
      config.server.frontendUrl
    }/?token=${encodeURIComponent(userToken)}&provider=linkedin`;
    res.redirect(redirectUrl);
  });

  /**
   * Get current LinkedIn user info from JWT token
   */
  static getCurrentUser = (req, res) => {
    const providerError = BaseController.validateProvider(req, "linkedin");
    if (providerError) {
      return res.status(400).json(providerError);
    }
    BaseController.getCurrentUser(req, res);
  };

  /**
   * Refresh user profile from LinkedIn API
   */
  static refreshProfile = BaseController.asyncHandler(async (req, res) => {
    const providerError = BaseController.validateProvider(req, "linkedin");
    if (providerError) {
      return res.status(400).json(providerError);
    }

    const { accessToken } = req.user;
    const profileData = await linkedinService.getUserProfile(accessToken);

    res.json(
      createSuccessResponse(profileData, "User profile refreshed", {
        refreshed: true,
        timestamp: new Date().toISOString(),
        platform: "LinkedIn",
      })
    );
  });

  /**
   * Creates a LinkedIn post
   */
  static createPost = BaseController.asyncHandler(async (req, res) => {
    const providerError = BaseController.validateProvider(req, "linkedin");
    if (providerError) {
      return res.status(400).json(providerError);
    }

    const { accessToken, name, linkedinId } = req.user;
    const {
      text,
      visibility,
      mediaType,
      media,
      articleUrl,
      articleTitle,
      articleDescription,
    } = req.body;

    // Validate required fields
    if (!text || text.trim().length === 0) {
      return res
        .status(400)
        .json(createErrorResponse("Post text is required", { field: "text" }));
    }

    if (text.length > 3000) {
      return res.status(400).json(
        createErrorResponse("Post text exceeds 3000 character limit", {
          field: "text",
          maxLength: 3000,
          currentLength: text.length,
        })
      );
    }

    const postData = {
      text: text.trim(),
      visibility: visibility || "PUBLIC",
      mediaType: mediaType || "NONE",
      media: media || [],
      articleUrl,
      articleTitle,
      articleDescription,
    };

    const createdPost = await linkedinService.createPost(accessToken, postData);

    res.json(
      createSuccessResponse(createdPost, "LinkedIn post created successfully", {
        platform: "LinkedIn",
        user: name,
        timestamp: new Date().toISOString(),
      })
    );
  });

  /**
   * Upload media for LinkedIn posts
   */
  static uploadMedia = BaseController.asyncHandler(async (req, res) => {
    const providerError = BaseController.validateProvider(req, "linkedin");
    if (providerError) {
      return res.status(400).json(providerError);
    }

    if (!req.file) {
      return res
        .status(400)
        .json(createErrorResponse("No file uploaded", { field: "file" }));
    }

    const { accessToken, linkedinId, name } = req.user;
    const { mediaType, title, description } = req.body;

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

    // Validate file size (LinkedIn limits: ~100MB for videos, ~20MB for images)
    const maxSize =
      mediaType === "video" ? 100 * 1024 * 1024 : 20 * 1024 * 1024;
    if (req.file.size > maxSize) {
      return res.status(400).json(
        createErrorResponse(
          `File too large. Maximum size for ${mediaType}: ${
            maxSize / (1024 * 1024)
          }MB`,
          {
            field: "file",
            size: req.file.size,
            maxSize: maxSize,
            mediaType: mediaType,
          }
        )
      );
    }

    const personUrn = `urn:li:person:${linkedinId}`;
    const mediaInfo = await linkedinService.uploadMedia(
      accessToken,
      personUrn,
      req.file.buffer,
      mediaType,
      title,
      description
    );

    res.json(
      createSuccessResponse(mediaInfo, "LinkedIn media uploaded successfully", {
        platform: "LinkedIn",
        user: name,
        mediaType: mediaType,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        timestamp: new Date().toISOString(),
      })
    );
  });
}

module.exports = LinkedinController;
