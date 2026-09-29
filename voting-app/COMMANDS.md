# VoteChain Essential Commands Reference

## Development Workflow

### Backend Setup & Run
```bash
cd C:\Users\panur\DWEB\voting-app\backend

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Run tests
npm test

# Run specific test file
npm test -- --runInBand src/__tests__/researchProtocolApi.test.js

# Run linter
npm run lint

# Fix linting issues automatically
npm run lint -- --fix

# Start backend (development mode, rate limiting disabled)
npm start

# Start backend with debug logging
NODE_DEBUG=* npm start
```

### Frontend Setup & Run
```bash
cd C:\Users\panur\DWEB\voting-app\frontend

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Start development server
npm start

# Build for production
npm run build
```

## Testing

### Run All Tests
```bash
cd C:\Users\panur\DWEB\voting-app\backend
npm test
```

### Run Specific Test Suite
```bash
# Research protocol tests
npm test -- --runInBand src/__tests__/researchProtocolApi.test.js

# Phase 2 protocol tests
npm test -- --runInBand src/__tests__/phase2Protocol.test.js

# Run tests in band (one at a time, useful for debugging)
npm test -- --runInBand

# Run test with coverage report
npm test -- --coverage

# Watch mode (tests re-run on file change)
npm test -- --watch
```

### Expected Test Results
```
Test Suites: 2 passed, 2 total
Tests:       29 passed, 29 total
Snapshots:   0 total
```

## Code Quality

### Lint Check
```bash
cd C:\Users\panur\DWEB\voting-app\backend
npm run lint
```

### Auto-Fix Lint Issues
```bash
npm run lint -- --fix
```

### Expected Result
```
> eslint src/
(No output = success)
```

## Configuration

### Environment Variables - Backend

**Development** (DEFAULT):
```bash
NODE_ENV=development
C1_REVOTING_ENABLED=true
C1_CHAIN_RECEIPTS_ENABLED=false
C0_PROTOCOL_ENABLED=true
```

**Production**:
```bash
NODE_ENV=production
C1_REVOTING_ENABLED=true
C1_CHAIN_RECEIPTS_ENABLED=false
C0_PROTOCOL_ENABLED=true
```

### Environment Variables - Frontend
```bash
REACT_APP_API_URL=http://localhost:5000/api
```

## Git Workflow

### Commit Changes
```bash
cd C:\Users\panur\DWEB\voting-app

# Stage all changes
git add .

# Commit with message
git commit -m "feat: describe your changes here

- Bullet point 1
- Bullet point 2

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"

# View commit history
git log --oneline -n 10

# View what was changed
git diff HEAD~1
```

### Push & Sync
```bash
# Push to remote
git push origin main

# Pull latest changes
git pull origin main

# Check status
git status

# Stash uncommitted changes
git stash

# Apply stashed changes
git stash pop
```

## Troubleshooting

### Reset Node Modules
```bash
# Backend
cd C:\Users\panur\DWEB\voting-app\backend
rm -r node_modules package-lock.json
npm install

# Frontend
cd C:\Users\panur\DWEB\voting-app\frontend
rm -r node_modules package-lock.json
npm install
```

### Clear Cache & Restart
```bash
# Backend: Stop process (Ctrl+C) and restart
npm start

# Frontend: 
# 1. Stop dev server (Ctrl+C)
# 2. Clear browser cache (DevTools > Application > Clear storage)
# 3. npm start
```

### Database Issues
```bash
# Ensure MongoDB is running
# Windows: Start MongoDB service
# macOS: brew services start mongodb-community
# Linux: sudo systemctl start mongod

# Verify database connection
npm test -- src/__tests__/researchProtocolApi.test.js
```

### Port Already In Use
```bash
# Backend on different port
PORT=5001 npm start

# Frontend on different port
PORT=3001 npm start
```

### Rate Limit Error (429)
```bash
# Verify development mode
echo %NODE_ENV%  # Should show "development"

# If production, check rate limiter config
# backend/src/server.js should have skip: isDevelopment

# Clear backend cache and restart
npm start
```

## Database Operations

### Backup Database
```bash
# MongoDB dump
mongodump --uri "mongodb://127.0.0.1:27017/voting-app" --out ./backup/voting-app-backup

# Create archive
cd backup
tar -czf voting-app-backup.tar.gz voting-app-backup/
```

### Restore Database
```bash
# Extract archive
tar -xzf voting-app-backup.tar.gz

# Restore from dump
mongorestore --uri "mongodb://127.0.0.1:27017/voting-app" ./voting-app-backup/voting-app/
```

### Query Database (via MongoDB shell)
```bash
# Connect to database
mongosh "mongodb://127.0.0.1:27017/voting-app"

# Show collections
show collections

# Query polls
db.polls.find()

# Query users
db.users.find()

# Query ballots
db.ballots.find()

# Clear collection (danger!)
db.polls.deleteMany({})
```

## Deployment

### Build for Production
```bash
cd C:\Users\panur\DWEB\voting-app

# Backend build
cd backend
npm run build

# Frontend build
cd ../frontend
npm run build
```

### Deploy Backend
```bash
# On your server:
cd voting-app/backend
NODE_ENV=production npm start

# Or use process manager
pm2 start src/server.js --name voting-app-backend
```

### Deploy Frontend
```bash
# The build/ folder contains production build
# Deploy to static hosting (Vercel, Netlify, S3, etc.)
cd voting-app/frontend/build
# Upload contents to your CDN/hosting
```

## Continuation on New Machine

### Via Git
```bash
git clone https://github.com/Anurag-anonymous/VoteChain.git
cd VoteChain/voting-app
cd backend && npm install && npm test
cd ../frontend && npm install
```

### Via Archive
```bash
# On current machine
cd C:\Users\panur\DWEB
tar -czf voting-app-latest.tar.gz voting-app/

# Transfer file to new machine, then:
tar -xzf voting-app-latest.tar.gz
cd voting-app
# Follow "Backend Setup & Run" and "Frontend Setup & Run" above
```

## Health Check

### Verify Everything Works
```bash
# Terminal 1: Start backend
cd C:\Users\panur\DWEB\voting-app\backend
npm start
# Should show: "Server running on port 5000"

# Terminal 2: Health check
curl http://localhost:5000/api/health
# Should return: { "status": "OK", "timestamp": "...", "uptime": ... }

# Terminal 3: Run tests
cd C:\Users\panur\DWEB\voting-app\backend
npm test
# Should show: Test Suites: 2 passed, 2 total

# Terminal 4: Start frontend
cd C:\Users\panur\DWEB\voting-app\frontend
npm start
# Should show: "webpack compiled successfully"
# Open http://localhost:3000 in browser
```

## Quick Reference

| Task | Command | Expected Result |
|------|---------|-----------------|
| Test backend | `npm test` | 29/29 tests pass |
| Lint check | `npm run lint` | No output (success) |
| Start backend | `npm start` | "Server running on port 5000" |
| Start frontend | `npm start` | "webpack compiled successfully" |
| Health check | `curl http://localhost:5000/api/health` | JSON with status OK |
| View logs | `npm start` (backend) | Real-time server logs |
| Run specific test | `npm test -- src/__tests__/researchProtocolApi.test.js` | Tests for that file pass |

## Documentation Files

- `IMPLEMENTATION_SUMMARY.md` - Complete overview of all changes
- `RATE_LIMIT_FIX.md` - Detailed technical documentation
- `QUICK_START.md` - Getting started guide
- `COMMANDS.md` - This file
- `docs/EXPERIMENT_PROTOCOL.md` - C0/C1 protocol specification
- `backend/.env.example` - Environment variable template
