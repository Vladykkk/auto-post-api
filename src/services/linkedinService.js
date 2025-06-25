/**
 * LinkedIn API service
 * @module services/linkedinService
 */

const axios = require("axios");
const config = require("../config/environment");

/**
 * LinkedIn API endpoints
 */
const ENDPOINTS = {
  TOKEN: "https://www.linkedin.com/oauth/v2/accessToken",
  USERINFO: "https://api.linkedin.com/v2/userinfo",
  POSTS: "https://api.linkedin.com/v2/ugcPosts",
  ASSETS: "https://api.linkedin.com/v2/assets",
};

/**
 * Generates LinkedIn OAuth authorization URL
 * @param {string} state - Random state parameter for security
 * @returns {string} Authorization URL
 */
function generateAuthUrl(state) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.linkedin.clientId,
    redirect_uri: config.linkedin.redirectUri,
    state,
    scope: config.linkedin.scope,
  });

  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

/**
 * Exchanges authorization code for access token
 * @param {string} code - Authorization code from LinkedIn
 * @returns {Promise<Object>} Token response data
 * @throws {Error} If token exchange fails
 */
async function exchangeCodeForToken(code) {
  try {
    const response = await axios.post(ENDPOINTS.TOKEN, null, {
      params: {
        grant_type: "authorization_code",
        code,
        redirect_uri: config.linkedin.redirectUri,
        client_id: config.linkedin.clientId,
        client_secret: config.linkedin.clientSecret,
      },
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    return response.data;
  } catch (error) {
    throw new Error(
      `Token exchange failed: ${
        error.response?.data?.error_description || error.message
      }`
    );
  }
}

/**
 * Fetches user profile from LinkedIn using OpenID Connect
 * @param {string} accessToken - LinkedIn access token
 * @returns {Promise<Object>} User profile data
 * @throws {Error} If profile fetch fails
 */
async function getUserProfile(accessToken) {
  try {
    const response = await axios.get(ENDPOINTS.USERINFO, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const userInfo = response.data;

    return {
      id: userInfo.sub,
      name: userInfo.name,
      firstName: userInfo.given_name,
      lastName: userInfo.family_name,
      email: userInfo.email,
      profilePicture: userInfo.picture,
      locale: userInfo.locale,
      emailVerified: userInfo.email_verified,
    };
  } catch (error) {
    throw new Error(
      `Profile fetch failed: ${error.response?.data?.message || error.message}`
    );
  }
}

/**
 * Creates a LinkedIn post with optional media using OpenID Connect user info
 * @param {string} accessToken - LinkedIn access token
 * @param {Object} postData - Post content and settings
 * @param {string} postData.text - Post text content
 * @param {string} [postData.visibility] - Post visibility (PUBLIC, CONNECTIONS, LOGGED_IN_MEMBERS)
 * @param {string} [postData.mediaType] - Media type (NONE, IMAGE, VIDEO, ARTICLE)
 * @param {Array} [postData.media] - Media items array
 * @param {string} [postData.articleUrl] - URL for article sharing
 * @param {string} [postData.articleTitle] - Title for article sharing
 * @param {string} [postData.articleDescription] - Description for article sharing
 * @returns {Promise<Object>} Post creation response
 * @throws {Error} If post creation fails
 */
async function createPost(accessToken, postData) {
  try {
    // Get the user's LinkedIn person ID from OpenID Connect userinfo
    const userInfoResponse = await axios.get(ENDPOINTS.USERINFO, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    // The 'sub' field contains the person identifier
    const personId = userInfoResponse.data.sub;

    // Format the author URN correctly for UGC Posts API
    let authorUrn;
    if (personId.startsWith("urn:li:person:")) {
      // Already in URN format
      authorUrn = personId;
    } else {
      // Convert to URN format
      authorUrn = `urn:li:person:${personId}`;
    }

    // Determine media type and prepare share content
    const mediaType = postData.mediaType || "NONE";

    const shareContent = {
      shareCommentary: {
        text: postData.text,
      },
      shareMediaCategory: mediaType,
    };

    // Add media content based on type
    if (mediaType === "ARTICLE" && postData.articleUrl) {
      shareContent.media = [
        {
          status: "READY",
          originalUrl: postData.articleUrl,
          ...(postData.articleTitle && {
            title: {
              text: postData.articleTitle,
            },
          }),
          ...(postData.articleDescription && {
            description: {
              text: postData.articleDescription,
            },
          }),
        },
      ];
    } else if (
      (mediaType === "IMAGE" || mediaType === "VIDEO") &&
      postData.media &&
      postData.media.length > 0
    ) {
      shareContent.media = postData.media.map((mediaItem) => ({
        status: "READY",
        media: mediaItem.assetUrn,
        ...(mediaItem.title && {
          title: {
            text: mediaItem.title,
          },
        }),
        ...(mediaItem.description && {
          description: {
            text: mediaItem.description,
          },
        }),
      }));
    } else if (mediaType !== "NONE" && mediaType !== "ARTICLE") {
      // If mediaType is IMAGE/VIDEO but no media provided, fall back to NONE
      console.warn(
        `⚠️ MediaType ${mediaType} specified but no media provided, falling back to NONE`
      );
      shareContent.shareMediaCategory = "NONE";
    }

    // Prepare the post payload according to LinkedIn API documentation
    const postPayload = {
      author: authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": shareContent,
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility":
          postData.visibility || "PUBLIC",
      },
    };

    // Create the post
    const response = await axios.post(ENDPOINTS.POSTS, postPayload, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
    });

    return {
      success: true,
      postId: response.headers["x-restli-id"] || response.data.id,
      postUrl: `https://www.linkedin.com/feed/update/${
        response.headers["x-restli-id"] || response.data.id
      }`,
      message: "Post created successfully",
    };
  } catch (error) {
    console.error("LinkedIn post creation error:", error);

    throw new Error(
      `Post creation failed: ${
        error.response?.data?.message ||
        error.response?.data?.error_description ||
        error.response?.data?.error ||
        error.message
      }`
    );
  }
}

/**
 * Registers an asset for upload (image or video)
 * @param {string} accessToken - LinkedIn access token
 * @param {string} personUrn - Person URN
 * @param {string} mediaType - Media type ('image' or 'video')
 * @returns {Promise<Object>} Asset registration response
 * @throws {Error} If asset registration fails
 */
async function registerAsset(accessToken, personUrn, mediaType) {
  try {
    const recipe =
      mediaType === "video"
        ? "urn:li:digitalmediaRecipe:feedshare-video"
        : "urn:li:digitalmediaRecipe:feedshare-image";

    const payload = {
      registerUploadRequest: {
        recipes: [recipe],
        owner: personUrn,
        serviceRelationships: [
          {
            relationshipType: "OWNER",
            identifier: "urn:li:userGeneratedContent",
          },
        ],
      },
    };

    const response = await axios.post(
      `${ENDPOINTS.ASSETS}?action=registerUpload`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
      }
    );

    return response.data.value;
  } catch (error) {
    throw new Error(
      `Asset registration failed: ${
        error.response?.data?.message ||
        error.response?.data?.error_description ||
        error.message
      }`
    );
  }
}

/**
 * Uploads media file to LinkedIn
 * @param {string} uploadUrl - Upload URL from asset registration
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} accessToken - LinkedIn access token
 * @returns {Promise<void>}
 * @throws {Error} If upload fails
 */
async function uploadMediaFile(uploadUrl, fileBuffer, accessToken) {
  try {
    await axios.put(uploadUrl, fileBuffer, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/octet-stream",
      },
    });
  } catch (error) {
    throw new Error(
      `Media upload failed: ${error.response?.data?.message || error.message}`
    );
  }
}

/**
 * Uploads media and returns asset URN
 * @param {string} accessToken - LinkedIn access token
 * @param {string} personUrn - Person URN
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} mediaType - Media type ('image' or 'video')
 * @param {string} [title] - Media title
 * @param {string} [description] - Media description
 * @returns {Promise<Object>} Media asset info
 * @throws {Error} If upload process fails
 */
async function uploadMedia(
  accessToken,
  personUrn,
  fileBuffer,
  mediaType,
  title,
  description
) {
  try {
    // Step 1: Register the asset
    const assetInfo = await registerAsset(accessToken, personUrn, mediaType);

    // Step 2: Upload the file
    const uploadUrl =
      assetInfo.uploadMechanism[
        "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
      ].uploadUrl;
    await uploadMediaFile(uploadUrl, fileBuffer, accessToken);

    // Step 3: Return asset info
    return {
      assetUrn: assetInfo.asset,
      title,
      description,
    };
  } catch (error) {
    throw new Error(`Media upload process failed: ${error.message}`);
  }
}

/**
 * Generates random state for OAuth security
 * @returns {string} Random state string
 */
function generateState() {
  return (
    Math.random().toString(36).substring(2, 15) +
    Math.random().toString(36).substring(2, 15)
  );
}

module.exports = {
  generateAuthUrl,
  exchangeCodeForToken,
  getUserProfile,
  createPost,
  uploadMedia,
  registerAsset,
  uploadMediaFile,
  generateState,
};
