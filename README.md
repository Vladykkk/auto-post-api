# Social Media OAuth Backend

Node.js backend for social media authentication and posting with LinkedIn, X (Twitter), and Substack automation.

## 🛠️ Technologies

- **Node.js** + **Express.js** - Server framework
- **JWT** + **OAuth 2.0** - Authentication
- **Selenium WebDriver** - Substack automation
- **Multer** - File uploads
- **Axios** - HTTP client

## ⚡ Quick Setup

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Environment setup:**

   ```bash
   cp .env.example .env
   # Fill in your OAuth credentials
   ```

3. **OAuth apps setup:**

   - **LinkedIn:** [Developer Portal](https://www.linkedin.com/developers/) → Redirect URI: `http://localhost:3000/auth/linkedin/callback`
   - **X (Twitter):** [Developer Portal](https://developer.twitter.com/en/portal/dashboard) → Redirect URI: `http://localhost:3000/auth/x/callback`

4. **Run server:**
   ```bash
   npm run dev  # Development
   npm start    # Production
   ```

## 📍 API Endpoints

### Authentication

| Method | Endpoint                    | Description             |
| ------ | --------------------------- | ----------------------- |
| GET    | `/auth/linkedin`            | LinkedIn OAuth login    |
| GET    | `/auth/x`                   | X (Twitter) OAuth login |
| POST   | `/api/auth/linkedin/logout` | LinkedIn logout         |
| POST   | `/api/auth/x/logout`        | X logout                |

### User Info

| Method | Endpoint             | Description            |
| ------ | -------------------- | ---------------------- |
| GET    | `/api/linkedin/user` | Get LinkedIn user info |
| GET    | `/api/x/user`        | Get X user info        |

### Posts & Media

| Method | Endpoint                     | Description           |
| ------ | ---------------------------- | --------------------- |
| POST   | `/api/posts/linkedin/post`   | Create LinkedIn post  |
| POST   | `/api/posts/linkedin/upload` | Upload LinkedIn media |
| POST   | `/api/posts/x/tweet`         | Create X tweet        |
| POST   | `/api/posts/x/upload`        | Upload X media        |

### Substack Automation

| Method | Endpoint                    | Description              |
| ------ | --------------------------- | ------------------------ |
| POST   | `/api/substack/session`     | Create browser session   |
| POST   | `/api/substack/login`       | Initiate email login     |
| POST   | `/api/substack/verify`      | Submit verification code |
| POST   | `/api/substack/post`        | Create/publish post      |
| GET    | `/api/substack/sessions`    | List all sessions        |
| GET    | `/api/substack/session/:id` | Get session status       |
| DELETE | `/api/substack/session/:id` | Close session            |

## 🔧 Key Features

- **Multi-platform OAuth** (LinkedIn & X)
- **Automatic token refresh** for X
- **File upload support** (images/videos)
- **Substack automation** with persistent sessions
- **Modular architecture** with clean separation
- **Security best practices** (CORS, JWT, input validation)

## 📱 Frontend Integration

After OAuth login, users are redirected with JWT token:

```
http://localhost:5173/?token=JWT_TOKEN&provider=linkedin
```

Use token in API requests:

```javascript
headers: { 'Authorization': `Bearer ${token}` }
```

## 🏗️ Project Structure

```
src/
├── controllers/     # Request handlers
├── services/        # Business logic & API calls
├── routes/          # Route definitions
├── middleware/      # Auth & error handling
├── config/          # Environment config
└── utils/           # Helper functions
```

---

**License:** ISC
