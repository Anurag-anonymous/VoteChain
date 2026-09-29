# VoteChain C0/C1 Revoting + Rate Limit Fix - Quick Start Guide

## Summary of Changes

### 1. C0/C1 Revoting Implementation (Previously Completed)
- **C0** (Control): One ballot per voter, no revoting allowed
- **C1** (Experimental): Voters can submit replacement ballots while poll is active; only final ballot counts
- **Flag**: `C1_REVOTING_ENABLED=true` in `.env` to enable revoting
- **Status**: ✅ 28 tests passing, lint passing

### 2. HTTP 429 Rate Limit Fix (Just Completed)
- **Problem**: App gets 429 "Too Many Requests" errors after running for a while
- **Solution**: 
  - Development mode: Rate limiting disabled (skip: true)
  - Production mode: Strict limits enforced
  - Frontend: Exponential backoff with max 3 retries
- **Status**: ✅ All tests passing, lint passing

## Essential Commands

### Run Tests
```bash
cd C:\Users\panur\DWEB\voting-app\backend
npm test -- --runInBand src/__tests__/researchProtocolApi.test.js src/__tests__/phase2Protocol.test.js
```

### Run Linter
```bash
cd C:\Users\panur\DWEB\voting-app\backend
npm run lint
```

### Start Backend (Development)
```bash
cd C:\Users\panur\DWEB\voting-app\backend
npm start
```
This automatically sets NODE_ENV=development and disables rate limiting.

### Start Frontend
```bash
cd C:\Users\panur\DWEB\voting-app\frontend
npm start
```

## Environment Variables

### Backend (.env)
```
NODE_ENV=development                    # Disables rate limiting
C1_REVOTING_ENABLED=true               # Enable replacement ballots
C1_CHAIN_RECEIPTS_ENABLED=false        # Keep database-only for minimum cost
C0_PROTOCOL_ENABLED=true               # Enable encrypted voting
```

### Frontend (.env)
```
REACT_APP_API_URL=http://localhost:5000/api
```

## Files Modified

### Backend
- `src/server.js`: Environment-aware rate limiter config
- `src/routes/auth.js`: Wire loginLimiter to auth endpoints
- `.env.example`: Already has C0/C1 flags documented

### Frontend
- `src/services/api.js`: Exponential backoff retry logic

## Continuation Commands for New Machine

### Via Git
```bash
# Push current state
cd C:\Users\panur\DWEB\voting-app
git add .
git commit -m "feat: C0/C1 revoting and 429 rate limit fix"
git push origin main

# On new machine
git clone https://github.com/Anurag-anonymous/VoteChain.git
cd VoteChain/voting-app
```

### Via Archive
```bash
# Current machine
cd C:\Users\panur\DWEB
tar -czf voting-app-with-fixes.tar.gz voting-app/

# Transfer file, then on new machine
tar -xzf voting-app-with-fixes.tar.gz
cd voting-app
```

## Quick Verification

After setup on new machine:
```bash
# Backend setup
cd voting-app/backend
npm install
cp .env.example .env
npm test
npm run lint
npm start

# Frontend setup (separate terminal)
cd voting-app/frontend
npm install
cp .env.example .env
npm start
```

Expected results:
- ✅ 29 tests passing
- ✅ Linting passes
- ✅ No 429 errors during login/polling
- ✅ C0/C1 revoting works as expected

## Key Implementation Details

### Rate Limiter Logic (server.js)
```javascript
const isDevelopment = process.env.NODE_ENV === 'development';

// Development: skip=true (disabled), production: enforce limits
const limiter = rateLimit({
  max: isDevelopment ? 1000 : 100,
  skip: isDevelopment
});
```

### Retry Logic (frontend api.js)
```javascript
// Exponential backoff: 1s, 2s, 4s, 8s... (max 32s)
const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 32000);
// Max 3 retries for 401 and 429 errors
if (retryCount < 3) { /* retry */ }
```

### Auth Middleware (routes/auth.js)
```javascript
router.post('/login', loginLimiter, AuthController.login);
router.post('/reset-password-request', loginLimiter, AuthController.resetPasswordRequest);
```

## Production Deployment Notes

When deploying to production:
1. Set `NODE_ENV=production` in backend `.env`
2. Rate limits will be enforced: 100 req/15min globally, 5 failed logins/15min
3. Frontend exponential backoff ensures clients respect these limits
4. Monitor logs for rate limit hits; they indicate either legitimate traffic spike or DDoS

## Troubleshooting

### Still Getting 429 Errors?
1. Verify `NODE_ENV=development` in backend `.env`
2. Restart backend: `npm start`
3. Clear browser cache and restart frontend
4. Check backend logs for rate limiter being triggered

### Tests Failing?
```bash
npm test -- --runInBand
# Run one test file at a time
npm test -- src/__tests__/researchProtocolApi.test.js
```

### Linting Issues?
```bash
npm run lint -- --fix
# Auto-fix common style issues
```
