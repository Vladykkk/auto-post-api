/**
 * Authentication controller
 * @module controllers/authController
 */

const linkedinService = require("../services/linkedinService");
const xService = require("../services/xService");
const authService = require("../services/authService");
const config = require("../config/environment");
const {
  createSuccessResponse,
  createErrorResponse,
} = require("../utils/response");

/**
 * Initiates LinkedIn OAuth flow
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {void}
 */
async function initiateLinkedInAuth(req, res) {
  try {
    if (!config.linkedin.clientId) {
      return res.status(500).json(
        createErrorResponse("LinkedIn OAuth not configured", {
          missingConfig: "LINKEDIN_CLIENT_ID",
        })
      );
    }

    const state = linkedinService.generateState();
    const authUrl = linkedinService.generateAuthUrl(state);

    console.log(
      `🔗 Redirecting to LinkedIn OAuth: ${authUrl.substring(0, 100)}...`
    );
    res.redirect(authUrl);
  } catch (error) {
    console.error("Error initiating LinkedIn auth:", error);
    res.status(500).json(
      createErrorResponse("Failed to initiate authentication", {
        error: error.message,
      })
    );
  }
}

/**
 * Handles LinkedIn OAuth callback
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {void}
 */
async function handleLinkedInCallback(req, res) {
  try {
    const { code, error: oauthError } = req.query;

    if (oauthError) {
      console.error("LinkedIn OAuth error:", oauthError);
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

    console.log("🔄 Exchanging authorization code for access token...");

    // Exchange code for access token
    const tokenData = await linkedinService.exchangeCodeForToken(code);
    console.log("✅ Access token obtained successfully");

    // Get user profile
    const profileData = await linkedinService.getUserProfile(
      tokenData.access_token
    );
    console.log(`👤 Profile fetched for user: ${profileData.name}`);

    // Create JWT token
    const userToken = authService.createToken(
      profileData,
      tokenData.access_token,
      tokenData.expires_in
    );

    // Redirect to frontend with token
    const redirectUrl = `${
      config.server.frontendUrl
    }/?token=${encodeURIComponent(userToken)}`;
    console.log(`🎯 Redirecting to frontend: ${config.server.frontendUrl}`);

    res.redirect(redirectUrl);
  } catch (error) {
    console.error("Error during LinkedIn OAuth callback:", error);
    res
      .status(500)
      .json(
        createErrorResponse("Authentication failed", { error: error.message })
      );
  }
}

/**
 * Gets current user info from JWT token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {void}
 */
function getCurrentUser(req, res) {
  try {
    const userData = authService.formatUserFromToken(req.user);
    res.json(createSuccessResponse(userData, "User information retrieved"));
  } catch (error) {
    console.error("Error getting user info:", error);
    res.status(500).json(
      createErrorResponse("Failed to get user information", {
        error: error.message,
      })
    );
  }
}

/**
 * Refreshes user profile from LinkedIn API
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {void}
 */
async function refreshUserProfile(req, res) {
  try {
    const { accessToken } = req.user;
    const profileData = await linkedinService.getUserProfile(accessToken);

    res.json(
      createSuccessResponse(profileData, "User profile refreshed", {
        refreshed: true,
        timestamp: new Date().toISOString(),
      })
    );
  } catch (error) {
    console.error("Error refreshing user profile:", error);
    res.status(500).json(
      createErrorResponse("Failed to refresh user profile", {
        error: error.message,
      })
    );
  }
}

/**
 * Gets detailed user profile from LinkedIn API
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {void}
 */
async function getDetailedProfile(req, res) {
  try {
    const { accessToken } = req.user;
    const profileData = await linkedinService.getUserProfile(accessToken);

    res.json(createSuccessResponse(profileData, "Profile data retrieved"));
  } catch (error) {
    console.error("Error fetching profile:", error);
    res
      .status(500)
      .json(
        createErrorResponse("Failed to fetch profile", { error: error.message })
      );
  }
}

/**
 * Creates a LinkedIn post with optional media
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {void}
 */
async function createLinkedInPost(req, res) {
  try {
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
      return res.status(400).json(
        createErrorResponse("Post text is required", {
          field: "text",
          provided: !!text,
        })
      );
    }

    // Validate text length (LinkedIn limit is 3000 characters)
    if (text.length > 3000) {
      return res.status(400).json(
        createErrorResponse(
          "Post text exceeds maximum length of 3000 characters",
          {
            field: "text",
            length: text.length,
            maxLength: 3000,
          }
        )
      );
    }

    // Validate visibility if provided
    const validVisibilities = ["PUBLIC", "CONNECTIONS", "LOGGED_IN_MEMBERS"];
    if (visibility && !validVisibilities.includes(visibility)) {
      return res.status(400).json(
        createErrorResponse("Invalid visibility option", {
          field: "visibility",
          provided: visibility,
          allowed: validVisibilities,
        })
      );
    }

    // Validate media type if provided
    const validMediaTypes = ["NONE", "IMAGE", "VIDEO", "ARTICLE"];
    if (mediaType && !validMediaTypes.includes(mediaType)) {
      return res.status(400).json(
        createErrorResponse("Invalid media type", {
          field: "mediaType",
          provided: mediaType,
          allowed: validMediaTypes,
        })
      );
    }

    // Validate article URL if article type
    if (mediaType === "ARTICLE" && !articleUrl) {
      return res.status(400).json(
        createErrorResponse("Article URL is required for ARTICLE media type", {
          field: "articleUrl",
          mediaType: "ARTICLE",
        })
      );
    }

    // Validate media assets if image/video type
    if (
      (mediaType === "IMAGE" || mediaType === "VIDEO") &&
      (!media || media.length === 0)
    ) {
      return res.status(400).json(
        createErrorResponse(
          `Media assets are required for ${mediaType} media type. Please upload media first using /api/linkedin/upload`,
          {
            field: "media",
            mediaType: mediaType,
            hint: "Use POST /api/linkedin/upload to upload media files first, then include the returned assetUrn in the media array",
          }
        )
      );
    }

    console.log(`📝 Creating LinkedIn post for: ${name}`);
    console.log(
      `📄 Post text: "${text.substring(0, 100)}${
        text.length > 100 ? "..." : ""
      }"`
    );
    console.log(`📄 Media type: ${mediaType || "NONE"}`);
    console.log(`📄 Media items: ${media ? media.length : 0}`);

    // Create the post
    const postData = {
      text,
      visibility,
      mediaType,
      media,
      articleUrl,
      articleTitle,
      articleDescription,
    };
    const result = await linkedinService.createPost(accessToken, postData);

    console.log(`✅ Post created successfully: ${result.postId}`);

    res.json(
      createSuccessResponse(
        {
          postId: result.postId,
          postUrl: result.postUrl,
          text: text,
          visibility: visibility || "PUBLIC",
          mediaType: mediaType || "NONE",
          ...(mediaType === "ARTICLE" &&
            articleUrl && {
              article: {
                url: articleUrl,
                title: articleTitle,
                description: articleDescription,
              },
            }),
          createdAt: new Date().toISOString(),
        },
        "LinkedIn post created successfully",
        {
          author: name,
          platform: "LinkedIn",
          textLength: text.length,
          hasMedia: mediaType && mediaType !== "NONE",
        }
      )
    );
  } catch (error) {
    console.error("Error creating LinkedIn post:", error);

    // Handle specific LinkedIn API errors
    if (error.message.includes("Insufficient privileges")) {
      return res
        .status(403)
        .json(
          createErrorResponse(
            "Insufficient permissions to create posts. Please re-authenticate with posting permissions.",
            { error: error.message, action: "reauth_required" }
          )
        );
    }

    if (error.message.includes("Token expired")) {
      return res.status(401).json(
        createErrorResponse("Access token expired. Please re-authenticate.", {
          error: error.message,
          action: "reauth_required",
        })
      );
    }

    res.status(500).json(
      createErrorResponse("Failed to create LinkedIn post", {
        error: error.message,
        timestamp: new Date().toISOString(),
      })
    );
  }
}

/**
 * Uploads media for LinkedIn posts
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {void}
 */
async function uploadLinkedInMedia(req, res) {
  try {
    const { accessToken, linkedinId } = req.user;
    const { mediaType, title, description } = req.body;

    if (!req.file) {
      return res.status(400).json(
        createErrorResponse("No file uploaded", {
          field: "file",
          required: true,
        })
      );
    }

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

    // Validate file size (LinkedIn limits: 100MB for videos, 20MB for images)
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

    console.log(`📤 Uploading ${mediaType} for user: ${linkedinId}`);
    console.log(`📄 File: ${req.file.originalname} (${req.file.size} bytes)`);

    // Get person URN
    const personUrn = linkedinId.startsWith("urn:li:person:")
      ? linkedinId
      : `urn:li:person:${linkedinId}`;

    // Upload media
    const mediaInfo = await linkedinService.uploadMedia(
      accessToken,
      personUrn,
      req.file.buffer,
      mediaType,
      title,
      description
    );

    console.log(`✅ Media uploaded successfully: ${mediaInfo.assetUrn}`);

    res.json(
      createSuccessResponse(
        {
          assetUrn: mediaInfo.assetUrn,
          mediaType: mediaType,
          title: title,
          description: description,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          uploadedAt: new Date().toISOString(),
        },
        "Media uploaded successfully",
        {
          platform: "LinkedIn",
          mediaType: mediaType,
        }
      )
    );
  } catch (error) {
    console.error("Error uploading LinkedIn media:", error);

    res.status(500).json(
      createErrorResponse("Failed to upload media", {
        error: error.message,
        timestamp: new Date().toISOString(),
      })
    );
  }
}

/**
 * Handles user logout (server-side token invalidation)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {void}
 */
function logout(req, res) {
  try {
    // Log the logout action
    const { linkedinId, xId, name } = req.user;
    const userId = linkedinId || xId;
    console.log(`👋 User logout: ${name} (${userId})`);

    // In a real application, you might want to:
    // 1. Add the token to a blacklist/revocation list
    // 2. Store logout timestamp in database
    // 3. Invalidate refresh tokens if you have them
    // 4. Clear any server-side sessions

    res.json(
      createSuccessResponse(null, "Successfully logged out", {
        loggedOut: true,
        timestamp: new Date().toISOString(),
        user: { id: userId, name },
      })
    );
  } catch (error) {
    console.error("Error during logout:", error);
    res
      .status(500)
      .json(createErrorResponse("Failed to logout", { error: error.message }));
  }
}

// X (Twitter) Authentication Controllers

/**
 * Initiates X OAuth flow with PKCE
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {void}
 */
async function initiateXAuth(req, res) {
  try {
    if (!config.x.clientId) {
      return res.status(500).json(
        createErrorResponse("X OAuth not configured", {
          missingConfig: "X_CLIENT_ID",
        })
      );
    }

    const state = xService.generateState();
    const { codeVerifier, codeChallenge } = xService.generatePKCE();
    const authUrl = xService.generateAuthUrl(state, codeChallenge);

    // Store PKCE code verifier in session
    req.session.xOAuthState = state;
    req.session.xCodeVerifier = codeVerifier;

    console.log(`🔗 Redirecting to X OAuth: ${authUrl.substring(0, 100)}...`);
    res.redirect(authUrl);
  } catch (error) {
    console.error("Error initiating X auth:", error);
    res.status(500).json(
      createErrorResponse("Failed to initiate X authentication", {
        error: error.message,
      })
    );
  }
}

/**
 * Handles X OAuth callback with PKCE
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {void}
 */
async function handleXCallback(req, res) {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      console.error("X OAuth error:", oauthError);
      return res.status(400).json(
        createErrorResponse("X authentication failed", {
          error: oauthError,
        })
      );
    }

    if (!code || !state) {
      return res
        .status(400)
        .json(createErrorResponse("Authorization code or state not provided"));
    }

    // Retrieve PKCE code verifier from session
    const sessionState = req.session.xOAuthState;
    const codeVerifier = req.session.xCodeVerifier;

    if (!codeVerifier || !sessionState || sessionState !== state) {
      return res
        .status(400)
        .json(
          createErrorResponse("Invalid state parameter or session expired")
        );
    }

    // Clean up session data
    delete req.session.xOAuthState;
    delete req.session.xCodeVerifier;

    console.log("🔄 Exchanging X authorization code for access token...");

    // Exchange code for access token with PKCE
    const tokenData = await xService.exchangeCodeForToken(code, codeVerifier);
    console.log("✅ X access token obtained successfully");

    // Get user profile
    const profileData = await xService.getUserProfile(tokenData.access_token);
    console.log(
      `👤 X profile fetched for user: ${profileData.name} (@${profileData.username})`
    );

    // Create JWT token for X user
    const userToken = authService.createXToken(
      profileData,
      tokenData.access_token,
      tokenData.refresh_token,
      tokenData.expires_in
    );

    // Redirect to frontend with token
    const redirectUrl = `${
      config.server.frontendUrl
    }/?token=${encodeURIComponent(userToken)}&provider=x`;
    console.log(`🎯 Redirecting to frontend: ${config.server.frontendUrl}`);

    res.redirect(redirectUrl);
  } catch (error) {
    console.error("Error during X OAuth callback:", error);
    res
      .status(500)
      .json(
        createErrorResponse("X authentication failed", { error: error.message })
      );
  }
}

/**
 * Gets current X user info from JWT token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {void}
 */
function getCurrentXUser(req, res) {
  try {
    const { xId, username, name, email, provider } = req.user;

    if (provider !== "x") {
      return res.status(400).json(
        createErrorResponse("Invalid token provider", {
          expected: "x",
          received: provider,
        })
      );
    }

    const userData = {
      id: xId,
      username,
      name,
      email,
      provider,
    };

    res.json(createSuccessResponse(userData, "X user information retrieved"));
  } catch (error) {
    console.error("Error getting X user info:", error);
    res.status(500).json(
      createErrorResponse("Failed to get X user information", {
        error: error.message,
      })
    );
  }
}

/**
 * Refreshes X user profile from X API
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {void}
 */
async function refreshXUserProfile(req, res) {
  try {
    const { accessToken, provider } = req.user;

    if (provider !== "x") {
      return res.status(400).json(
        createErrorResponse("Invalid token provider", {
          expected: "x",
          received: provider,
        })
      );
    }

    const profileData = await xService.getUserProfile(accessToken);

    res.json(
      createSuccessResponse(profileData, "X user profile refreshed", {
        refreshed: true,
        timestamp: new Date().toISOString(),
        platform: "X",
      })
    );
  } catch (error) {
    console.error("Error refreshing X user profile:", error);
    res.status(500).json(
      createErrorResponse("Failed to refresh X user profile", {
        error: error.message,
      })
    );
  }
}

/**
 * Uploads media for X tweets
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {void}
 */
async function uploadXMedia(req, res) {
  try {
    const { accessToken, name, xId, username, provider } = req.user;

    if (provider !== "x") {
      return res.status(400).json(
        createErrorResponse("Invalid token provider", {
          expected: "x",
          received: provider,
        })
      );
    }

    if (!req.file) {
      return res.status(400).json(
        createErrorResponse("No file uploaded", {
          field: "file",
          required: true,
        })
      );
    }

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
            field: "file",
            size: req.file.size,
            maxSize: maxSize,
            mediaType: mediaType,
          }
        )
      );
    }

    console.log(`📤 Uploading ${mediaType} for X user: ${username}`);
    console.log(`📄 File: ${req.file.originalname} (${req.file.size} bytes)`);

    // Upload media to X
    let mediaInfo;
    try {
      mediaInfo = await xService.uploadMedia(
        accessToken,
        req.file.buffer,
        mediaType,
        altText
      );
      console.log(`✅ X media uploaded successfully: ${mediaInfo.media_id}`);
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
      throw uploadError; // Re-throw other errors
    }

    res.json(
      createSuccessResponse(
        {
          media_id: mediaInfo.media_id,
          media_id_string: mediaInfo.media_id_string,
          mediaType: mediaType,
          altText: altText,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          uploadedAt: new Date().toISOString(),
          expires_after_secs: mediaInfo.expires_after_secs,
        },
        "X media uploaded successfully",
        {
          platform: "X",
          mediaType: mediaType,
          author: username,
        }
      )
    );
  } catch (error) {
    console.error("Error uploading X media:", error);

    res.status(500).json(
      createErrorResponse("Failed to upload X media", {
        error: error.message,
        timestamp: new Date().toISOString(),
      })
    );
  }
}

/**
 * Creates a tweet on X
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {void}
 */
async function createXTweet(req, res) {
  try {
    const { accessToken, name, xId, username, provider } = req.user;

    if (provider !== "x") {
      return res.status(400).json(
        createErrorResponse("Invalid token provider", {
          expected: "x",
          received: provider,
        })
      );
    }

    const {
      text,
      media_ids,
      tagged_user_ids,
      reply,
      poll,
      reply_settings,
      geo,
      for_super_followers_only,
    } = req.body;

    // Validate required fields
    if (!text || text.trim().length === 0) {
      return res.status(400).json(
        createErrorResponse("Tweet text is required", {
          field: "text",
        })
      );
    }

    if (text.length > 280) {
      return res.status(400).json(
        createErrorResponse("Tweet text exceeds 280 character limit", {
          field: "text",
          length: text.length,
          maxLength: 280,
        })
      );
    }

    console.log(`📝 Creating X tweet for user: ${name} (@${username})`);
    console.log(
      `📄 Tweet text: "${text.substring(0, 50)}${
        text.length > 50 ? "..." : ""
      }"`
    );

    // Prepare tweet data according to X API v2 specification
    const tweetData = {
      text: text.trim(),
    };

    // Add optional fields
    if (reply) {
      tweetData.reply = reply;
    }

    if (poll) {
      tweetData.poll = poll;
    }

    if (reply_settings) {
      tweetData.reply_settings = reply_settings;
    }

    if (geo) {
      tweetData.geo = geo;
    }

    if (for_super_followers_only !== undefined) {
      tweetData.for_super_followers_only = for_super_followers_only;
    }

    // Handle media according to X API v2 specification
    if (media_ids && media_ids.length > 0) {
      // Validate media_ids format (must be numeric strings)
      const validMediaIds = media_ids.filter(
        (id) => typeof id === "string" && /^[0-9]{1,19}$/.test(id)
      );

      if (validMediaIds.length > 0) {
        tweetData.media = {
          media_ids: validMediaIds,
          ...(tagged_user_ids &&
            tagged_user_ids.length > 0 && {
              tagged_user_ids: tagged_user_ids,
            }),
        };
        console.log(`📎 Including ${validMediaIds.length} media attachment(s)`);
      } else {
        console.warn("⚠️ Invalid media_ids provided, creating text-only tweet");
      }
    }

    // Create tweet
    const createdTweet = await xService.createTweet(accessToken, tweetData);

    console.log(`✅ X tweet created successfully: ${createdTweet.id}`);

    res.json(
      createSuccessResponse(
        {
          id: createdTweet.id,
          text: createdTweet.text,
          author: {
            id: xId,
            name: name,
            username: username,
          },
          platform: "X",
          createdAt: new Date().toISOString(),
        },
        "Tweet created successfully",
        {
          author: name,
          platform: "X",
          textLength: text.length,
          hasMedia: media_ids && media_ids.length > 0,
        }
      )
    );
  } catch (error) {
    console.error("Error creating X tweet:", error);

    // Handle specific X API errors
    if (
      error.message.includes("Insufficient privileges") ||
      error.message.includes("Forbidden")
    ) {
      return res
        .status(403)
        .json(
          createErrorResponse(
            "Insufficient permissions to create tweets. Please re-authenticate with posting permissions.",
            { error: error.message, action: "reauth_required" }
          )
        );
    }

    if (
      error.message.includes("expired") ||
      error.message.includes("Invalid or expired token")
    ) {
      return res.status(401).json(
        createErrorResponse("Access token expired. Please re-authenticate.", {
          error: error.message,
          action: "reauth_required",
        })
      );
    }

    if (error.message.includes("character limit")) {
      return res.status(400).json(
        createErrorResponse("Tweet text exceeds character limit", {
          error: error.message,
          maxLength: 280,
        })
      );
    }

    res.status(500).json(
      createErrorResponse("Failed to create tweet", {
        error: error.message,
        timestamp: new Date().toISOString(),
      })
    );
  }
}

module.exports = {
  // LinkedIn Auth
  initiateLinkedInAuth,
  handleLinkedInCallback,
  getCurrentUser,
  refreshUserProfile,
  getDetailedProfile,
  createLinkedInPost,
  uploadLinkedInMedia,

  // X (Twitter) Auth
  initiateXAuth,
  handleXCallback,
  getCurrentXUser,
  refreshXUserProfile,
  createXTweet,
  uploadXMedia,

  // Common
  logout,
};
