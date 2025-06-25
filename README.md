# Social Media OAuth 2.0 Authentication - Node.js Backend

This project implements LinkedIn and X (Twitter) OAuth 2.0 authentication in Node.js using Express, following modern best practices with a clean, modular architecture for auto-posting capabilities.

## 🏗️ **Architecture & Features**

### **Modular Structure**

- **Clean separation of concerns** with dedicated modules
- **Service layer** for business logic
- **Controller layer** for request handling
- **Middleware** for authentication and error handling
- **Configuration management** with validation
- **Consistent API responses** with standardized formatting

### **Key Features**

- ✅ **LinkedIn OAuth 2.0** authentication flow (OpenID Connect)
- ✅ **X (Twitter) OAuth 2.0** authentication with PKCE
- ✅ **Multi-platform posting** (LinkedIn posts & Twitter tweets)
- ✅ JWT token generation and validation
- ✅ Automatic frontend redirect after login
- ✅ Comprehensive error handling with platform-specific responses
- ✅ CORS configuration for cross-origin requests
- ✅ Security headers and best practices
- ✅ Environment-based configuration with validation
- ✅ Graceful server shutdown
- ✅ Request logging in development mode

## 📁 **Project Structure**

```
auto-post-be/
├── app.js                          # Main application entry point
├── server-old.js                   # Legacy monolithic version (backup)
├── package.json                    # Dependencies and scripts
├── .env                           # Environment variables (create from .env.example)
├── .gitignore                     # Git ignore rules
└── src/                           # Source code
    ├── config/
    │   └── environment.js         # Environment configuration with validation
    ├── controllers/
    │   └── authController.js      # Authentication request handlers
    ├── middleware/
    │   ├── auth.js               # JWT authentication middleware
    │   └── errorHandler.js       # Centralized error handling
    ├── routes/
    │   ├── index.js              # Main routes configuration
    │   └── auth.js               # Authentication routes
    ├── services/
    │   ├── authService.js        # JWT operations and auth utilities
    │   ├── linkedinService.js    # LinkedIn API interactions
    │   └── xService.js           # X (Twitter) API interactions with PKCE
    └── utils/
        └── response.js           # Standardized API response helpers
```

## 🚀 **Installation & Setup**

### 1. **Install Dependencies**

```bash
npm install
```

### 2. **Environment Configuration**

```bash
# Copy the example environment file
cp .env.example .env
```

### 3. **Configure LinkedIn App**

- Go to [LinkedIn Developer Portal](https://www.linkedin.com/developers/)
- Create a new app
- Enable "Sign In with LinkedIn using OpenID Connect"
- Set redirect URI: `http://localhost:3000/auth/linkedin/callback`

### 4. **Configure X (Twitter) App**

- Go to [X Developer Portal](https://developer.twitter.com/en/portal/dashboard)
- Create a new app (or use existing)
- Enable OAuth 2.0 authentication
- Set redirect URI: `http://localhost:3000/auth/x/callback`
- Enable required scopes: `tweet.read`, `tweet.write`, `users.read`

### 5. **Update Environment Variables**

```env
# LinkedIn OAuth Configuration
LINKEDIN_CLIENT_ID=your_actual_linkedin_client_id
LINKEDIN_CLIENT_SECRET=your_actual_linkedin_client_secret
REDIRECT_URI=http://localhost:3000/auth/linkedin/callback

# X (Twitter) OAuth Configuration
X_CLIENT_ID=your_actual_x_client_id
X_CLIENT_SECRET=your_actual_x_client_secret
X_REDIRECT_URI=http://localhost:3000/auth/x/callback

# JWT Configuration
JWT_SECRET=your_secure_jwt_secret_64_chars_minimum
JWT_EXPIRES_IN=24h

# Server Configuration
FRONTEND_URL=http://localhost:5173
PORT=3000
NODE_ENV=development
```

## 🎯 **Usage**

### **Start the Server**

```bash
# Production mode
npm start

# Development mode (with auto-reload)
npm run dev

# Legacy version (if needed)
npm run start:legacy
```

### **Server Output**

```
🚀 Social Media OAuth Server Started
==================================================
📍 Server: http://localhost:3000
🔗 LinkedIn OAuth: http://localhost:3000/auth/linkedin
🔗 X (Twitter) OAuth: http://localhost:3000/auth/x
🌍 Environment: development
🎯 Frontend URL: http://localhost:5173
==================================================
```

## 🛣️ **API Endpoints**

### **LinkedIn Authentication**

- **GET `/auth/linkedin`** - Initiates LinkedIn OAuth flow
- **GET `/auth/linkedin/callback`** - Handles OAuth callback from LinkedIn

### **X (Twitter) Authentication**

- **GET `/auth/x`** - Initiates X OAuth flow with PKCE
- **GET `/auth/x/callback`** - Handles OAuth callback from X

### **Protected Endpoints** (Require `Authorization: Bearer <token>` header)

#### **LinkedIn Endpoints**

- **GET `/api/linkedin/user`** - Get user info from JWT token (fast, no API calls)
- **GET `/api/linkedin/user/refresh`** - Refresh user profile from LinkedIn API
- **GET `/api/linkedin/profile`** - Get detailed profile (alias for refresh)
- **POST `/api/posts/linkedin/post`** - Create LinkedIn post

#### **X (Twitter) Endpoints**

- **GET `/api/x/user`** - Get X user info from JWT token (fast, no API calls)
- **GET `/api/x/user/refresh`** - Refresh user profile from X API
- **POST `/api/posts/x/tweet`** - Create X tweet

#### **Common Endpoints**

- **POST `/api/auth/linkedin/logout`** - Logout (invalidate LinkedIn token)
- **POST `/api/auth/x/logout`** - Logout (invalidate X token)

### **Public Endpoints**

- **GET `/`** - Health check and API information

## 📱 **Frontend Integration**

### **Complete Authentication Flow**

```javascript
// 1. Initiate login
function loginWithLinkedIn() {
  window.location.href = "http://localhost:3000/auth/linkedin";
}

function loginWithX() {
  window.location.href = "http://localhost:3000/auth/x";
}

// 2. Handle redirect in your app root (e.g., App.jsx)
import { useEffect, useState } from "react";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    handleAuthCallback();
    checkExistingAuth();
  }, []);

  // Handle OAuth callback
  const handleAuthCallback = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get("token");
    const provider = urlParams.get("provider"); // 'linkedin' or 'x'

    if (token) {
      localStorage.setItem("authToken", token);
      localStorage.setItem("authProvider", provider || "linkedin");
      // Clean URL
      window.history.replaceState({}, document.title, window.location.pathname);
      fetchUserInfo(token, provider);
    }
  };

  // Check for existing authentication
  const checkExistingAuth = () => {
    const token = localStorage.getItem("authToken");
    const provider = localStorage.getItem("authProvider");
    if (token) {
      fetchUserInfo(token, provider);
    } else {
      setLoading(false);
    }
  };

  // Fetch user information
  const fetchUserInfo = async (token, provider = "linkedin") => {
    try {
      const endpoint =
        provider === "x"
          ? "http://localhost:3000/api/x/user"
          : "http://localhost:3000/api/linkedin/user";

      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await response.json();
      if (data.success) {
        setUser({ ...data.data, provider });
      } else {
        localStorage.removeItem("authToken");
        localStorage.removeItem("authProvider");
      }
    } catch (error) {
      console.error("Auth error:", error);
      localStorage.removeItem("authToken");
      localStorage.removeItem("authProvider");
    }
    setLoading(false);
  };

  // Logout
  const logout = () => {
    localStorage.removeItem("authToken");
    localStorage.removeItem("authProvider");
    setUser(null);
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      {user ? (
        <div>
          <h1>Welcome, {user.name}!</h1>
          <p>Platform: {user.provider === "x" ? "X (Twitter)" : "LinkedIn"}</p>
          {user.username && <p>@{user.username}</p>}
          <p>Email: {user.email || "Not available"}</p>
          {user.tokenExpires && (
            <p>Token expires: {new Date(user.tokenExpires).toLocaleString()}</p>
          )}
          <button onClick={logout}>Logout</button>
        </div>
      ) : (
        <div>
          <h1>Please log in</h1>
          <button onClick={loginWithLinkedIn}>Login with LinkedIn</button>
          <button onClick={loginWithX}>Login with X (Twitter)</button>
        </div>
      )}
    </div>
  );
}
```

## 🔒 **Security Features**

- ✅ **Environment variable validation**
- ✅ **JWT token expiration handling**
- ✅ **CORS configuration** with specific origins
- ✅ **Security headers** (XSS Protection, Content-Type Options, Frame Options)
- ✅ **Input validation** and sanitization
- ✅ **Error message sanitization** (no sensitive data exposure)
- ✅ **Graceful error handling** with proper status codes

## 🧪 **Response Format**

All API endpoints return standardized responses:

### **Success Response**

```json
{
  "success": true,
  "data": {
    "id": "linkedin_user_id",
    "name": "John Doe",
    "email": "john@example.com",
    "loginTime": "2024-01-15T10:30:00.000Z",
    "tokenExpires": "2024-01-16T10:30:00.000Z"
  },
  "message": "User information retrieved"
}
```

### **Error Response**

```json
{
  "success": false,
  "message": "Invalid or expired token",
  "meta": {
    "error": "Token verification failed: jwt expired"
  }
}
```

## 🛠️ **Development**

### **Key Improvements in Refactored Version**

1. **Modular Architecture** - Separated concerns into dedicated modules
2. **Better Error Handling** - Centralized error management with proper logging
3. **Configuration Management** - Environment validation and organized config
4. **Security Enhancements** - Added security headers and better auth handling
5. **Code Documentation** - JSDoc comments for all functions and modules
6. **Consistent Responses** - Standardized API response format
7. **Graceful Shutdown** - Proper server lifecycle management

### **Migration from Legacy Version**

The original `server.js` has been backed up as `server-old.js`. The new modular version (`app.js`) maintains full API compatibility while providing better maintainability.

## 🚨 **Troubleshooting**

### **Common Issues**

1. **"LinkedIn OAuth not configured"**

   - Ensure `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` are set in `.env`

2. **"Invalid redirect URI"**

   - Verify redirect URI in LinkedIn app matches: `http://localhost:3000/auth/linkedin/callback`

3. **"Access token required"**

   - Ensure frontend sends `Authorization: Bearer <token>` header

4. **CORS errors**
   - Check that your frontend URL is included in the CORS origins list

## 📝 **Environment Variables Reference**

| Variable                 | Required | Default                                        | Description                        |
| ------------------------ | -------- | ---------------------------------------------- | ---------------------------------- |
| `LINKEDIN_CLIENT_ID`     | ✅       | -                                              | LinkedIn app client ID             |
| `LINKEDIN_CLIENT_SECRET` | ✅       | -                                              | LinkedIn app client secret         |
| `JWT_SECRET`             | ✅       | -                                              | Secret for JWT signing (64+ chars) |
| `REDIRECT_URI`           | ❌       | `http://localhost:3000/auth/linkedin/callback` | OAuth redirect URI                 |
| `FRONTEND_URL`           | ❌       | `http://localhost:5173`                        | Frontend application URL           |
| `JWT_EXPIRES_IN`         | ❌       | `24h`                                          | JWT token expiration time          |
| `PORT`                   | ❌       | `3000`                                         | Server port                        |
| `NODE_ENV`               | ❌       | `development`                                  | Environment mode                   |

## 📄 **License**

This project is licensed under the ISC License.
