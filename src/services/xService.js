/**
 * X (Twitter) service for OAuth2 authentication and API interactions
 * @module services/xService
 */

const axios = require("axios");
const crypto = require("crypto");
const config = require("../config/environment");

/**
 * X API endpoints
 */
const X_ENDPOINTS = {
  OAUTH_AUTHORIZE: "https://twitter.com/i/oauth2/authorize",
  OAUTH_TOKEN: "https://api.twitter.com/2/oauth2/token",
  OAUTH_REVOKE: "https://api.twitter.com/2/oauth2/revoke",
  USER_ME: "https://api.twitter.com/2/users/me",
  TWEETS: "https://api.twitter.com/2/tweets",
  MEDIA_UPLOAD: "https://api.twitter.com/2/media/upload", // Correct v2 endpoint
};

/**
 * Generates a cryptographically secure random state parameter
 * @returns {string} Random state string
 */
function generateState() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Generates code verifier and challenge for PKCE
 * @returns {Object} Object containing codeVerifier and codeChallenge
 */
function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  return {
    codeVerifier,
    codeChallenge,
  };
}

/**
 * Generates X OAuth2 authorization URL with PKCE
 * @param {string} state - State parameter for CSRF protection
 * @param {string} codeChallenge - PKCE code challenge
 * @returns {string} Authorization URL
 */
function generateAuthUrl(state, codeChallenge) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.x.clientId,
    redirect_uri: config.x.redirectUri,
    scope: config.x.scope,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `${X_ENDPOINTS.OAUTH_AUTHORIZE}?${params.toString()}`;
}

/**
 * Exchanges authorization code for access token using PKCE
 * @param {string} code - Authorization code from callback
 * @param {string} codeVerifier - PKCE code verifier
 * @returns {Promise<Object>} Token response with access_token, refresh_token, etc.
 */
async function exchangeCodeForToken(code, codeVerifier) {
  const tokenData = {
    grant_type: "authorization_code",
    client_id: config.x.clientId,
    code,
    redirect_uri: config.x.redirectUri,
    code_verifier: codeVerifier,
  };

  try {
    const response = await axios.post(X_ENDPOINTS.OAUTH_TOKEN, tokenData, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${config.x.clientId}:${config.x.clientSecret}`
        ).toString("base64")}`,
      },
    });

    return response.data;
  } catch (error) {
    throw new Error(
      `X token exchange failed: ${
        error.response?.data?.error_description || error.message
      }`
    );
  }
}

/**
 * Gets user profile from X API
 * @param {string} accessToken - X access token
 * @returns {Promise<Object>} User profile data
 */
async function getUserProfile(accessToken) {
  try {
    const response = await axios.get(X_ENDPOINTS.USER_ME, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      params: {
        "user.fields":
          "id,name,username,profile_image_url,verified,created_at,description,public_metrics",
      },
    });

    const userData = response.data.data;

    return {
      id: userData.id,
      name: userData.name,
      username: userData.username,
      email: null, // X API v2 doesn't provide email in user.fields
      profileImageUrl: userData.profile_image_url,
      verified: userData.verified,
      description: userData.description,
      createdAt: userData.created_at,
      publicMetrics: userData.public_metrics,
    };
  } catch (error) {
    throw new Error(
      `Failed to fetch X user profile: ${
        error.response?.data?.error || error.message
      }`
    );
  }
}

/**
 * Creates a tweet on X according to official API specification
 * @param {string} accessToken - X access token
 * @param {Object} tweetData - Tweet content and options (following X API v2 spec)
 * @param {string} tweetData.text - Tweet text (required)
 * @param {Object} [tweetData.media] - Media object with media_ids and tagged_user_ids
 * @param {Array} [tweetData.media.media_ids] - Array of media IDs for attachments
 * @param {Array} [tweetData.media.tagged_user_ids] - Array of user IDs to tag in media
 * @param {Object} [tweetData.reply] - Reply settings
 * @param {string} [tweetData.reply.in_reply_to_tweet_id] - Tweet ID to reply to
 * @param {Array} [tweetData.reply.exclude_reply_user_ids] - User IDs to exclude from reply
 * @param {Object} [tweetData.poll] - Poll settings
 * @param {Array} [tweetData.poll.options] - Poll options array
 * @param {number} [tweetData.poll.duration_minutes] - Poll duration in minutes
 * @param {string} [tweetData.reply_settings] - Who can reply: "following", "mentionedUsers", or null
 * @param {Object} [tweetData.geo] - Geographic data
 * @param {string} [tweetData.geo.place_id] - Place ID for location
 * @param {boolean} [tweetData.for_super_followers_only] - Super followers only flag
 * @returns {Promise<Object>} Created tweet data
 */
async function createTweet(accessToken, tweetData) {
  try {
    // Validate required fields
    if (!tweetData.text || tweetData.text.trim().length === 0) {
      throw new Error("Tweet text is required");
    }

    if (tweetData.text.length > 280) {
      throw new Error("Tweet text exceeds 280 character limit");
    }

    // Prepare request payload according to X API v2 specification
    const payload = {
      text: tweetData.text.trim(),
    };

    // Add optional fields if provided
    if (
      tweetData.media &&
      tweetData.media.media_ids &&
      tweetData.media.media_ids.length > 0
    ) {
      payload.media = {
        media_ids: tweetData.media.media_ids,
        ...(tweetData.media.tagged_user_ids && {
          tagged_user_ids: tweetData.media.tagged_user_ids,
        }),
      };
    }

    if (tweetData.reply) {
      payload.reply = tweetData.reply;
    }

    if (tweetData.poll) {
      payload.poll = tweetData.poll;
    }

    if (tweetData.reply_settings) {
      payload.reply_settings = tweetData.reply_settings;
    }

    if (tweetData.geo) {
      payload.geo = tweetData.geo;
    }

    if (tweetData.for_super_followers_only !== undefined) {
      payload.for_super_followers_only = tweetData.for_super_followers_only;
    }

    const response = await axios.post(X_ENDPOINTS.TWEETS, payload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    return response.data.data;
  } catch (error) {
    throw new Error(
      `Failed to create X tweet: ${
        error.response?.data?.detail ||
        error.response?.data?.errors?.[0]?.detail ||
        error.response?.data?.error ||
        error.message
      }`
    );
  }
}

/**
 * Refreshes an access token using refresh token
 * @param {string} refreshToken - X refresh token
 * @returns {Promise<Object>} New token response
 */
async function refreshAccessToken(refreshToken) {
  const tokenData = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  };

  try {
    const response = await axios.post(X_ENDPOINTS.OAUTH_TOKEN, tokenData, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${config.x.clientId}:${config.x.clientSecret}`
        ).toString("base64")}`,
      },
    });

    return response.data;
  } catch (error) {
    throw new Error(
      `X token refresh failed: ${
        error.response?.data?.error_description || error.message
      }`
    );
  }
}

/**
 * Uploads media to X using the v2 API endpoint
 * @param {string} accessToken - X access token
 * @param {Buffer} mediaBuffer - Media file buffer
 * @param {string} mediaType - Media type ('image' or 'video')
 * @param {string} [altText] - Alt text for accessibility
 * @returns {Promise<Object>} Media upload response with media_id
 */
async function uploadMedia(accessToken, mediaBuffer, mediaType, altText) {
  try {
    // Validate media type
    const allowedTypes = ["image", "video"];
    if (!allowedTypes.includes(mediaType)) {
      throw new Error(
        `Invalid media type: ${mediaType}. Allowed: ${allowedTypes.join(", ")}`
      );
    }

    // Determine MIME type based on media type
    const mimeType = mediaType === "image" ? "image/png" : "video/mp4";
    const category = mediaType === "image" ? "tweet_image" : "tweet_video";

    // Prepare form data according to X API v2 specification
    const FormData = require("form-data");
    const form = new FormData();

    // Add required fields according to the documentation
    form.append("media", mediaBuffer, {
      filename: `media.${mediaType === "image" ? "png" : "mp4"}`,
      contentType: mimeType,
    });

    form.append("media_type", mimeType);
    form.append("media_category", category);

    // Add optional fields
    if (altText) {
      form.append("alt_text", altText);
    }

    const response = await axios.post(X_ENDPOINTS.MEDIA_UPLOAD, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 60000, // 60 second timeout for media uploads
    });

    // Extract media ID from v2 API response
    const mediaId = response.data.data?.id || response.data.media_id_string;

    if (!mediaId) {
      throw new Error("No media ID returned from X API");
    }

    return {
      media_id: mediaId,
      media_id_string: mediaId,
      media_key: response.data.data?.media_key,
      size: response.data.data?.size,
      expires_after_secs: response.data.data?.expires_after_secs,
      processing_info: response.data.data?.processing_info,
    };
  } catch (error) {
    // Handle specific X API v2 error format
    const errorMessage =
      error.response?.data?.errors?.[0]?.detail ||
      error.response?.data?.detail ||
      error.response?.data?.error ||
      error.message;

    throw new Error(`Failed to upload X media: ${errorMessage}`);
  }
}

/**
 * Revokes an X access token
 * @param {string} accessToken - X access token to revoke
 * @returns {Promise<void>}
 */
async function revokeAccessToken(accessToken) {
  try {
    await axios.post(
      X_ENDPOINTS.OAUTH_REVOKE,
      { token: accessToken },
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(
            `${config.x.clientId}:${config.x.clientSecret}`
          ).toString("base64")}`,
        },
      }
    );
  } catch (error) {
    throw new Error(
      `Failed to revoke X access token: ${
        error.response?.data?.error || error.message
      }`
    );
  }
}

module.exports = {
  generateState,
  generatePKCE,
  generateAuthUrl,
  exchangeCodeForToken,
  getUserProfile,
  createTweet,
  uploadMedia,
  refreshAccessToken,
  revokeAccessToken,
  X_ENDPOINTS,
};
