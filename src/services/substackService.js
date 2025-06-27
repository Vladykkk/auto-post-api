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

      // Try to get user's subdomain with improved detection
      try {
        console.log("🔍 Trying to get user's subdomain...");
        let foundSubdomain = false;

        // Method 1: Check if user has a publication by looking for "Start writing" vs "New post" button
        try {
          await driver.get("https://substack.com/home");
          await driver.sleep(3000);

          // Look for existing publications in the user's profile
          const pageSource = await driver.getPageSource();

          // Check for publication data in JSON scripts
          const scriptMatches = pageSource.match(
            /<script[^>]*>.*?"publications":\s*\[(.*?)\]/s
          );
          if (scriptMatches) {
            console.log("📝 Found publications data in page source");

            // Extract publication subdomains from the JSON data
            const publicationMatches = scriptMatches[1].match(
              /"subdomain":\s*"([^"]+)"/g
            );
            if (publicationMatches) {
              for (const match of publicationMatches) {
                const subdomainMatch = match.match(/"subdomain":\s*"([^"]+)"/);
                if (
                  subdomainMatch &&
                  subdomainMatch[1] !== "support" &&
                  subdomainMatch[1] !== "www"
                ) {
                  userData.subdomain = subdomainMatch[1];
                  console.log(
                    `✅ Found subdomain from publications data: ${userData.subdomain}`
                  );
                  foundSubdomain = true;
                  break;
                }
              }
            }
          }

          // Alternative: Look for publication cards/links on the home page
          if (!foundSubdomain) {
            const publicationLinks = await driver.findElements(
              By.css(
                'a[href*=".substack.com"]:not([href*="support.substack.com"]):not([href*="www.substack.com"])'
              )
            );

            for (const link of publicationLinks) {
              try {
                const href = await link.getAttribute("href");
                const linkText = await link
                  .getText()
                  .then((text) => text.toLowerCase());

                // Look for links that seem to be user publications (not generic Substack links)
                if (
                  href &&
                  (linkText.includes("write") ||
                    linkText.includes("dashboard") ||
                    linkText.includes("publish"))
                ) {
                  const match = href.match(/https:\/\/([^.]+)\.substack\.com/);
                  if (
                    match &&
                    match[1] !== "www" &&
                    match[1] !== "support" &&
                    match[1] !== "help"
                  ) {
                    userData.subdomain = match[1];
                    console.log(
                      `✅ Found subdomain from publication link: ${userData.subdomain}`
                    );
                    foundSubdomain = true;
                    break;
                  }
                }
              } catch (e) {
                continue;
              }
            }
          }
        } catch (e) {
          console.log("Could not find subdomain from home page");
        }

        // Method 2: Try the publications/dashboard page
        if (!foundSubdomain) {
          try {
            await driver.get("https://substack.com/publications");
            await driver.sleep(3000);

            // Look for "Write" buttons or publication management links
            const writeLinks = await driver.findElements(
              By.css(
                'a[href*=".substack.com/publish"], a[href*="/publish/home"]'
              )
            );

            for (const link of writeLinks) {
              try {
                const href = await link.getAttribute("href");
                const match = href.match(/https:\/\/([^.]+)\.substack\.com/);
                if (match && match[1] !== "www" && match[1] !== "support") {
                  userData.subdomain = match[1];
                  console.log(
                    `✅ Found subdomain from publications page: ${userData.subdomain}`
                  );
                  foundSubdomain = true;
                  break;
                }
              } catch (e) {
                continue;
              }
            }
          } catch (e) {
            console.log("Could not access publications page");
          }
        }

        // Method 3: Try to find subdomain from cookies/localStorage that might contain publication info
        if (!foundSubdomain) {
          try {
            // Check localStorage for publication data
            const localStorageData = await driver.executeScript(() => {
              const data = {};
              for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                const value = localStorage.getItem(key);
                if (
                  value &&
                  (value.includes(".substack.com") ||
                    key.includes("publication"))
                ) {
                  data[key] = value;
                }
              }
              return data;
            });

            for (const [key, value] of Object.entries(localStorageData)) {
              const match = value.match(/https:\/\/([^.]+)\.substack\.com/);
              if (match && match[1] !== "www" && match[1] !== "support") {
                userData.subdomain = match[1];
                console.log(
                  `✅ Found subdomain from localStorage: ${userData.subdomain}`
                );
                foundSubdomain = true;
                break;
              }
            }
          } catch (e) {
            console.log("Could not extract subdomain from localStorage");
          }
        }

        // Method 4: Manual fallback - ask user to create a publication if none exists
        if (!foundSubdomain) {
          console.log(
            "⚠️ No publication subdomain found - user may need to create a publication first"
          );

          // Try to detect if user has any publications at all
          try {
            await driver.get("https://substack.com/home");
            await driver.sleep(2000);

            const pageText = await driver
              .findElement(By.tagName("body"))
              .getText();
            if (
              pageText.includes("Start writing") ||
              pageText.includes("Create your Substack")
            ) {
              console.log("📝 User appears to have no publications yet");
              userData.needsPublication = true;
            }
          } catch (e) {
            console.log("Could not determine publication status");
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
  maxAge = 7 * 24 * 60 * 60 * 1000, // 7 days for active sessions
  maxPersistentAge = 90 * 24 * 60 * 60 * 1000 // 90 days for persistent sessions
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
    await driver.sleep(2000);

    // Restore cookies if available with improved error handling
    if (persistentSession.userData?.authTokens?.cookies) {
      console.log(
        `🔐 Restoring ${
          Object.keys(persistentSession.userData.authTokens.cookies).length
        } authentication cookies...`
      );

      for (const [name, cookieData] of Object.entries(
        persistentSession.userData.authTokens.cookies
      )) {
        try {
          // Handle both old format (string value) and new format (object with metadata)
          const cookieValue =
            typeof cookieData === "string" ? cookieData : cookieData.value;
          const cookieDomain =
            typeof cookieData === "object" && cookieData.domain
              ? cookieData.domain
              : ".substack.com";
          const cookiePath =
            typeof cookieData === "object" && cookieData.path
              ? cookieData.path
              : "/";

          // Try different domain variations for better compatibility
          const domains = [cookieDomain, ".substack.com", "substack.com"];
          let cookieSet = false;

          for (const domain of domains) {
            try {
              const cookieObj = {
                name,
                value: cookieValue,
                domain,
                path: cookiePath,
              };

              // Add additional cookie properties if available
              if (typeof cookieData === "object") {
                if (cookieData.secure !== undefined)
                  cookieObj.secure = cookieData.secure;
                if (cookieData.httpOnly !== undefined)
                  cookieObj.httpOnly = cookieData.httpOnly;
                if (cookieData.sameSite !== undefined)
                  cookieObj.sameSite = cookieData.sameSite;

                // Extend expiry time for better persistence
                if (cookieData.expiry) {
                  const now = Math.floor(Date.now() / 1000);
                  const originalExpiry = cookieData.expiry;
                  // Extend expiry by 30 days if it's expired or expiring soon
                  if (originalExpiry < now + 86400) {
                    // Less than 1 day left
                    cookieObj.expiry = now + 30 * 24 * 60 * 60; // 30 days from now
                  } else {
                    cookieObj.expiry = originalExpiry;
                  }
                }
              }

              await driver.manage().addCookie(cookieObj);
              cookieSet = true;
              break;
            } catch (domainError) {
              // Try next domain
              continue;
            }
          }

          if (!cookieSet) {
            console.log(`⚠️ Could not restore cookie ${name} on any domain`);
          } else {
            console.log(`✅ Restored cookie: ${name}`);
          }
        } catch (error) {
          console.log(`❌ Failed to restore cookie ${name}:`, error.message);
        }
      }
    }

    // Restore localStorage if available
    if (persistentSession.userData?.authTokens?.localStorage) {
      try {
        console.log(`🔐 Restoring localStorage items...`);
        for (const [key, value] of Object.entries(
          persistentSession.userData.authTokens.localStorage
        )) {
          await driver.executeScript(
            `localStorage.setItem(arguments[0], arguments[1]);`,
            key,
            value
          );
        }
      } catch (error) {
        console.log(`⚠️ Could not restore localStorage:`, error.message);
      }
    }

    // Refresh to apply cookies and localStorage
    await driver.navigate().refresh();
    await driver.sleep(3000);

    // Verify authentication by checking if we're still logged in
    try {
      const currentUrl = await driver.getCurrentUrl();
      console.log(`🔍 Current URL after cookie restoration: ${currentUrl}`);

      // Try to navigate to a protected page to verify authentication
      await driver.get("https://substack.com/home");
      await driver.sleep(3000);

      const homeUrl = await driver.getCurrentUrl();
      if (homeUrl.includes("sign-in") || homeUrl.includes("login")) {
        console.log(
          `⚠️ Authentication verification failed - redirected to login`
        );
        // Don't throw error here, let the session be created but mark for re-auth
      } else {
        console.log(`✅ Authentication verified successfully`);
      }
    } catch (verifyError) {
      console.log(`⚠️ Could not verify authentication:`, verifyError.message);
    }

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
 * Refresh authentication tokens for an active session to prevent expiration
 * @param {string} sessionId - Session ID to refresh
 * @returns {Promise<Object>} Refresh result
 */
async function refreshSessionAuth(sessionId) {
  try {
    const session = activeSessions.get(sessionId);
    if (!session) {
      throw new Error("Session not found in active sessions");
    }

    const { driver } = session;
    console.log(`🔄 Refreshing authentication for session: ${sessionId}`);

    // Navigate to a safe page to refresh tokens
    await driver.get("https://substack.com/home");
    await driver.sleep(2000);

    // Extract fresh authentication tokens
    const freshAuthTokens = await extractAuthTokens(driver);

    // Update session userData with fresh tokens
    if (session.userData) {
      session.userData.authTokens = freshAuthTokens;
      session.userData.lastRefresh = new Date().toISOString();
    }

    // Update persistent storage with fresh tokens
    await sessionStore.saveSession(sessionId, {
      ...session,
      userData: session.userData,
      authTokens: freshAuthTokens,
    });

    console.log(`✅ Authentication refreshed for session: ${sessionId}`);
    return {
      success: true,
      message: "Authentication tokens refreshed successfully",
      refreshedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`Error refreshing session auth:`, error);
    return {
      success: false,
      message: "Failed to refresh authentication tokens",
      error: error.message,
    };
  }
}

/**
 * Check if session needs authentication refresh based on age and activity
 * @param {Object} session - Session object
 * @returns {boolean} True if refresh is needed
 */
function shouldRefreshAuth(session) {
  if (!session.userData?.authTokens?.extractedAt) {
    return true; // No auth tokens or no extraction date
  }

  const extractedAt = new Date(session.userData.authTokens.extractedAt);
  const now = new Date();
  const hoursSinceExtraction = (now - extractedAt) / (1000 * 60 * 60);

  // Refresh if tokens are older than 12 hours
  return hoursSinceExtraction > 12;
}

/**
 * Helper function to find and interact with Substack editor
 * @param {WebDriver} driver - Selenium WebDriver instance
 * @param {string} title - Post title
 * @param {string} content - Post content
 * @returns {Promise<boolean>} True if editor was found and content filled
 */
async function tryToFindEditor(driver, title, content) {
  try {
    // Step 2: Look for and click the "New post" button
    console.log(`🔍 Looking for "New post" button...`);
    try {
      const newPostButton = await driver.findElement(
        By.xpath(
          '//button[contains(text(), "New post")] | //a[contains(text(), "New post")]'
        )
      );

      console.log(`🖱️ Found "New post" button, clicking...`);
      await newPostButton.click();
      await driver.sleep(2000); // Wait for dropdown to appear

      // Step 3: Look for and click "Text post" in the dropdown
      console.log(`🔍 Looking for "Text post" option in dropdown...`);
      const textPostOption = await driver.findElement(
        By.xpath(
          '//button[contains(text(), "Text post")] | //a[contains(text(), "Text post")] | //*[contains(text(), "Text post")]'
        )
      );

      console.log(`🖱️ Found "Text post" option, clicking...`);
      await textPostOption.click();
      await driver.sleep(5000); // Give time for navigation to specific post URL

      // Check where we ended up after clicking
      const currentUrl = await driver.getCurrentUrl();
      console.log(`📍 After clicking Text post: ${currentUrl}`);

      // Should now be on a specific post editor like /publish/post/123456
      if (
        currentUrl.includes("/publish/post/") &&
        currentUrl.match(/\/publish\/post\/\d+/)
      ) {
        console.log(`🎯 Successfully navigated to post editor: ${currentUrl}`);

        // Try to fill in the title and content
        return await fillPostContent(driver, title, content);
      }
    } catch (error) {
      console.log(
        `❌ Could not find or click New post/Text post: ${error.message}`
      );
      return false;
    }
  } catch (error) {
    console.log(`❌ Error in tryToFindEditor: ${error.message}`);
    return false;
  }

  return false;
}

/**
 * Helper function to fill post content in the editor
 * @param {WebDriver} driver - Selenium WebDriver instance
 * @param {string} title - Post title
 * @param {string} content - Post content
 * @returns {Promise<boolean>} True if content was successfully filled
 */
async function fillPostContent(driver, title, content) {
  try {
    // Wait for editor to load and fill in title
    console.log(`📝 Filling in post title: "${title}"`);
    const titleInput = await driver.wait(
      until.elementLocated(
        By.css(
          'textarea[data-testid="post-title"], input[placeholder*="Title"]'
        )
      ),
      10000
    );

    await titleInput.clear();
    await titleInput.sendKeys(title);
    console.log(`✅ Title entered: "${title}"`);

    // Fill in content
    console.log(`📝 Filling in post content...`);
    const contentEditor = await driver.wait(
      until.elementLocated(
        By.css('div[data-testid="editor"], div[contenteditable="true"]')
      ),
      10000
    );

    await contentEditor.click();
    await contentEditor.clear();
    await contentEditor.sendKeys(content);
    console.log(`✅ Content entered (${content.length} characters)`);

    return true;
  } catch (error) {
    console.log(`❌ Error filling post content: ${error.message}`);
    return false;
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

    // Check if authentication needs refresh to prevent login issues
    if (shouldRefreshAuth(session)) {
      console.log(`🔄 Session authentication is stale, refreshing...`);
      try {
        await refreshSessionAuth(sessionId);
        // Get updated session after refresh
        session = activeSessions.get(sessionId);
      } catch (refreshError) {
        console.log(
          `⚠️ Could not refresh auth, continuing with existing tokens:`,
          refreshError.message
        );
      }
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
    let userSubdomain = subdomain || session.userData?.subdomain;
    console.log(`🔍 User subdomain: ${userSubdomain}`);

    // If no subdomain found, try to auto-detect it
    if (!userSubdomain) {
      console.log(
        `⚠️ No subdomain found for user. Attempting auto-detection...`
      );

      try {
        // Navigate to Substack home to check user's publication status
        await driver.get("https://substack.com/home");
        await driver.sleep(3000);

        const pageText = await driver.findElement(By.tagName("body")).getText();

        if (
          pageText.includes("Start writing") ||
          pageText.includes("Create your Substack")
        ) {
          throw new Error(
            "User has no Substack publication yet. Please create a publication first by visiting https://substack.com and clicking 'Start writing'."
          );
        } else {
          // User has publications but we couldn't detect the subdomain
          // Try to extract it from the page with multiple approaches
          const pageSource = await driver.getPageSource();

          // Method 1: Look for publication data in JSON
          const publicationDataMatch = pageSource.match(
            /"publications":\s*\[([^\]]+)\]/
          );
          if (publicationDataMatch) {
            try {
              const publicationsText = publicationDataMatch[1];
              const subdomainMatch = publicationsText.match(
                /"subdomain":"([^"]+)"/
              );
              if (subdomainMatch) {
                userSubdomain = subdomainMatch[1];
                console.log(
                  `🔍 Auto-detected subdomain from publications data: ${userSubdomain}`
                );
              }
            } catch (e) {
              console.log("Could not parse publications data");
            }
          }

          // Method 2: Look for user's own publication links (if method 1 failed)
          if (!userSubdomain) {
            const allSubdomainMatches = pageSource.match(
              /https:\/\/([a-zA-Z0-9-]+)\.substack\.com/g
            );

            if (allSubdomainMatches) {
              // Filter out common non-user subdomains and find the most likely user subdomain
              const filteredSubdomains = allSubdomainMatches
                .map(
                  (url) =>
                    url.match(/https:\/\/([a-zA-Z0-9-]+)\.substack\.com/)[1]
                )
                .filter(
                  (sub) =>
                    ![
                      "www",
                      "support",
                      "help",
                      "blog",
                      "newsletter",
                      "substack",
                      "app",
                      "api",
                      "cdn",
                      "static",
                    ].includes(sub)
                )
                .filter((sub, index, arr) => arr.indexOf(sub) === index); // Remove duplicates

              // Try to find the user's own subdomain by looking for publish links
              const userSubdomainCandidate = filteredSubdomains.find(
                (sub) =>
                  pageSource.includes(`${sub}.substack.com/publish`) ||
                  pageSource.includes(`"subdomain":"${sub}"`)
              );

              if (userSubdomainCandidate) {
                userSubdomain = userSubdomainCandidate;
                console.log(
                  `🔍 Auto-detected user's own subdomain: ${userSubdomain}`
                );
              } else if (filteredSubdomains.length > 0) {
                userSubdomain = filteredSubdomains[0]; // Fallback to first unique subdomain
                console.log(
                  `🔍 Auto-detected subdomain (fallback): ${userSubdomain}`
                );
              }
            }
          }

          if (userSubdomain) {
            // Update session with the detected subdomain
            if (session.userData) {
              session.userData.subdomain = userSubdomain;
              await sessionStore.saveSession(sessionId, session);
              console.log(
                `💾 Saved detected subdomain to session: ${userSubdomain}`
              );
            }
          }

          if (!userSubdomain) {
            throw new Error(
              "Could not determine user's publication subdomain. Please ensure you have created a Substack publication and try again."
            );
          }
        }
      } catch (error) {
        if (error.message.includes("User has no Substack publication")) {
          throw error; // Re-throw the helpful error message
        }
        throw new Error(
          `Could not determine publication status: ${error.message}`
        );
      }
    }

    // Start from user's dashboard and create a new post
    let foundEditor = false;
    let currentUrl;

    // Now userSubdomain should be available (either provided or auto-detected)

    try {
      // Step 1: Navigate to user's publish dashboard
      if (userSubdomain) {
        const publishDashboardUrl = `https://${userSubdomain}.substack.com/publish/home?utm_source=menu`;
        console.log(
          `🏠 Navigating to publish dashboard: ${publishDashboardUrl}`
        );
        await driver.get(publishDashboardUrl);
        await driver.sleep(3000);

        currentUrl = await driver.getCurrentUrl();
        console.log(`📍 Current URL after navigation: ${currentUrl}`);

        // Check if we're still logged in
        if (currentUrl.includes("sign-in") || currentUrl.includes("login")) {
          throw new Error("Session expired. Please log in again.");
        }

        // Step 2: Look for and click the "New post" button
        console.log(`🔍 Looking for "New post" button...`);
        try {
          const newPostButton = await driver.findElement(
            By.xpath(
              '//button[contains(text(), "New post")] | //a[contains(text(), "New post")]'
            )
          );

          console.log(`🖱️ Found "New post" button, clicking...`);
          await newPostButton.click();
          await driver.sleep(2000); // Wait for dropdown to appear

          // Step 3: Look for and click "Text post" in the dropdown
          console.log(`🔍 Looking for "Text post" option in dropdown...`);
          const textPostOption = await driver.findElement(
            By.xpath(
              '//button[contains(text(), "Text post")] | //a[contains(text(), "Text post")] | //*[contains(text(), "Text post")]'
            )
          );

          console.log(`🖱️ Found "Text post" option, clicking...`);
          await textPostOption.click();
          await driver.sleep(3000); // Give time for navigation to specific post URL

          // Check for any alert that might appear after clicking
          try {
            const alert = await driver.switchTo().alert();
            const alertText = await alert.getText();
            console.log(`⚠️ Alert after clicking Text post: "${alertText}"`);
            await alert.accept();
            console.log(`✅ Alert dismissed, refreshing page...`);
            await driver.navigate().refresh();
            await driver.sleep(3000);
          } catch (error) {
            // No alert, continue normally
          }

          // Check where we ended up after clicking
          currentUrl = await driver.getCurrentUrl();
          console.log(`📍 After clicking Text post: ${currentUrl}`);

          // Should now be on a post editor (either /publish/post/123456 or /publish/post?type=newsletter)
          if (
            currentUrl.includes("/publish/post") &&
            (currentUrl.match(/\/publish\/post\/\d+/) ||
              currentUrl.includes("type=newsletter"))
          ) {
            console.log(
              `🎯 Successfully navigated to post editor: ${currentUrl}`
            );
            foundEditor = true;
          } else {
            console.log(
              `❌ Unexpected URL after clicking Text post: ${currentUrl}`
            );
          }
        } catch (error) {
          console.log(
            `❌ Could not find or click New post/Text post: ${error.message}`
          );
        }
      }

      // Step 4: If not on editor yet after clicking Post button, wait for page to load
      if (!foundEditor) {
        console.log(`⏳ Waiting for editor to load...`);
        try {
          await driver.wait(
            until.elementLocated(
              By.css(
                'textarea[data-testid="post-title"], textarea[id="post-title"], textarea[placeholder="Title"], h1[contenteditable], div[contenteditable], input[placeholder*="Title"], input[data-testid="title-input"], .title-input, input[name="title"]'
              )
            ),
            15000
          );
          foundEditor = true;
          console.log(`✅ Found editor after waiting`);
        } catch (error) {
          console.log(
            `❌ Editor still not found after waiting: ${error.message}`
          );
        }
      }
    } catch (error) {
      console.log(`❌ Error in navigation process: ${error.message}`);
    }

    if (!foundEditor) {
      // Try alternative navigation approaches
      console.log(`🔍 Trying alternative navigation approaches...`);

      // Approach 1: Try direct navigation to /publish
      try {
        if (userSubdomain) {
          const directPublishUrl = `https://${userSubdomain}.substack.com/publish`;
          console.log(`🏠 Trying direct publish URL: ${directPublishUrl}`);
          await driver.get(directPublishUrl);
          await driver.sleep(3000);

          currentUrl = await driver.getCurrentUrl();
          console.log(`📍 After direct publish navigation: ${currentUrl}`);

          // Check if we have editor elements
          const editorFound = await tryToFindEditor(driver, title, content);
          if (editorFound) {
            foundEditor = true;
            console.log(`✅ Found editor via direct publish URL`);
          }
        }
      } catch (error) {
        console.log(`❌ Direct publish URL failed: ${error.message}`);
      }

      // Approach 2: Try user dashboard with write button
      if (!foundEditor) {
        try {
          if (userSubdomain) {
            console.log(
              `🏠 Navigating to user dashboard: https://${userSubdomain}.substack.com`
            );
            await driver.get(`https://${userSubdomain}.substack.com`);
            await driver.sleep(3000);
          }

          // Look for "Write" or "New post" button with more selectors
          const writeSelectors = [
            '//a[contains(text(), "Write")]',
            '//button[contains(text(), "Write")]',
            '//a[contains(text(), "New post")]',
            '//button[contains(text(), "New post")]',
            '//a[contains(@href, "publish")]',
            '//button[contains(@href, "publish")]',
            '//a[contains(text(), "Create")]',
            '//button[contains(text(), "Create")]',
            ".write-button",
            '[data-testid="write-button"]',
            '[data-testid="new-post-button"]',
          ];

          let writeButton = null;
          for (const selector of writeSelectors) {
            try {
              if (selector.startsWith("//")) {
                writeButton = await driver.findElement(By.xpath(selector));
              } else {
                writeButton = await driver.findElement(By.css(selector));
              }
              console.log(`✅ Found write button with selector: ${selector}`);
              break;
            } catch (e) {
              console.log(
                `Write selector "${selector}" not found, trying next...`
              );
            }
          }

          if (writeButton) {
            console.log(`🖱️ Clicking write button...`);
            await writeButton.click();
            await driver.sleep(5000); // Give more time for page to load

            // Check where we ended up
            const newUrl = await driver.getCurrentUrl();
            console.log(`📍 After clicking write button: ${newUrl}`);

            // Try to find editor
            const editorFound = await tryToFindEditor(driver, title, content);
            if (editorFound) {
              foundEditor = true;
              console.log(`✅ Found editor after clicking write button`);
            }
          }
        } catch (error) {
          console.log(
            `❌ Could not find write button or editor: ${error.message}`
          );
        }
      }
    }

    if (!foundEditor) {
      // Get page source for debugging
      const pageTitle = await driver.getTitle();
      const pageSource = await driver.getPageSource();
      console.log(`📄 Page title: ${pageTitle}`);
      console.log(`📄 Current URL: ${await driver.getCurrentUrl()}`);
      console.log(`📄 Page source length: ${pageSource.length}`);

      // If page source is very short, it might be a redirect or error page
      if (pageSource.length < 1000) {
        console.log(`📄 Page source (short page detected):`);
        console.log(pageSource.substring(0, 500));
      }

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

    // Wait for the page to fully load before looking for title input
    console.log("⏳ Waiting for page to fully load...");
    await driver.sleep(5000);

    // Find and fill the title input
    let titleInput;
    const titleSelectors = [
      'textarea[data-testid="post-title"]', // Exact match from DOM
      'textarea[id="post-title"]', // Backup by ID
      'textarea[placeholder="Title"]', // Backup by placeholder
      'textarea[placeholder*="title"]', // Case insensitive
      'h1[contenteditable="true"]', // Substack often uses contenteditable h1 for titles
      'div[contenteditable="true"]', // Or contenteditable divs
      '[contenteditable="true"]', // Any contenteditable element
      'input[placeholder*="Title"]',
      'input[placeholder*="title"]', // Case insensitive
      'input[data-testid="title-input"]',
      ".title-input input",
      'input[name="title"]',
      ".editor-title input",
      // More generic selectors
      "textarea",
      'input[type="text"]',
      ".post-title",
      '[data-testid*="title"]',
    ];

    // Try waiting for specific elements first
    try {
      console.log("🔍 Waiting for title input to appear...");
      titleInput = await driver.wait(
        until.elementLocated(
          By.css(
            'textarea[data-testid="post-title"], textarea[placeholder*="title"], textarea[placeholder*="Title"], h1[contenteditable="true"], input[placeholder*="Title"]'
          )
        ),
        10000
      );
      console.log("✅ Title input found via wait");
    } catch (waitError) {
      console.log("⚠️ Wait for title input failed, trying manual search...");

      for (const selector of titleSelectors) {
        try {
          titleInput = await driver.findElement(By.css(selector));
          console.log(`✅ Found title input with selector: ${selector}`);
          break;
        } catch (error) {
          console.log(`Title selector "${selector}" not found, trying next...`);
        }
      }
    }

    if (!titleInput) {
      // Debug: show what's actually on the page
      console.log("🔍 Title input not found, debugging page content...");
      const pageSource = await driver.getPageSource();
      console.log(`📄 Page source length: ${pageSource.length}`);

      // Look for any input or textarea elements
      const allInputs = await driver.findElements(By.css("input, textarea"));
      console.log(`🔍 Found ${allInputs.length} input/textarea elements`);

      for (let i = 0; i < Math.min(allInputs.length, 5); i++) {
        try {
          const element = allInputs[i];
          const tagName = await element.getTagName();
          const placeholder = await element.getAttribute("placeholder");
          const id = await element.getAttribute("id");
          const dataTestId = await element.getAttribute("data-testid");
          const className = await element.getAttribute("class");

          console.log(
            `Input ${i}: ${tagName}, placeholder="${placeholder}", id="${id}", data-testid="${dataTestId}", class="${className}"`
          );
        } catch (e) {
          console.log(`Input ${i}: Could not get attributes`);
        }
      }

      throw new Error("Could not find title input field");
    }

    // Check if it's a contenteditable element or regular input
    const isContentEditable = await titleInput.getAttribute("contenteditable");

    if (isContentEditable === "true") {
      // For contenteditable elements, clear and set innerHTML
      await driver.executeScript("arguments[0].innerHTML = '';", titleInput);
      await titleInput.click();
      await titleInput.sendKeys(title);
    } else {
      // For regular inputs, use clear and sendKeys
      await titleInput.clear();
      await titleInput.sendKeys(title);
    }

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
      'div[data-testid="editor"]', // Exact match from DOM
      ".tiptap.ProseMirror", // Combined class from DOM
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

    // First, look for "Continue" button to go to publish settings
    let continueButton;
    try {
      // Try multiple selectors for the Continue button
      const continueSelectors = [
        'button[data-testid="publish-button"]', // From DOM structure
        '//button[contains(text(), "Continue")]',
        '//button[normalize-space(text())="Continue"]',
        '//button[contains(text(), "Next")]',
        '//button[contains(text(), "Publish")]',
        'button[title="Continue"]',
        'button[type="submit"]',
        // Sometimes the button might be in a form
        'form button[type="submit"]',
        'button[class*="primary"]',
        'button[class*="continue"]',
      ];

      for (const selector of continueSelectors) {
        try {
          if (selector.startsWith("//")) {
            continueButton = await driver.findElement(By.xpath(selector));
          } else {
            continueButton = await driver.findElement(By.css(selector));
          }
          console.log(`✅ Found Continue button with selector: ${selector}`);
          break;
        } catch (e) {
          console.log(
            `Continue selector "${selector}" not found, trying next...`
          );
        }
      }

      if (continueButton) {
        await continueButton.click();
        console.log(`✅ Clicked Continue button`);
        await driver.sleep(3000); // Wait for publish settings page to load

        // Now we're on the publish settings page
        const publishUrl = await driver.getCurrentUrl();
        console.log(`📍 Now on publish settings page: ${publishUrl}`);
      } else {
        throw new Error("Could not find Continue button with any selector");
      }
    } catch (error) {
      console.log(`❌ Could not find Continue button: ${error.message}`);
    }

    // Find and click the final publish/save button
    let actionButton;
    const buttonSelectors = isDraft
      ? [
          'button[data-testid="save-draft"]',
          'button:contains("Save draft")',
          ".save-draft-button",
          '//button[contains(text(), "Save as draft")]',
        ]
      : [
          '//button[normalize-space(text())="Send to everyone now"]',
          '//button[contains(text(), "Send to everyone now")]',
          '//button[text()="Send to everyone now"]',
          'button[type="submit"]', // Often the publish button is a submit button
          '//button[normalize-space(text())="Publish now"]',
          '//button[contains(text(), "Publish now")]',
          'button[data-testid="publish"]',
          'button:contains("Publish")',
          ".publish-button",
          // Add more generic selectors for orange/primary buttons
          'button[class*="primary"]',
          'button[class*="orange"]',
          'button[class*="submit"]',
        ];

    for (const selector of buttonSelectors) {
      try {
        if (selector.startsWith("//")) {
          // Use XPath for XPath selectors
          actionButton = await driver.findElement(By.xpath(selector));
        } else if (selector.includes(":contains(")) {
          // Use XPath for text-based selectors
          const text = selector.match(/:contains\("([^"]+)"\)/)[1];
          actionButton = await driver.findElement(
            By.xpath(`//button[contains(text(), "${text}")]`)
          );
        } else {
          actionButton = await driver.findElement(By.css(selector));
        }
        console.log(`✅ Found publish button with selector: ${selector}`);
        break;
      } catch (error) {
        console.log(`Button selector "${selector}" not found, trying next...`);
      }
    }

    if (!actionButton) {
      // Fallback: look for any button that might be the publish/save button
      console.log(
        "🔍 No button found with specific selectors, scanning all buttons..."
      );
      const buttons = await driver.findElements(By.css("button"));
      console.log(`Found ${buttons.length} buttons on page`);

      for (let i = 0; i < buttons.length; i++) {
        try {
          const button = buttons[i];
          const buttonText = await button.getText();
          const buttonClass = await button.getAttribute("class");
          const buttonType = await button.getAttribute("type");

          console.log(
            `Button ${i}: text="${buttonText}", class="${buttonClass}", type="${buttonType}"`
          );

          if (
            (isDraft &&
              (buttonText.toLowerCase().includes("save") ||
                buttonText.toLowerCase().includes("draft"))) ||
            (!isDraft &&
              (buttonText.toLowerCase().includes("send to everyone now") ||
                buttonText.toLowerCase().includes("publish") ||
                buttonText.toLowerCase().includes("continue")))
          ) {
            actionButton = button;
            console.log(`✅ Found matching button: "${buttonText}"`);
            break;
          }
        } catch (error) {
          console.log(
            `Button ${i}: Could not get attributes - ${error.message}`
          );
          continue;
        }
      }
    }

    if (!actionButton) {
      throw new Error(
        `Could not find ${isDraft ? "save draft" : "publish"} button`
      );
    }

    // Check for any alert dialogs first
    try {
      const alert = await driver.switchTo().alert();
      const alertText = await alert.getText();
      console.log(`⚠️ Alert detected: "${alertText}"`);
      await alert.accept(); // Accept/dismiss the alert
      console.log(`✅ Alert dismissed`);
      await driver.sleep(2000);
    } catch (error) {
      // No alert present, continue normally
    }

    // Scroll to the button to make sure it's visible
    await driver.executeScript(
      "arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});",
      actionButton
    );
    await driver.sleep(2000); // Wait for scroll to complete

    // Try to make the button interactable
    try {
      // Wait for the button to be clickable
      await driver.wait(until.elementIsEnabled(actionButton), 5000);
      await driver.wait(until.elementIsVisible(actionButton), 5000);

      // Try regular click first
      await actionButton.click();
      console.log(`✅ Clicked ${isDraft ? "save draft" : "publish"} button`);
    } catch (clickError) {
      console.log(
        `⚠️ Regular click failed, trying JavaScript click: ${clickError.message}`
      );
      // Fallback to JavaScript click if regular click fails
      await driver.executeScript("arguments[0].click();", actionButton);
      console.log(
        `✅ JavaScript clicked ${isDraft ? "save draft" : "publish"} button`
      );
    }

    // Wait for the action to complete
    await driver.sleep(3000);

    // For publish actions, check if there's a subscribe buttons popup modal
    if (!isDraft) {
      console.log(
        "✅ Post publishing initiated, checking for subscribe buttons popup..."
      );

      try {
        // Look for the subscribe buttons popup modal
        const modal = await driver.findElement(
          By.xpath(
            '//div[contains(text(), "Add subscribe buttons to your post")]'
          )
        );
        console.log("🔍 Found subscribe buttons popup modal");

        // Look for "Publish without buttons" button
        const publishWithoutButtonsSelectors = [
          '//button[contains(text(), "Publish without buttons")]',
          '//button[normalize-space(text())="Publish without buttons"]',
          'button[data-testid="publish-without-buttons"]',
        ];

        let publishWithoutButtonsBtn = null;
        for (const selector of publishWithoutButtonsSelectors) {
          try {
            publishWithoutButtonsBtn = await driver.findElement(
              By.xpath(selector)
            );
            console.log(
              `✅ Found "Publish without buttons" button with selector: ${selector}`
            );
            break;
          } catch (e) {
            console.log(`Selector "${selector}" not found, trying next...`);
          }
        }

        if (publishWithoutButtonsBtn) {
          await publishWithoutButtonsBtn.click();
          console.log(
            "✅ Clicked 'Publish without buttons' - post should now be published"
          );
          await driver.sleep(3000); // Wait for final publish to complete
        } else {
          console.log(
            "⚠️ Could not find 'Publish without buttons' button, trying 'Add subscribe buttons'"
          );

          // Fallback: try clicking "Add subscribe buttons"
          const addSubscribeButtonsSelectors = [
            '//button[contains(text(), "Add subscribe buttons")]',
            '//button[normalize-space(text())="Add subscribe buttons"]',
            'button[data-testid="add-subscribe-buttons"]',
          ];

          let addSubscribeBtn = null;
          for (const selector of addSubscribeButtonsSelectors) {
            try {
              addSubscribeBtn = await driver.findElement(By.xpath(selector));
              console.log(
                `✅ Found "Add subscribe buttons" button with selector: ${selector}`
              );
              break;
            } catch (e) {
              console.log(`Selector "${selector}" not found, trying next...`);
            }
          }

          if (addSubscribeBtn) {
            await addSubscribeBtn.click();
            console.log(
              "✅ Clicked 'Add subscribe buttons' - post should now be published"
            );
            await driver.sleep(3000);
          }
        }
      } catch (error) {
        console.log(
          "ℹ️ No subscribe buttons popup found, post may have published directly"
        );
        await driver.sleep(3000);
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

/**
 * Updates session status manually (useful for avoiding re-authentication)
 * @param {string} sessionId - Browser session ID
 * @param {Object} updatedSession - Updated session data
 * @returns {Promise<boolean>} Success status
 */
async function updateSessionStatus(sessionId, updatedSession) {
  try {
    // Update persistent storage
    await sessionStore.saveSession(sessionId, updatedSession);

    // If there's an active session, update it too
    const activeSession = activeSessions.get(sessionId);
    if (activeSession) {
      activeSession.status = updatedSession.status;
      activeSession.userData = updatedSession.userData;
    }

    console.log(
      `✅ Updated session ${sessionId} status to: ${updatedSession.status}`
    );
    return true;
  } catch (error) {
    console.error("Error updating session status:", error);
    throw error;
  }
}

// Cleanup old sessions every 24 hours (once per day)
setInterval(cleanupOldSessions, 24 * 60 * 60 * 1000);

/**
 * Helper function to handle the publish process after content is filled
 * @param {WebDriver} driver - Selenium WebDriver instance
 * @param {string} title - Post title
 * @param {string} content - Post content
 * @param {string} currentUrl - Current page URL
 * @returns {Promise<Object>} Publish result
 */
async function handlePublishProcess(driver, title, content, currentUrl) {
  try {
    // Look for Continue/Publish button
    console.log(`🔍 Looking for Continue or Publish button...`);

    const continueSelectors = [
      'button[data-testid="publish-button"]',
      '//button[contains(text(), "Continue")]',
      '//button[contains(text(), "Next")]',
      'button[data-testid="publish"]',
    ];

    let continueClicked = false;
    for (const selector of continueSelectors) {
      try {
        const button = selector.startsWith("//")
          ? await driver.findElement(By.xpath(selector))
          : await driver.findElement(By.css(selector));

        console.log(`✅ Found Continue button with selector: ${selector}`);
        await button.click();
        console.log(`✅ Clicked Continue button`);
        continueClicked = true;
        await driver.sleep(3000);
        break;
      } catch (e) {
        console.log(`Button selector "${selector}" not found, trying next...`);
        continue;
      }
    }

    if (continueClicked) {
      const newUrl = await driver.getCurrentUrl();
      console.log(`📍 Now on publish settings page: ${newUrl}`);

      // Look for final publish button
      const publishSelectors = [
        '//button[normalize-space(text())="Send to everyone now"]',
        '//button[contains(text(), "Send to everyone now")]',
        '//button[contains(text(), "Publish now")]',
        'button[data-testid="final-publish"]',
      ];

      for (const selector of publishSelectors) {
        try {
          const publishButton = await driver.findElement(By.xpath(selector));
          console.log(`✅ Found publish button with selector: ${selector}`);
          await publishButton.click();
          console.log(`✅ Clicked publish button`);
          break;
        } catch (e) {
          console.log(
            `Button selector "${selector}" not found, trying next...`
          );
          continue;
        }
      }
    } else {
      console.log(
        `⚠️ Could not find Continue button, post may be saved as draft`
      );
    }

    console.log(`🎉 Substack post published: "${title}"`);

    return {
      success: true,
      title,
      subtitle: "",
      content: content.substring(0, 100) + (content.length > 100 ? "..." : ""),
      isDraft: !continueClicked,
      postUrl: await driver.getCurrentUrl(),
      message: continueClicked
        ? "Post published successfully"
        : "Post saved as draft",
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`Error in publish process:`, error);
    throw new Error(`Failed to publish post: ${error.message}`);
  }
}

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
  updateSessionStatus,
  refreshSessionAuth,
  shouldRefreshAuth,
};
