/**
 * Substack service for automated login using Selenium
 * @module services/substackService
 */

const { Builder, By, until, Key } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const jwt = require("jsonwebtoken");
const config = require("../config/environment");
const SessionStore = require("./sessionStore");

// Store active sessions (in-memory for WebDriver instances)
const activeSessions = new Map();

// Persistent session store
const sessionStore = new SessionStore();

/**
 * Creates a new browser session for Substack login
 * @returns {Promise<Object>} Session object with browser instance and sessionId
 */
async function createSession() {
  try {
    // Configure Chrome options
    const options = new chrome.Options();

    // Enable headless mode (set SUBSTACK_HEADLESS=false for debugging)
    const isHeadless = process.env.SUBSTACK_HEADLESS !== "false";
    if (isHeadless) {
      options.addArguments("--headless");
    }

    options.addArguments("--no-sandbox");
    options.addArguments("--disable-dev-shm-usage");
    options.addArguments("--disable-gpu");
    options.addArguments("--window-size=1920,1080");
    options.addArguments("--disable-web-security");
    options.addArguments("--disable-features=VizDisplayCompositor");

    // Create WebDriver instance
    const driver = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(options)
      .build();

    const sessionId = generateSessionId();

    const session = {
      id: sessionId,
      driver,
      createdAt: new Date(),
      status: "created",
    };

    activeSessions.set(sessionId, session);

    // Save to persistent storage
    await sessionStore.saveSession(sessionId, session);

    console.log(`🚀 Created new Substack session: ${sessionId}`);
    return { sessionId, success: true };
  } catch (error) {
    console.error("Error creating Substack session:", error);
    throw new Error(`Failed to create browser session: ${error.message}`);
  }
}

/**
 * Initiates Substack login with email
 * @param {string} sessionId - Browser session ID
 * @param {string} email - User's email address
 * @returns {Promise<Object>} Login initiation result
 */
async function initiateLogin(sessionId, email) {
  try {
    let session = activeSessions.get(sessionId);

    // If session not active but exists in persistent storage, try to reconnect
    if (!session) {
      const persistentSession = await sessionStore.getSession(sessionId);
      if (persistentSession) {
        if (persistentSession.status === "logged_in") {
          console.log(
            `🔄 Session ${sessionId} not active, attempting reconnection...`
          );
          await reconnectSession(sessionId);
          session = activeSessions.get(sessionId);
        } else {
          console.log(
            `🔄 Session ${sessionId} found with status ${persistentSession.status}, recreating WebDriver...`
          );
          await recreateWebDriverSession(sessionId);
          session = activeSessions.get(sessionId);
        }
      }
    }

    if (!session) {
      throw new Error("Session not found and could not be reconnected");
    }

    const { driver } = session;

    console.log(`📧 Initiating Substack login for email: ${email}`);

    // Navigate to Substack login page
    await driver.get("https://substack.com/sign-in");

    // Wait for page to load and try different title patterns
    try {
      await driver.wait(until.titleContains("Sign in"), 10000);
    } catch (error) {
      // Try alternative title patterns or just wait for the page to be ready
      try {
        await driver.wait(until.titleContains("Substack"), 5000);
      } catch (titleError) {
        console.log(
          "Page title doesn't match expected patterns, continuing..."
        );
      }
    }

    // Wait for page to be ready
    await driver.sleep(2000);

    // Find and fill email input
    let emailInput;
    try {
      emailInput = await driver.wait(
        until.elementLocated(
          By.css('input[type="email"], input[name="email"]')
        ),
        10000
      );
    } catch (error) {
      console.log(
        "Could not find email input with standard selectors, trying alternatives..."
      );
      // Try alternative selectors
      try {
        emailInput = await driver.wait(
          until.elementLocated(
            By.css('input[placeholder*="email" i], input[placeholder*="Email"]')
          ),
          5000
        );
      } catch (altError) {
        // Last resort: find any input that might be for email
        emailInput = await driver.wait(
          until.elementLocated(By.css('input[type="text"], input')),
          5000
        );
      }
    }

    await emailInput.clear();
    await emailInput.sendKeys(email);

    // Find and click continue/sign in button
    let continueButton;
    try {
      // Try different strategies to find the button
      continueButton = await driver.wait(
        until.elementLocated(
          By.xpath(
            '//button[@type="submit" or contains(text(), "Continue") or contains(text(), "Sign in") or contains(text(), "Sign In")]'
          )
        ),
        10000
      );
    } catch (error) {
      // Fallback: try to find any button that might be the submit button
      try {
        continueButton = await driver.wait(
          until.elementLocated(By.css('button[type="submit"]')),
          5000
        );
      } catch (fallbackError) {
        // Last resort: find any button
        continueButton = await driver.wait(
          until.elementLocated(By.css("button")),
          5000
        );
      }
    }

    await continueButton.click();

    // Wait a bit for the page to process
    await driver.sleep(3000);

    // Check current state - either verification input appeared or we're logged in
    const currentUrl = await driver.getCurrentUrl();
    console.log(`Current URL after submit: ${currentUrl}`);

    // Check if already logged in (no verification needed)
    if (
      currentUrl.includes("substack.com") &&
      !currentUrl.includes("sign-in")
    ) {
      session.status = "logged_in";
      const userData = await getUserData(driver);
      return {
        success: true,
        status: "logged_in",
        userData,
        message: "Already logged in - no verification needed",
      };
    }

    // Try to find verification input (but don't wait too long)
    let hasVerificationInput = false;
    try {
      await driver.wait(
        until.elementLocated(
          By.css(
            'input[type="text"], input[name="code"], input[placeholder*="code"], input[placeholder*="Code"], input[placeholder*="verification"]'
          )
        ),
        5000 // Reduced timeout
      );
      hasVerificationInput = true;
    } catch (error) {
      console.log(
        "Verification input not immediately visible, but email was submitted"
      );
    }

    // Set session status regardless of whether we found the input
    session.status = "awaiting_verification";
    session.email = email;

    // Save updated session state
    await sessionStore.saveSession(sessionId, session);

    console.log(
      `✅ Email submitted successfully. Awaiting verification code for: ${email}`
    );

    return {
      success: true,
      status: "awaiting_verification",
      hasVerificationInput,
      currentUrl,
      message:
        "Email submitted successfully. Please check your email for the 6-digit verification code.",
    };
  } catch (error) {
    console.error("Error during Substack login initiation:", error);
    throw new Error(`Login initiation failed: ${error.message}`);
  }
}

/**
 * Submits verification code and completes login
 * @param {string} sessionId - Browser session ID
 * @param {string} verificationCode - 6-digit verification code
 * @returns {Promise<Object>} Login completion result with user data
 */
async function submitVerificationCode(sessionId, verificationCode) {
  try {
    let session = activeSessions.get(sessionId);

    // If session not active but exists in persistent storage, try to reconnect
    if (!session) {
      const persistentSession = await sessionStore.getSession(sessionId);
      if (persistentSession) {
        if (persistentSession.status === "logged_in") {
          console.log(
            `🔄 Session ${sessionId} not active, attempting reconnection...`
          );
          await reconnectSession(sessionId);
          session = activeSessions.get(sessionId);
        } else {
          console.log(
            `🔄 Session ${sessionId} found with status ${persistentSession.status}, recreating WebDriver...`
          );
          await recreateWebDriverSession(sessionId);
          session = activeSessions.get(sessionId);
        }
      }
    }

    if (!session) {
      throw new Error("Session not found and could not be reconnected");
    }

    if (session.status !== "awaiting_verification") {
      throw new Error(`Invalid session status: ${session.status}`);
    }

    const { driver } = session;

    console.log(`🔢 Submitting verification code for session: ${sessionId}`);

    // Get current page state for debugging
    const currentUrl = await driver.getCurrentUrl();
    console.log(`Current URL: ${currentUrl}`);

    // Take a screenshot for debugging (optional)
    try {
      const screenshot = await driver.takeScreenshot();
      console.log("Screenshot taken for debugging");
    } catch (screenshotError) {
      console.log("Could not take screenshot:", screenshotError.message);
    }

    // Find all inputs for debugging
    const allInputs = await driver.findElements(By.css("input"));
    console.log(`Found ${allInputs.length} input elements on page`);

    for (let i = 0; i < allInputs.length; i++) {
      try {
        const type = await allInputs[i].getAttribute("type");
        const name = await allInputs[i].getAttribute("name");
        const placeholder = await allInputs[i].getAttribute("placeholder");
        const id = await allInputs[i].getAttribute("id");
        console.log(
          `Input ${i}: type="${type}", name="${name}", placeholder="${placeholder}", id="${id}"`
        );
      } catch (attrError) {
        console.log(`Could not get attributes for input ${i}`);
      }
    }

    // Find verification code input with multiple strategies
    let codeInput;
    const selectors = [
      // Common verification input patterns
      'input[type="text"][placeholder*="code"]',
      'input[type="text"][placeholder*="Code"]',
      'input[type="text"][placeholder*="verification"]',
      'input[type="text"][placeholder*="Verification"]',
      'input[name="code"]',
      'input[name="verificationCode"]',
      'input[name="verification_code"]',
      'input[id*="code"]',
      'input[id*="verification"]',
      // Generic text inputs (as fallback)
      'input[type="text"]',
      'input[type="number"]',
    ];

    for (const selector of selectors) {
      try {
        console.log(`Trying selector: ${selector}`);
        const inputs = await driver.findElements(By.css(selector));

        if (inputs.length > 0) {
          console.log(
            `Found ${inputs.length} elements with selector: ${selector}`
          );

          // For generic selectors, try to find the most likely verification input
          if (
            selector.includes('input[type="text"]') ||
            selector.includes('input[type="number"]')
          ) {
            for (const input of inputs) {
              try {
                const placeholder =
                  (await input.getAttribute("placeholder")) || "";
                const name = (await input.getAttribute("name")) || "";
                const id = (await input.getAttribute("id")) || "";

                // Check if this looks like a verification input
                const isVerificationInput = [placeholder, name, id].some(
                  (attr) =>
                    attr.toLowerCase().includes("code") ||
                    attr.toLowerCase().includes("verification") ||
                    attr.toLowerCase().includes("verify")
                );

                if (isVerificationInput || inputs.length === 1) {
                  codeInput = input;
                  console.log(
                    `Selected verification input with placeholder: "${placeholder}", name: "${name}", id: "${id}"`
                  );
                  break;
                }
              } catch (attrError) {
                console.log("Could not check input attributes");
              }
            }
          } else {
            codeInput = inputs[0];
            console.log(`Using first element from selector: ${selector}`);
          }

          if (codeInput) break;
        }
      } catch (selectorError) {
        console.log(`Selector ${selector} failed: ${selectorError.message}`);
      }
    }

    if (!codeInput) {
      // Last resort: use the last text input on the page
      const textInputs = await driver.findElements(
        By.css('input[type="text"]')
      );
      if (textInputs.length > 0) {
        codeInput = textInputs[textInputs.length - 1];
        console.log(`Using last text input as fallback`);
      } else {
        throw new Error(
          "Could not find verification code input field. Page may not be ready or structure changed."
        );
      }
    }

    await codeInput.clear();
    await codeInput.sendKeys(verificationCode);

    // Find and click submit button
    let submitButton;
    try {
      submitButton = await driver.wait(
        until.elementLocated(
          By.xpath(
            '//button[@type="submit" or contains(text(), "Continue") or contains(text(), "Verify") or contains(text(), "Submit")]'
          )
        ),
        10000
      );
    } catch (error) {
      // Fallback: try to find any submit button
      try {
        submitButton = await driver.wait(
          until.elementLocated(By.css('button[type="submit"]')),
          5000
        );
      } catch (fallbackError) {
        // Last resort: find any button
        submitButton = await driver.wait(
          until.elementLocated(By.css("button")),
          5000
        );
      }
    }

    await submitButton.click();

    // Wait for successful login (redirect or dashboard)
    await driver.wait(async () => {
      const currentUrl = await driver.getCurrentUrl();
      return (
        !currentUrl.includes("sign-in") && currentUrl.includes("substack.com")
      );
    }, 15000);

    session.status = "logged_in";

    // Get user data
    const userData = await getUserData(driver);
    session.userData = userData;

    // Create JWT auth token
    const substackAuthToken = createSubstackAuthToken(userData);

    // Save updated session state
    await sessionStore.saveSession(sessionId, session);

    console.log(
      `✅ Successfully logged in to Substack: ${
        userData.email || "email not found"
      }`
    );

    return {
      success: true,
      status: "logged_in",
      userData,
      substackAuthToken,
      message: "Successfully logged in to Substack",
    };
  } catch (error) {
    console.error("Error submitting verification code:", error);
    throw new Error(`Verification failed: ${error.message}`);
  }
}

/**
 * Extracts authentication cookies and tokens from browser session
 * @param {WebDriver} driver - Selenium WebDriver instance
 * @returns {Promise<Object>} Authentication data
 */
async function extractAuthTokens(driver) {
  try {
    console.log("🔐 Extracting Substack authentication tokens...");

    // Get all cookies from the current domain
    const cookies = await driver.manage().getCookies();
    console.log(`Found ${cookies.length} cookies`);

    // Extract important authentication cookies
    const authCookies = {};
    const importantCookieNames = [
      "substack_session",
      "session_id",
      "auth_token",
      "user_session",
      "_substack_session",
      "authentication_token",
    ];

    cookies.forEach((cookie) => {
      console.log(
        `Cookie: ${cookie.name} = ${cookie.value.substring(0, 50)}...`
      );

      // Store all cookies, but especially important ones
      authCookies[cookie.name] = cookie.value;

      // Flag important cookies
      if (
        importantCookieNames.some((name) =>
          cookie.name.toLowerCase().includes(name.toLowerCase())
        )
      ) {
        console.log(`🔑 Important auth cookie found: ${cookie.name}`);
      }
    });

    // Try to get any localStorage tokens
    let localStorageTokens = {};
    try {
      const localStorage = await driver.executeScript(`
        const tokens = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key.toLowerCase().includes('token') || 
              key.toLowerCase().includes('auth') ||
              key.toLowerCase().includes('session') ||
              key.toLowerCase().includes('substack')) {
            tokens[key] = localStorage.getItem(key);
          }
        }
        return tokens;
      `);
      localStorageTokens = localStorage || {};
      console.log(
        `Found ${
          Object.keys(localStorageTokens).length
        } relevant localStorage items`
      );
    } catch (lsError) {
      console.log("Could not access localStorage:", lsError.message);
    }

    return {
      cookies: authCookies,
      localStorage: localStorageTokens,
      domain: "substack.com",
      extractedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Error extracting auth tokens:", error);
    return {
      cookies: {},
      localStorage: {},
      domain: "substack.com",
      extractedAt: new Date().toISOString(),
      error: error.message,
    };
  }
}

/**
 * Extracts user data from Substack after successful login
 * @param {WebDriver} driver - Selenium WebDriver instance
 * @returns {Promise<Object>} User data object
 */
async function getUserData(driver) {
  try {
    console.log("👤 Extracting user data from Substack...");

    // Wait a bit for the page to fully load
    await driver.sleep(3000);

    const userData = {
      email: null,
      name: null,
      profileUrl: null,
      subdomain: null,
      isLoggedIn: true,
      loginTime: new Date().toISOString(),
    };

    // Navigate to profile or settings page to get better user info
    try {
      console.log("🔍 Trying to navigate to user settings/profile...");
      await driver.get("https://substack.com/profile/settings");
      await driver.sleep(3000);
    } catch (navError) {
      console.log("Could not navigate to settings, staying on current page");
    }

    try {
      // Get current URL
      userData.profileUrl = await driver.getCurrentUrl();

      // Try to extract email from various locations
      const emailSelectors = [
        'input[type="email"]',
        'input[name="email"]',
        '[data-testid="email"]',
        ".email-input",
        'input[value*="@"]',
      ];

      for (const selector of emailSelectors) {
        try {
          const emailElement = await driver.findElement(By.css(selector));
          const email =
            (await emailElement.getAttribute("value")) ||
            (await emailElement.getText());
          if (email && email.includes("@")) {
            userData.email = email.trim();
            console.log(`✅ Found email: ${userData.email}`);
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      // If no email found in inputs, try to get it from page text or meta
      if (!userData.email) {
        try {
          // Check page source for email patterns
          const pageSource = await driver.getPageSource();
          const emailMatch = pageSource.match(/[\w\.-]+@[\w\.-]+\.\w+/);
          if (emailMatch) {
            userData.email = emailMatch[0];
            console.log(`✅ Found email in page source: ${userData.email}`);
          }
        } catch (e) {
          console.log("Could not extract email from page source");
        }
      }

      // Try to get user name
      const nameSelectors = [
        'input[name="name"]',
        'input[name="full_name"]',
        '[data-testid="name"]',
        ".user-name",
        'h1:not(:contains("Home"))',
        'h2:not(:contains("Home"))',
      ];

      for (const selector of nameSelectors) {
        try {
          const nameElement = await driver.findElement(By.css(selector));
          const name =
            (await nameElement.getAttribute("value")) ||
            (await nameElement.getText());
          if (name && name.trim() && !name.includes("@") && name !== "Home") {
            userData.name = name.trim();
            console.log(`✅ Found name: ${userData.name}`);
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      // Try to get user's subdomain
      try {
        // First try to navigate to the dashboard to get subdomain
        console.log("🔍 Trying to get user's subdomain...");
        await driver.get("https://substack.com/dashboard");
        await driver.sleep(3000);

        const currentUrl = await driver.getCurrentUrl();
        console.log(`📍 Dashboard URL: ${currentUrl}`);

        // Look for links or redirects that contain the subdomain
        if (currentUrl.includes(".substack.com")) {
          const match = currentUrl.match(/https:\/\/([^.]+)\.substack\.com/);
          if (match) {
            userData.subdomain = match[1];
            console.log(`✅ Found subdomain: ${userData.subdomain}`);
          }
        }

        // If no subdomain found in URL, try to find it in page content
        if (!userData.subdomain) {
          try {
            // Look for publication links in the page
            const links = await driver.findElements(
              By.css('a[href*=".substack.com"]')
            );
            for (const link of links) {
              try {
                const href = await link.getAttribute("href");
                const match = href.match(/https:\/\/([^.]+)\.substack\.com/);
                if (match && match[1] !== "www") {
                  userData.subdomain = match[1];
                  console.log(
                    `✅ Found subdomain from link: ${userData.subdomain}`
                  );
                  break;
                }
              } catch (e) {
                continue;
              }
            }
          } catch (e) {
            console.log("Could not extract subdomain from page links");
          }
        }

        // If still no subdomain, try to get it from the page source
        if (!userData.subdomain) {
          try {
            const pageSource = await driver.getPageSource();
            const match = pageSource.match(/https:\/\/([^.]+)\.substack\.com/);
            if (match && match[1] !== "www") {
              userData.subdomain = match[1];
              console.log(
                `✅ Found subdomain from page source: ${userData.subdomain}`
              );
            }
          } catch (e) {
            console.log("Could not extract subdomain from page source");
          }
        }
      } catch (error) {
        console.log("Could not determine user subdomain:", error.message);
      }

      // Get the authentication tokens
      const authTokens = await extractAuthTokens(driver);
      userData.authTokens = authTokens;
    } catch (error) {
      console.warn(
        "Could not extract all user data, but login was successful:",
        error.message
      );
    }

    return userData;
  } catch (error) {
    console.error("Error extracting user data:", error);
    return {
      email: null,
      name: null,
      profileUrl: await driver.getCurrentUrl(),
      subdomain: null,
      isLoggedIn: true,
      loginTime: new Date().toISOString(),
      authTokens: await extractAuthTokens(driver),
    };
  }
}

/**
 * Gets session status
 * @param {string} sessionId - Browser session ID
 * @returns {Promise<Object>} Session status information
 */
async function getSessionStatus(sessionId) {
  // Check in-memory first (active WebDriver session)
  const activeSession = activeSessions.get(sessionId);

  // Check persistent storage
  const persistentSession = await sessionStore.getSession(sessionId);

  if (!activeSession && !persistentSession) {
    return { exists: false, status: "not_found" };
  }

  // If we have a persistent session but no active session,
  // it means the session survived a restart but WebDriver needs to be recreated
  const session = activeSession || persistentSession;
  const isActive = !!activeSession;
  const isPersistent = !!persistentSession;

  return {
    exists: true,
    status: session.status,
    email: session.email || null,
    createdAt: session.createdAt,
    lastActiveAt: persistentSession?.lastActiveAt || null,
    age: Date.now() - new Date(session.createdAt).getTime(),
    isActive, // Has active WebDriver instance
    isPersistent, // Saved to disk
    needsReconnection:
      isPersistent && !isActive && session.status === "logged_in",
  };
}

/**
 * Gets all active sessions (for debugging)
 * @returns {Promise<Object>} List of active and persistent sessions
 */
async function getAllActiveSessions() {
  const activeSessions_array = [];
  const persistentSessions = await sessionStore.getAllSessions();

  // Get active sessions (in-memory with WebDriver)
  for (const [sessionId, session] of activeSessions.entries()) {
    activeSessions_array.push({
      sessionId,
      status: session.status,
      email: session.email || null,
      createdAt: session.createdAt,
      age: Date.now() - new Date(session.createdAt).getTime(),
      isActive: true,
      isPersistent: !!persistentSessions[sessionId],
    });
  }

  // Get persistent sessions that are not currently active
  const persistentSessions_array = [];
  for (const [sessionId, session] of Object.entries(persistentSessions)) {
    if (!activeSessions.has(sessionId)) {
      persistentSessions_array.push({
        sessionId,
        status: session.status,
        email: session.email || null,
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
        age: Date.now() - new Date(session.createdAt).getTime(),
        isActive: false,
        isPersistent: true,
        needsReconnection: session.status === "logged_in",
      });
    }
  }

  return {
    active: {
      count: activeSessions_array.length,
      sessions: activeSessions_array,
    },
    persistent: {
      count: persistentSessions_array.length,
      sessions: persistentSessions_array,
    },
    total: activeSessions_array.length + persistentSessions_array.length,
  };
}

/**
 * Closes a browser session and cleans up resources
 * @param {string} sessionId - Browser session ID
 * @param {boolean} keepPersistent - Whether to keep the session in persistent storage
 * @returns {Promise<boolean>} Success status
 */
async function closeSession(sessionId, keepPersistent = false) {
  try {
    const session = activeSessions.get(sessionId);

    // Close WebDriver if it exists
    if (session) {
      try {
        await session.driver.quit();
      } catch (error) {
        console.error("Error quitting WebDriver:", error);
      }
      activeSessions.delete(sessionId);
    }

    // Remove from persistent storage unless keepPersistent is true
    if (!keepPersistent) {
      await sessionStore.deleteSession(sessionId);
    }

    console.log(
      `🔄 Closed Substack session: ${sessionId} (persistent: ${keepPersistent})`
    );
    return true;
  } catch (error) {
    console.error("Error closing session:", error);
    activeSessions.delete(sessionId); // Remove from map even if quit fails
    return false;
  }
}

/**
 * Cleans up old/inactive sessions
 * @param {number} maxAge - Maximum age for active sessions in milliseconds (default: 2 hours)
 * @param {number} maxPersistentAge - Maximum age for persistent sessions in milliseconds (default: 7 days)
 */
async function cleanupOldSessions(
  maxAge = 2 * 60 * 60 * 1000,
  maxPersistentAge = 7 * 24 * 60 * 60 * 1000
) {
  const now = Date.now();
  let cleanedActive = 0;

  // Clean up old active sessions (close WebDriver but keep persistent if recent)
  for (const [sessionId, session] of activeSessions.entries()) {
    const sessionAge = now - new Date(session.createdAt).getTime();
    if (sessionAge > maxAge) {
      console.log(`🧹 Cleaning up old active session: ${sessionId}`);
      // Keep persistent if it's not too old
      const keepPersistent = sessionAge < maxPersistentAge;
      await closeSession(sessionId, keepPersistent);
      cleanedActive++;
    }
  }

  // Clean up very old persistent sessions
  const cleanedPersistent = await sessionStore.cleanupExpiredSessions(
    maxPersistentAge
  );

  if (cleanedActive > 0 || cleanedPersistent > 0) {
    console.log(
      `🧹 Cleanup complete: ${cleanedActive} active sessions, ${cleanedPersistent} persistent sessions`
    );
  }

  return { cleanedActive, cleanedPersistent };
}

/**
 * Creates a JWT token containing Substack authentication data
 * @param {Object} userData - User data from successful login
 * @returns {string} JWT token
 */
function createSubstackAuthToken(userData) {
  try {
    const tokenData = {
      provider: "substack",
      email: userData.email,
      name: userData.name,
      profileUrl: userData.profileUrl,
      isLoggedIn: userData.isLoggedIn,
      loginTime: userData.loginTime,
      authTokens: userData.authTokens,
      // Add expiration (24 hours)
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
      iat: Math.floor(Date.now() / 1000),
    };

    const token = jwt.sign(tokenData, config.jwt.secret);
    console.log("🔐 Created Substack auth token");
    return token;
  } catch (error) {
    console.error("Error creating Substack auth token:", error);
    throw new Error(`Failed to create auth token: ${error.message}`);
  }
}

/**
 * Generates a unique session ID
 * @returns {string} Random session ID
 */
function generateSessionId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

/**
 * Debug helper to check page state
 * @param {WebDriver} driver - Selenium WebDriver instance
 * @returns {Promise<Object>} Page state information
 */
async function getPageStateFromDriver(driver) {
  try {
    const currentUrl = await driver.getCurrentUrl();
    const title = await driver.getTitle();

    // Check for common elements
    const hasEmailInput = await driver
      .findElements(By.css('input[type="email"]'))
      .then((els) => els.length > 0);
    const hasCodeInput = await driver
      .findElements(By.css('input[type="text"]'))
      .then((els) => els.length > 0);
    const hasSubmitButton = await driver
      .findElements(By.css('button[type="submit"]'))
      .then((els) => els.length > 0);

    return {
      url: currentUrl,
      title,
      hasEmailInput,
      hasCodeInput,
      hasSubmitButton,
    };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * Gets current page state for a session
 * @param {string} sessionId - Browser session ID
 * @returns {Promise<Object>} Page state information
 */
async function getPageState(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  return await getPageStateFromDriver(session.driver);
}

/**
 * Waits for email verification to complete (when user clicks link in email)
 * @param {string} sessionId - Browser session ID
 * @param {number} timeoutMs - How long to wait in milliseconds
 * @returns {Promise<Object>} Verification result
 */
async function waitForEmailVerification(sessionId, timeoutMs = 300000) {
  // 5 minutes default
  try {
    let session = activeSessions.get(sessionId);

    // If session not active but exists in persistent storage, try to reconnect
    if (!session) {
      const persistentSession = await sessionStore.getSession(sessionId);
      if (persistentSession) {
        if (persistentSession.status === "logged_in") {
          console.log(
            `🔄 Session ${sessionId} not active, attempting reconnection...`
          );
          await reconnectSession(sessionId);
          session = activeSessions.get(sessionId);
        } else {
          console.log(
            `🔄 Session ${sessionId} found with status ${persistentSession.status}, recreating WebDriver...`
          );
          await recreateWebDriverSession(sessionId);
          session = activeSessions.get(sessionId);
        }
      }
    }

    if (!session) {
      throw new Error("Session not found and could not be reconnected");
    }

    const { driver } = session;

    console.log(
      `⏳ Waiting for email verification for session: ${sessionId} (timeout: ${
        timeoutMs / 1000
      }s)`
    );

    const startTime = Date.now();

    // Poll the page every 3 seconds to check if verification completed
    while (Date.now() - startTime < timeoutMs) {
      try {
        const currentUrl = await driver.getCurrentUrl();
        console.log(`🔍 Checking URL: ${currentUrl}`);

        // Check if we're logged in (no longer on sign-in page)
        if (
          currentUrl.includes("substack.com") &&
          !currentUrl.includes("sign-in") &&
          !currentUrl.includes("verify") &&
          !currentUrl.includes("login")
        ) {
          session.status = "logged_in";
          const userData = await getUserData(driver);

          // Create JWT auth token
          const substackAuthToken = createSubstackAuthToken(userData);

          console.log(
            `✅ Email verification completed: ${
              userData.email || "email not found"
            }`
          );

          return {
            success: true,
            status: "logged_in",
            userData,
            substackAuthToken,
            message: "Email verification completed successfully",
            verificationMethod: "email_click",
          };
        }

        // Wait 3 seconds before next check
        await driver.sleep(3000);
      } catch (error) {
        console.log(`Error during verification check: ${error.message}`);
        await driver.sleep(3000);
      }
    }

    // Timeout reached
    const currentUrl = await driver.getCurrentUrl();
    return {
      success: false,
      status: "verification_timeout",
      currentUrl,
      message: `Email verification timed out after ${
        timeoutMs / 1000
      } seconds. Please check your email and click the verification link.`,
      timeoutMs,
    };
  } catch (error) {
    console.error("Error waiting for email verification:", error);
    throw new Error(`Email verification wait failed: ${error.message}`);
  }
}

/**
 * Reconnects to a persistent session by creating a new WebDriver instance
 * @param {string} sessionId - Session ID to reconnect
 * @returns {Promise<Object>} Reconnection result
 */
async function recreateWebDriverSession(sessionId) {
  try {
    // Check if session is already active
    if (activeSessions.has(sessionId)) {
      return {
        success: true,
        message: "Session already active",
        recreated: false,
      };
    }

    // Get persistent session data
    const persistentSession = await sessionStore.getSession(sessionId);
    if (!persistentSession) {
      throw new Error("Persistent session not found");
    }

    console.log(
      `🔄 Recreating WebDriver for session: ${sessionId} (status: ${persistentSession.status})`
    );

    // Create new WebDriver instance
    const options = new chrome.Options();
    const isHeadless = process.env.SUBSTACK_HEADLESS !== "false";
    if (isHeadless) {
      options.addArguments("--headless");
    }
    options.addArguments("--no-sandbox");
    options.addArguments("--disable-dev-shm-usage");
    options.addArguments("--disable-gpu");
    options.addArguments("--window-size=1920,1080");

    const driver = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(options)
      .build();

    // Create new active session with the same data
    const recreatedSession = {
      id: sessionId,
      driver,
      createdAt: new Date(persistentSession.createdAt),
      status: persistentSession.status,
      email: persistentSession.email,
      userData: persistentSession.userData,
    };

    activeSessions.set(sessionId, recreatedSession);

    // Update last active time
    await sessionStore.updateLastActive(sessionId);

    console.log(`✅ Successfully recreated WebDriver session: ${sessionId}`);
    return {
      success: true,
      message: "WebDriver session recreated successfully",
      recreated: true,
      sessionData: {
        sessionId,
        status: persistentSession.status,
        email: persistentSession.email,
        createdAt: persistentSession.createdAt,
      },
    };
  } catch (error) {
    console.error("Error recreating WebDriver session:", error);
    throw new Error(`Failed to recreate WebDriver session: ${error.message}`);
  }
}

async function reconnectSession(sessionId) {
  try {
    // Check if session is already active
    if (activeSessions.has(sessionId)) {
      return {
        success: true,
        message: "Session already active",
        reconnected: false,
      };
    }

    // Get persistent session data
    const persistentSession = await sessionStore.getSession(sessionId);
    if (!persistentSession) {
      throw new Error("Persistent session not found");
    }

    if (persistentSession.status !== "logged_in") {
      throw new Error(
        `Cannot reconnect session with status: ${persistentSession.status}`
      );
    }

    console.log(`🔄 Reconnecting to persistent session: ${sessionId}`);

    // Create new WebDriver instance
    const options = new chrome.Options();
    const isHeadless = process.env.SUBSTACK_HEADLESS !== "false";
    if (isHeadless) {
      options.addArguments("--headless");
    }
    options.addArguments("--no-sandbox");
    options.addArguments("--disable-dev-shm-usage");
    options.addArguments("--disable-gpu");
    options.addArguments("--window-size=1920,1080");

    const driver = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(options)
      .build();

    // Navigate to Substack and restore authentication
    await driver.get("https://substack.com");

    // Restore cookies if available
    if (persistentSession.userData?.authTokens?.cookies) {
      for (const [name, value] of Object.entries(
        persistentSession.userData.authTokens.cookies
      )) {
        try {
          await driver.manage().addCookie({
            name,
            value,
            domain: ".substack.com",
          });
        } catch (error) {
          console.log(`Could not restore cookie ${name}:`, error.message);
        }
      }
    }

    // Refresh to apply cookies
    await driver.navigate().refresh();
    await driver.sleep(2000);

    // Create new active session
    const reconnectedSession = {
      id: sessionId,
      driver,
      createdAt: new Date(persistentSession.createdAt),
      status: persistentSession.status,
      email: persistentSession.email,
      userData: persistentSession.userData,
    };

    activeSessions.set(sessionId, reconnectedSession);

    // Update last active time
    await sessionStore.updateLastActive(sessionId);

    console.log(`✅ Successfully reconnected session: ${sessionId}`);
    return {
      success: true,
      message: "Session reconnected successfully",
      reconnected: true,
      sessionData: {
        sessionId,
        status: persistentSession.status,
        email: persistentSession.email,
        createdAt: persistentSession.createdAt,
      },
    };
  } catch (error) {
    console.error("Error reconnecting session:", error);
    throw new Error(`Failed to reconnect session: ${error.message}`);
  }
}

/**
 * Creates a post on Substack using an authenticated session
 * @param {string} sessionId - Browser session ID
 * @param {Object} postData - Post data
 * @param {string} postData.title - Post title
 * @param {string} postData.content - Post content (HTML or markdown)
 * @param {boolean} [postData.isDraft=false] - Whether to save as draft
 * @param {string} [postData.subtitle] - Post subtitle
 * @param {string} [postData.subdomain] - User's Substack subdomain (optional override)
 * @returns {Promise<Object>} Post creation result
 */
async function createPost(sessionId, postData) {
  try {
    let session = activeSessions.get(sessionId);

    // If session not active but exists in persistent storage, try to reconnect
    if (!session) {
      const persistentSession = await sessionStore.getSession(sessionId);
      if (persistentSession && persistentSession.status === "logged_in") {
        console.log(
          `🔄 Session ${sessionId} not active, attempting reconnection...`
        );
        await reconnectSession(sessionId);
        session = activeSessions.get(sessionId);
      }
    }

    if (!session) {
      throw new Error("Session not found and could not be reconnected");
    }

    if (session.status !== "logged_in") {
      throw new Error(
        `Session not logged in. Current status: ${session.status}`
      );
    }

    const { driver } = session;
    const {
      title,
      content,
      isDraft = false,
      subtitle = "",
      subdomain = null,
    } = postData;

    if (!title || !content) {
      throw new Error("Title and content are required");
    }

    console.log(`📝 Creating Substack post: "${title}"`);

    // Get user's subdomain from session data or parameter
    const userSubdomain = subdomain || session.userData?.subdomain;
    console.log(`🔍 User subdomain: ${userSubdomain}`);

    // Build URLs based on user's subdomain
    const writeUrls = [];

    if (userSubdomain) {
      // Use user-specific subdomain URLs first
      writeUrls.push(
        `https://${userSubdomain}.substack.com/publish`,
        `https://${userSubdomain}.substack.com/publish/post`,
        `https://${userSubdomain}.substack.com/publish/posts/new`
      );
    }

    // Add generic fallback URLs
    writeUrls.push(
      "https://substack.com/publish",
      "https://substack.com/publish/post",
      "https://substack.com/publish/posts/new"
    );

    let foundEditor = false;
    let currentUrl;

    for (const url of writeUrls) {
      try {
        console.log(`🔗 Trying URL: ${url}`);
        await driver.get(url);
        await driver.sleep(3000);

        currentUrl = await driver.getCurrentUrl();
        console.log(`📍 Current URL: ${currentUrl}`);

        // Check if we're still logged in
        if (currentUrl.includes("sign-in") || currentUrl.includes("login")) {
          throw new Error("Session expired. Please log in again.");
        }

        // Check if we can find a title input on this page
        try {
          await driver.wait(
            until.elementLocated(
              By.css(
                'input[placeholder*="Title"], input[data-testid="title-input"], .title-input, input[name="title"]'
              )
            ),
            5000
          );
          foundEditor = true;
          console.log(`✅ Found editor at: ${url}`);
          break;
        } catch (error) {
          console.log(`❌ No editor found at: ${url}`);
          continue;
        }
      } catch (error) {
        console.log(`❌ Failed to load: ${url} - ${error.message}`);
        continue;
      }
    }

    if (!foundEditor) {
      // Try to find a "Write" or "New post" button on the current page
      console.log(`🔍 Looking for write/new post button on current page...`);
      try {
        const writeButton = await driver.findElement(
          By.xpath(
            '//a[contains(text(), "Write") or contains(text(), "New post") or contains(text(), "Create")] | //button[contains(text(), "Write") or contains(text(), "New post") or contains(text(), "Create")]'
          )
        );
        await writeButton.click();
        await driver.sleep(3000);

        // Try to find title input after clicking
        await driver.wait(
          until.elementLocated(
            By.css(
              'input[placeholder*="Title"], input[data-testid="title-input"], .title-input, input[name="title"]'
            )
          ),
          10000
        );
        foundEditor = true;
        console.log(`✅ Found editor after clicking write button`);
      } catch (error) {
        console.log(
          `❌ Could not find write button or editor: ${error.message}`
        );
      }
    }

    if (!foundEditor) {
      // Get page source for debugging
      const pageTitle = await driver.getTitle();
      const pageSource = await driver.getPageSource();
      console.log(`📄 Page title: ${pageTitle}`);
      console.log(`📄 Current URL: ${await driver.getCurrentUrl()}`);
      console.log(`📄 Page source length: ${pageSource.length}`);

      // Look for any input fields on the page
      const inputs = await driver.findElements(By.css("input"));
      console.log(`🔍 Found ${inputs.length} input elements on page`);

      for (let i = 0; i < Math.min(inputs.length, 5); i++) {
        try {
          const placeholder = await inputs[i].getAttribute("placeholder");
          const name = await inputs[i].getAttribute("name");
          const type = await inputs[i].getAttribute("type");
          console.log(
            `Input ${i}: placeholder="${placeholder}", name="${name}", type="${type}"`
          );
        } catch (e) {
          console.log(`Input ${i}: Could not get attributes`);
        }
      }

      throw new Error(
        `Could not find Substack editor on any of the tried URLs. Current URL: ${await driver.getCurrentUrl()}`
      );
    }

    // Find and fill the title input
    let titleInput;
    const titleSelectors = [
      'input[placeholder*="Title"]',
      'input[data-testid="title-input"]',
      ".title-input input",
      'input[name="title"]',
      ".editor-title input",
    ];

    for (const selector of titleSelectors) {
      try {
        titleInput = await driver.findElement(By.css(selector));
        break;
      } catch (error) {
        console.log(`Title selector "${selector}" not found, trying next...`);
      }
    }

    if (!titleInput) {
      throw new Error("Could not find title input field");
    }

    await titleInput.clear();
    await titleInput.sendKeys(title);
    console.log(`✅ Title entered: "${title}"`);

    // Find and fill subtitle if provided
    if (subtitle) {
      try {
        const subtitleInput = await driver.findElement(
          By.css(
            'input[placeholder*="subtitle"], input[placeholder*="Subtitle"], .subtitle-input input'
          )
        );
        await subtitleInput.clear();
        await subtitleInput.sendKeys(subtitle);
        console.log(`✅ Subtitle entered: "${subtitle}"`);
      } catch (error) {
        console.log("Subtitle input not found or not available");
      }
    }

    // Find and fill the content editor
    let contentEditor;
    const contentSelectors = [
      ".ProseMirror",
      '[data-testid="editor-content"]',
      ".editor-content",
      ".post-editor",
      'div[contenteditable="true"]',
    ];

    for (const selector of contentSelectors) {
      try {
        contentEditor = await driver.findElement(By.css(selector));
        break;
      } catch (error) {
        console.log(`Content selector "${selector}" not found, trying next...`);
      }
    }

    if (!contentEditor) {
      throw new Error("Could not find content editor");
    }

    // Clear existing content and add new content
    await contentEditor.click();
    await driver.executeScript("arguments[0].innerHTML = '';", contentEditor);
    await contentEditor.sendKeys(content);
    console.log(`✅ Content entered (${content.length} characters)`);

    // Wait a moment for the content to be processed
    await driver.sleep(2000);

    // Find and click the publish/save button
    let actionButton;
    const buttonSelectors = isDraft
      ? [
          'button[data-testid="save-draft"]',
          'button:contains("Save draft")',
          ".save-draft-button",
        ]
      : [
          'button[data-testid="publish"]',
          'button:contains("Publish")',
          ".publish-button",
          'button:contains("Continue")',
        ];

    for (const selector of buttonSelectors) {
      try {
        if (selector.includes(":contains(")) {
          // Use XPath for text-based selectors
          const text = selector.match(/:contains\("([^"]+)"\)/)[1];
          actionButton = await driver.findElement(
            By.xpath(`//button[contains(text(), "${text}")]`)
          );
        } else {
          actionButton = await driver.findElement(By.css(selector));
        }
        break;
      } catch (error) {
        console.log(`Button selector "${selector}" not found, trying next...`);
      }
    }

    if (!actionButton) {
      // Fallback: look for any button that might be the publish/save button
      const buttons = await driver.findElements(By.css("button"));
      for (const button of buttons) {
        try {
          const buttonText = await button.getText();
          if (
            (isDraft &&
              (buttonText.toLowerCase().includes("save") ||
                buttonText.toLowerCase().includes("draft"))) ||
            (!isDraft &&
              (buttonText.toLowerCase().includes("publish") ||
                buttonText.toLowerCase().includes("continue")))
          ) {
            actionButton = button;
            break;
          }
        } catch (error) {
          continue;
        }
      }
    }

    if (!actionButton) {
      throw new Error(
        `Could not find ${isDraft ? "save draft" : "publish"} button`
      );
    }

    // Click the action button
    await actionButton.click();
    console.log(`✅ Clicked ${isDraft ? "save draft" : "publish"} button`);

    // Wait for the action to complete
    await driver.sleep(3000);

    // If publishing (not draft), there might be additional steps
    if (!isDraft) {
      try {
        // Look for final publish button or confirmation
        const finalPublishButton = await driver.findElement(
          By.xpath(
            '//button[contains(text(), "Publish now") or contains(text(), "Publish")]'
          )
        );
        await finalPublishButton.click();
        console.log("✅ Final publish button clicked");
        await driver.sleep(2000);
      } catch (error) {
        console.log("No final publish step required or button not found");
      }
    }

    // Get the current URL to check if post was created
    const finalUrl = await driver.getCurrentUrl();

    // Try to get the post URL if available
    let postUrl = null;
    try {
      if (finalUrl.includes("/p/") || finalUrl.includes("/post/")) {
        postUrl = finalUrl;
      } else {
        // Try to find a link to the created post
        const postLink = await driver.findElement(By.css('a[href*="/p/"]'));
        postUrl = await postLink.getAttribute("href");
      }
    } catch (error) {
      console.log("Could not determine post URL");
    }

    const result = {
      success: true,
      title,
      subtitle,
      content: content.substring(0, 100) + (content.length > 100 ? "..." : ""),
      isDraft,
      postUrl,
      currentUrl: finalUrl,
      message: `Post ${isDraft ? "saved as draft" : "published"} successfully`,
      createdAt: new Date().toISOString(),
    };

    console.log(
      `🎉 Substack post ${isDraft ? "draft saved" : "published"}: "${title}"`
    );
    return result;
  } catch (error) {
    console.error("Error creating Substack post:", error);
    throw new Error(`Failed to create post: ${error.message}`);
  }
}

// Cleanup old sessions every hour
setInterval(cleanupOldSessions, 60 * 60 * 1000);

module.exports = {
  createSession,
  initiateLogin,
  submitVerificationCode,
  waitForEmailVerification,
  getSessionStatus,
  getAllActiveSessions,
  reconnectSession,
  recreateWebDriverSession,
  closeSession,
  cleanupOldSessions,
  getPageState,
  createSubstackAuthToken,
  createPost,
};
