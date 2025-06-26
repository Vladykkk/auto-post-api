# Social Media OAuth Backend

A clean, modular Node.js backend for social media authentication and posting with LinkedIn and X (Twitter).

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Setup

Create a `.env` file:

You can see example what to put inside of your `.env` file, in `.env.example`

### 3. OAuth App Setup

**LinkedIn:**

1. Go to [LinkedIn Developer Portal](https://www.linkedin.com/developers/)
2. Create new app with "Sign In with LinkedIn using OpenID Connect"
3. Set redirect URI: `http://localhost:3000/auth/linkedin/callback`

**X (Twitter):**

1. Go to [X Developer Portal](https://developer.twitter.com/en/portal/dashboard)
2. Create new app with OAuth 2.0 enabled
3. Set redirect URI: `http://localhost:3000/auth/x/callback`
4. Enable scopes: `tweet.read`, `tweet.write`, `users.read`

### 4. Run Server

```bash
# Development mode
npm run dev

# Production mode
npm start
```

## 🛠️ Technologies Used

- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **JWT** - Token-based authentication
- **OAuth 2.0** - Social media authentication
- **Axios** - HTTP client
- **Multer** - File upload handling
- **CORS** - Cross-origin resource sharing

## 📍 API Endpoints

### Authentication

- `GET /auth/linkedin` - LinkedIn OAuth login
- `GET /auth/x` - X (Twitter) OAuth login

### User Info

- `GET /api/linkedin/user` - Get LinkedIn user info
- `GET /api/x/user` - Get X user info

### Posts

- `POST /api/posts/linkedin/post` - Create LinkedIn post
- `POST /api/posts/x/tweet` - Create X tweet
- `POST /api/posts/linkedin/upload` - Upload LinkedIn media
- `POST /api/posts/x/upload` - Upload X media

### Logout

- `POST /api/auth/linkedin/logout` - LinkedIn logout
- `POST /api/auth/x/logout` - X logout

## 🔧 Features

- ✅ **Multi-platform OAuth** (LinkedIn & X)
- ✅ **Extended X token expiration** (configurable, default 7 days)
- ✅ **Automatic token refresh** for X
- ✅ **File upload support** (images/videos)
- ✅ **Modular architecture** with clean separation
- ✅ **Error handling** with consistent API responses
- ✅ **Security best practices** (CORS, JWT, input validation)

## 📱 Frontend Integration

After OAuth login, users are redirected to your frontend with a JWT token:

```
http://localhost:5173/?token=JWT_TOKEN&provider=linkedin
```

Use the token in API requests:

```javascript
headers: {
  'Authorization': `Bearer ${token}`
}
```

## 🏗️ Project Structure

```
src/
├── controllers/          # Request handlers
├── services/            # Business logic & API calls
├── routes/              # Route definitions
├── middleware/          # Authentication & error handling
├── config/              # Environment configuration
└── utils/               # Helper functions
```

---

**License:** ISC
