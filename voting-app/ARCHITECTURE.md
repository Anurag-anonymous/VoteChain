# Voting Platform Architecture

## System Overview

```
┌─────────────────────────────────────────────────────┐
│                   Frontend (React)                   │
│         Web3.js + MetaMask Integration              │
└──────────────────┬──────────────────────────────────┘
                   │
                   │ API Calls
                   ▼
┌─────────────────────────────────────────────────────┐
│              Backend (Node.js + Express)             │
│         ├── User Management                          │
│         ├── Authentication & OTP                     │
│         ├── Poll Management                          │
│         └── Discussion Forum                         │
└──────────────────┬──────────────────────────────────┘
        ┌──────────┴──────────┐
        ▼                     ▼
┌──────────────────┐  ┌──────────────────┐
│   MongoDB        │  │  Blockchain      │
│   (Database)     │  │  (Polygon)       │
└──────────────────┘  └──────────────────┘
```

## Component Details

### Frontend Layer
- **Framework**: React 18
- **Styling**: TailwindCSS
- **State Management**: Zustand
- **API Client**: Axios
- **Web3**: Web3.js + Ethers.js
- **Wallet**: MetaMask Integration

### Backend Layer
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB
- **Authentication**: JWT + OTP
- **Blockchain**: Web3 + Ethers.js

### Database Layer
- **Databases**: MongoDB
- **Collections**:
  - Users
  - Polls
  - Discussions
  - Comments
  - Votes

### Blockchain Layer
- **Network**: Polygon Mumbai Testnet
- **Language**: Solidity
- **Framework**: Truffle
- **Contracts**:
  - VotingPoll (main contract)

## Data Flow

### User Registration Flow
```
User → Register Form → Backend → Verify Aadhar → Generate OTP
→ Send Email → Verify OTP → Create Account → Store in MongoDB
```

### Voting Flow
```
User → Select Poll → Connect Wallet → Submit Vote
→ Backend Verification → Blockchain Transaction
→ Store in MongoDB → Update Real-time Results
```

### Discussion Flow
```
User → Create Discussion → Backend API
→ Store in MongoDB → Display to All Users
→ Add Comments → Real-time Updates
```

## Security Architecture

```
┌─────────────────────────────────┐
│   Security Layers               │
├─────────────────────────────────┤
│ 1. Aadhar Verification (OTP)    │
│ 2. Password Hashing (bcrypt)    │
│ 3. JWT Authentication           │
│ 4. Rate Limiting                │
│ 5. CORS Protection              │
│ 6. Input Validation             │
│ 7. Blockchain Immutability      │
└─────────────────────────────────┘
```

## Database Schema

### Users Collection
```javascript
{
  _id: ObjectId,
  firstName: String,
  lastName: String,
  email: String (unique),
  phoneNumber: String (unique),
  aadharNumber: String (unique),
  password: String (hashed),
  aadharVerified: Boolean,
  walletAddress: String,
  votesCount: Number,
  pollsCreated: Number,
  votedPolls: Array,
  createdAt: Date,
  lastLoginAt: Date
}
```

### Polls Collection
```javascript
{
  _id: ObjectId,
  title: String,
  description: String,
  creator: ObjectId (ref: User),
  options: [{
    _id: ObjectId,
    optionText: String,
    votes: Number,
    voters: Array
  }],
  status: String (active/closed),
  totalVotes: Number,
  uniqueVoters: Array (ObjectId),
  contractAddress: String,
  blockNumber: Number,
  createdAt: Date
}
```

### Discussions Collection
```javascript
{
  _id: ObjectId,
  title: String,
  description: String,
  author: ObjectId (ref: User),
  category: String,
  comments: [{
    _id: ObjectId,
    author: ObjectId,
    content: String,
    replies: Array,
    createdAt: Date
  }],
  likes: Array (ObjectId),
  viewCount: Number,
  createdAt: Date
}
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/verify-otp` - OTP verification
- `POST /api/auth/login` - User login
- `POST /api/auth/reset-password` - Password reset

### Polls
- `GET /api/polls` - Get all polls
- `POST /api/polls` - Create poll
- `GET /api/polls/:id` - Get poll details
- `POST /api/polls/:id/vote` - Cast vote
- `GET /api/polls/:id/results` - Get results

### Discussions
- `GET /api/discussions` - Get all discussions
- `POST /api/discussions` - Create discussion
- `POST /api/discussions/:id/comments` - Add comment
- `GET /api/discussions/:id` - Get discussion

### Users
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update profile
- `POST /api/users/change-password` - Change password

## Smart Contract Functions

### VotingPoll Contract

**State-changing functions:**
- `createPoll(title, options, endTime)` - Create new poll
- `vote(pollId, optionIndex)` - Cast vote
- `closePoll(pollId)` - Close poll

**Read functions:**
- `getPoll(pollId)` - Get poll details
- `getPollResults(pollId)` - Get vote counts
- `hasVoted(pollId, voter)` - Check vote status
- `getWinningOption(pollId)` - Get winning option

## Deployment Architecture

```
                    ┌─────────────────┐
                    │   User Browser  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Vercel/Netlify │
                    │   (Frontend)    │
                    └────────┬────────┘
                             │
     ┌───────────────────────┼───────────────────────┐
     │                       │                       │
┌────▼────────┐  ┌───────────▼────────┐  ┌──────────▼──────┐
│  Heroku     │  │   MongoDB Atlas    │  │  Polygon RPC    │
│  (Backend)  │  │   (Database)       │  │  (Blockchain)   │
└─────────────┘  └────────────────────┘  └─────────────────┘
```

## Performance Considerations

- **Caching**: Redis for session management
- **Database**: Indexing on frequently queried fields
- **Blockchain**: Off-chain storage for large data
- **Frontend**: Code splitting and lazy loading
- **API**: Rate limiting and pagination

## Future Enhancements

1. **Advanced Features**
   - Multi-language support
   - Mobile app (React Native)
   - Email notifications
   - User reputation system

2. **Performance**
   - GraphQL API
   - Server-side caching
   - CDN for static assets

3. **Security**
   - Two-factor authentication (2FA)
   - Biometric authentication
   - Smart contract audits

4. **Scalability**
   - Multi-chain support
   - Layer 2 solutions
   - Database sharding
