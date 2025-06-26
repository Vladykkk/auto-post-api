/**
 * Substack service for automated login using Selenium
 * @module services/substackService
 */

const { Builder, By, until, Key } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const jwt = require("jsonwebtoken");
const config = require("../config/environment");

// Store active sessions
const activeSessions = new Map();

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
    const session = activeSessions.get(sessionId);
    if (!session) {
      throw new Error("Session not found");
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
    const session = activeSessions.get(sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    if (session.status !== "awaiting_verification") {
      throw new Error(`Invalid session status: ${session.status}`);
    }

    const { driver } = session;

    console.log(`🔢 Submitting verification code for session: ${sessionId}`);

    // Find verification code input with multiple strategies
    let codeInput;
    try {
      codeInput = await driver.wait(
        until.elementLocated(
          By.css(
            'input[type="text"], input[name="code"], input[placeholder*="code"], input[placeholder*="Code"], input[placeholder*="verification"]'
          )
        ),
        10000
      );
    } catch (error) {
      console.log("Trying alternative selectors for verification input...");
      // Try XPath approach
      try {
        codeInput = await driver.wait(
          until.elementLocated(
            By.xpath(
              '//input[contains(@placeholder, "code") or contains(@placeholder, "Code") or contains(@placeholder, "verification") or @name="code"]'
            )
          ),
          5000
        );
      } catch (xpathError) {
        // Last resort: find any text input that might be the verification field
        const inputs = await driver.findElements(By.css('input[type="text"]'));
        if (inputs.length > 0) {
          codeInput = inputs[inputs.length - 1]; // Often the last input is the verification field
        } else {
          throw new Error("Could not find verification code input field");
        }
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

    // Create JWT auth token
    const substackAuthToken = createSubstackAuthToken(userData);

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
      isLoggedIn: true,
      loginTime: new Date().toISOString(),
      authTokens: await extractAuthTokens(driver),
    };
  }
}

/**
 * Gets session status
 * @param {string} sessionId - Browser session ID
 * @returns {Object} Session status information
 */
function getSessionStatus(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) {
    return { exists: false, status: "not_found" };
  }

  return {
    exists: true,
    status: session.status,
    email: session.email || null,
    createdAt: session.createdAt,
    age: Date.now() - session.createdAt.getTime(),
  };
}

/**
 * Closes a browser session and cleans up resources
 * @param {string} sessionId - Browser session ID
 * @returns {Promise<boolean>} Success status
 */
async function closeSession(sessionId) {
  try {
    const session = activeSessions.get(sessionId);
    if (!session) {
      return false;
    }

    await session.driver.quit();
    activeSessions.delete(sessionId);

    console.log(`🔄 Closed Substack session: ${sessionId}`);
    return true;
  } catch (error) {
    console.error("Error closing session:", error);
    activeSessions.delete(sessionId); // Remove from map even if quit fails
    return false;
  }
}

/**
 * Cleans up old/inactive sessions
 */
async function cleanupOldSessions() {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const [sessionId, session] of activeSessions.entries()) {
    if (now - session.createdAt.getTime() > maxAge) {
      console.log(`🧹 Cleaning up old session: ${sessionId}`);
      await closeSession(sessionId);
    }
  }
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
    const session = activeSessions.get(sessionId);
    if (!session) {
      throw new Error("Session not found");
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

// Cleanup old sessions every 10 minutes
setInterval(cleanupOldSessions, 10 * 60 * 1000);

module.exports = {
  createSession,
  initiateLogin,
  submitVerificationCode,
  waitForEmailVerification,
  getSessionStatus,
  closeSession,
  cleanupOldSessions,
  getPageState,
  createSubstackAuthToken,
};
