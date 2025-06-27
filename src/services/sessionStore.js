/**
 * Persistent session store for Substack browser sessions
 * @module services/sessionStore
 */

const fs = require("fs").promises;
const path = require("path");

class SessionStore {
  constructor(storePath = "./sessions") {
    this.storePath = storePath;
    this.sessionsFile = path.join(storePath, "sessions.json");
    this.init();
  }

  /**
   * Initialize the session store
   */
  async init() {
    try {
      // Create sessions directory if it doesn't exist
      await fs.mkdir(this.storePath, { recursive: true });

      // Create sessions file if it doesn't exist
      try {
        await fs.access(this.sessionsFile);
      } catch (error) {
        await fs.writeFile(this.sessionsFile, JSON.stringify({}));
      }
    } catch (error) {
      console.error("Error initializing session store:", error);
    }
  }

  /**
   * Load all sessions from disk
   * @returns {Promise<Object>} Sessions object
   */
  async loadSessions() {
    try {
      const data = await fs.readFile(this.sessionsFile, "utf8");
      return JSON.parse(data);
    } catch (error) {
      console.error("Error loading sessions:", error);
      return {};
    }
  }

  /**
   * Save all sessions to disk
   * @param {Object} sessions - Sessions object to save
   */
  async saveSessions(sessions) {
    try {
      await fs.writeFile(this.sessionsFile, JSON.stringify(sessions, null, 2));
    } catch (error) {
      console.error("Error saving sessions:", error);
    }
  }

  /**
   * Save a single session
   * @param {string} sessionId - Session ID
   * @param {Object} sessionData - Session data to save
   */
  async saveSession(sessionId, sessionData) {
    const sessions = await this.loadSessions();

    // Store session metadata (not the WebDriver instance)
    sessions[sessionId] = {
      id: sessionId,
      status: sessionData.status,
      email: sessionData.email || null,
      createdAt: sessionData.createdAt,
      lastActiveAt: new Date().toISOString(),
      userData: sessionData.userData || null,
      authTokens: sessionData.authTokens || null,
      // Don't store the WebDriver instance - it can't be serialized
    };

    await this.saveSessions(sessions);
  }

  /**
   * Get a session by ID
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object|null>} Session data or null if not found
   */
  async getSession(sessionId) {
    const sessions = await this.loadSessions();
    return sessions[sessionId] || null;
  }

  /**
   * Get all sessions
   * @returns {Promise<Object>} All sessions
   */
  async getAllSessions() {
    return await this.loadSessions();
  }

  /**
   * Delete a session
   * @param {string} sessionId - Session ID
   */
  async deleteSession(sessionId) {
    const sessions = await this.loadSessions();
    delete sessions[sessionId];
    await this.saveSessions(sessions);
  }

  /**
   * Clean up expired sessions
   * @param {number} maxAgeMs - Maximum age in milliseconds (default: 7 days)
   */
  async cleanupExpiredSessions(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    const sessions = await this.loadSessions();
    const now = Date.now();
    let cleanedCount = 0;

    for (const [sessionId, session] of Object.entries(sessions)) {
      const sessionAge = now - new Date(session.createdAt).getTime();
      if (sessionAge > maxAgeMs) {
        delete sessions[sessionId];
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      await this.saveSessions(sessions);
      console.log(`🧹 Cleaned up ${cleanedCount} expired sessions`);
    }

    return cleanedCount;
  }

  /**
   * Update session last active time
   * @param {string} sessionId - Session ID
   */
  async updateLastActive(sessionId) {
    const sessions = await this.loadSessions();
    if (sessions[sessionId]) {
      sessions[sessionId].lastActiveAt = new Date().toISOString();
      await this.saveSessions(sessions);
    }
  }

  /**
   * Check if a session exists and is not expired
   * @param {string} sessionId - Session ID
   * @param {number} maxAgeMs - Maximum age in milliseconds (default: 7 days)
   * @returns {Promise<boolean>} True if session exists and is valid
   */
  async isSessionValid(sessionId, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    const session = await this.getSession(sessionId);
    if (!session) return false;

    const sessionAge = Date.now() - new Date(session.createdAt).getTime();
    return sessionAge <= maxAgeMs;
  }
}

module.exports = SessionStore;
