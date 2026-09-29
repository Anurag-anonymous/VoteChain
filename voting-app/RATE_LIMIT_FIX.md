# HTTP 429 Rate Limiting Fix

## Problem
After the VoteChain voting app runs for a while, users encounter persistent HTTP 429 "Too Many Requests" errors on endpoints like `/api/auth/login`, `/api/polls`, and other API routes. This causes the app to become unresponsive.

## Root Cause
The backend rate limiter was configured with production-level limits even in development mode:
- **Global rate limiter**: 100 requests per 15 minutes (≈6-7 requests/sec)
- **Login rate limiter**: 5 failed attempts per 15 minutes
- The `loginLimiter` was defined but not wired to auth routes, so login attempts consumed the global limit quota quickly

Combined with frontend retry logic that lacked exponential backoff and max retry counts, this created a retry storm that exhausted the rate limit quota.

## Solution Implemented

### 1. Backend Rate Limiter Configuration (`backend/src/server.js`)
- **Development mode** (`NODE_ENV=development`): Disabled rate limiting entirely (`skip: true`) with high limits (1000 req/min) for development flexibility
- **Production mode**: Kept strict limits (100/15min global, 5/15min login)
- Added `skipSuccessfulRequests: true` to `loginLimiter` to only count failed login attempts

**Key changes:**
```javascript
const isDevelopment = process.env.NODE_ENV === 'development';

const limiter = rateLimit({
  windowMs: isDevelopment ? 60 * 1000 : 15 * 60 * 1000,
  max: isDevelopment ? 1000 : 100,
  skip: isDevelopment  // Disable in development
});

const loginLimiter = rateLimit({
  windowMs: isDevelopment ? 60 * 1000 : 15 * 60 * 1000,
  max: isDevelopment ? 100 : 5,
  skipSuccessfulRequests: true,
  skip: isDevelopment  // Disable in development
});
```

### 2. Wire Login Limiter to Auth Routes (`backend/src/routes/auth.js`)
- Imported `loginLimiter` from server and applied it to sensitive auth endpoints:
  - `POST /api/auth/login`
  - `POST /api/auth/reset-password-request`

**Key changes:**
```javascript
const { loginLimiter } = require('../server');

router.post('/login', loginLimiter, AuthController.login);
router.post('/reset-password-request', loginLimiter, AuthController.resetPasswordRequest);
```

### 3. Frontend Exponential Backoff (`frontend/src/services/api.js`)
- Added exponential backoff helper with max retry limit (3 retries)
- Handles both 401 (token expiration) and 429 (rate limit) responses
- Prevents retry storms with increasing delays: 1s → 2s → 4s → 8s (capped at 32s)

**Key changes:**
```javascript
const exponentialBackoff = (retryCount) => {
  const baseDelay = 1000; // 1 second
  const maxDelay = 32000; // 32 seconds
  const delay = Math.min(baseDelay * Math.pow(2, retryCount - 1), maxDelay);
  return new Promise(resolve => setTimeout(resolve, delay));
};

// Handle 429 (rate limit) with exponential backoff
if (error.response?.status === 429 && retryCount < maxRetries) {
  originalRequest._retryCount = retryCount + 1;
  await exponentialBackoff(retryCount + 1);
  return api(originalRequest);
}
```

## Environment Setup

### Development (Default - Rate Limiting Disabled)
```bash
NODE_ENV=development
```
No rate limiting applied; requests flow freely. Ideal for development and testing.

### Production (Strict Rate Limiting)
```bash
NODE_ENV=production
```
- Global: 100 requests per 15 minutes
- Login/Reset: 5 failed attempts per 15 minutes
- Clients must implement exponential backoff for 429 responses

## Verification

### Run Tests
```bash
cd backend
npm test -- --runInBand src/__tests__/researchProtocolApi.test.js src/__tests__/phase2Protocol.test.js
```
Expected: All tests pass (29 passed, 29 total)

### Lint Check
```bash
cd backend
npm run lint
```
Expected: No errors or warnings

### Start Application
```bash
# Backend
cd backend
npm start

# Frontend (in another terminal)
cd frontend
npm start
```

## How to Continue Building Elsewhere

### Option 1: Clone the Repository
```bash
git clone https://github.com/Anurag-anonymous/VoteChain.git
cd VoteChain/voting-app
```

### Option 2: Archive and Transfer
```bash
# On current machine
cd C:\Users\panur\DWEB
tar -czf voting-app-with-fixes.tar.gz voting-app/

# Transfer voting-app-with-fixes.tar.gz to your new machine
# On new machine
tar -xzf voting-app-with-fixes.tar.gz
cd voting-app
```

### Option 3: Setup from GitHub
If you push the current state to GitHub:
```bash
# On current machine
cd C:\Users\panur\DWEB\voting-app
git add .
git commit -m "feat: implement C0/C1 revoting and fix 429 rate limiting

- Add C1_REVOTING_ENABLED flag for replacement ballot voting
- Wire loginLimiter to /api/auth routes
- Add development/production rate limiter configuration
- Implement exponential backoff with max retries on frontend
- Tests: 29 passed; Lint: passed

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"

git push origin main

# On new machine
git clone https://github.com/Anurag-anonymous/VoteChain.git
cd VoteChain/voting-app
```

## Backend Setup on New Machine
```bash
cd voting-app/backend

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env and set NODE_ENV=development for development

# Run migrations (if any)
npm run migrate

# Start the server
npm start
```

## Frontend Setup on New Machine
```bash
cd voting-app/frontend

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env if needed (default REACT_APP_API_URL=http://localhost:5000/api)

# Start the dev server
npm start
```

## Key Files Changed
1. **backend/src/server.js**: Environment-aware rate limiter configuration
2. **backend/src/routes/auth.js**: Wire loginLimiter to auth endpoints
3. **frontend/src/services/api.js**: Exponential backoff retry logic
4. **backend/.env.example**: Already documents C0/C1 flags

## Testing Checklist
- [ ] Backend tests pass: `npm test`
- [ ] Linting passes: `npm run lint`
- [ ] Frontend can login without 429 errors
- [ ] Multiple rapid login attempts don't trigger 429 in development
- [ ] Production environment properly enforces rate limits
- [ ] Revoting C0/C1 conditions work correctly

## Notes
- In development mode, rate limiting is completely disabled to avoid friction during development
- In production, rate limiting is strict—ensure frontend implements proper backoff
- The `skipSuccessfulRequests: true` option only counts failed login attempts, not successful ones
- Exponential backoff with cap prevents infinite retry loops on persistent failures
