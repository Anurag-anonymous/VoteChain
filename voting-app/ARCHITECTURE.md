# Voting Platform Architecture

> Documentation map: this file describes the prototype application only. The
> `docs/` set is authoritative for the C0 encrypted baseline program:
> [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md),
> [docs/CRYPTOGRAPHIC_ARCHITECTURE.md](./docs/CRYPTOGRAPHIC_ARCHITECTURE.md),
> [docs/THREAT_MODEL.md](./docs/THREAT_MODEL.md),
> [docs/SECURITY_ASSUMPTIONS.md](./docs/SECURITY_ASSUMPTIONS.md),
> [docs/NETWORK_COMPATIBILITY.md](./docs/NETWORK_COMPATIBILITY.md),
> [docs/EXPERIMENT_PROTOCOL.md](./docs/EXPERIMENT_PROTOCOL.md), and
> [docs/ARCHITECTURE_AUDIT.md](./docs/ARCHITECTURE_AUDIT.md).

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
- **Networks**: Anvil `31337` (local) and Polygon Amoy `80002` (testnet);
  Mumbai `80001` is retired. The registry lives in
  `backend/src/config/networks.js` and `docs/NETWORK_COMPATIBILITY.md` is
  authoritative for network values.
- **Language**: Solidity
- **Framework**: Truffle (solc 0.8.20)
- **Contracts**:
  - VotingPoll (main contract)

## Data Flow

### User Registration Flow
```
User → Register Form → Backend → Verify Aadhar(not implemented currently) → Generate OTP(not implemented currently)
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
  panicPassword: String (hashed; optional for accounts created before C2),
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
- `POST /api/auth/register` - User registration, including the separate decoy
  account password used for panic-mode login
- `POST /api/auth/verify-otp` - OTP verification
- `POST /api/auth/login` - User login
- `POST /api/auth/reset-password` - Password reset

### Polls
- `GET /api/polls` - Get all polls
- `POST /api/polls` - Create poll
- `GET /api/polls/:id` - Get poll details
- `POST /api/polls/:id/vote` - Cast vote (legacy plaintext flow)
- `GET /api/polls/:id/results` - Get results

### Polls (C0 encrypted protocol)
These endpoints only apply to polls created with
`protocolVersion: "c0-encrypted"`. See `docs/CRYPTOGRAPHIC_ARCHITECTURE.md`.
- `POST /api/polls/:pollId/ballot` - Submit a C0/C2/C3 AES-GCM encrypted ballot
- `POST /api/polls/:id/finalize` - Finalize the development tally and privately cleanse C2/C3 decoy ballots (creator only)

### C2 panic/decoy credentials

Select **C2 panic/decoy credentials** when creating an encrypted poll, or use
`protocolVersion: "c2-private-decoy"` in the create-poll API. During
registration, the voter chooses a distinct decoy account password and should
save it securely. Signing in with the usual email and that password creates a
private panic-mode session. On the first C2/C3 ballot, the backend issues a
stable genuine credential and panic/decoy credential for that voter and
election, then uses the panic credential for panic-mode sessions.
The credentials and their classifications are stored in a separate private
MongoDB collection, encrypted with AES-256-GCM using
`C2_REGISTRY_ENCRYPTION_KEY`. The key must be a stable 32-byte hex value (64
hex characters); losing or changing it makes the registry unreadable and tally
finalization fails rather than silently counting panic ballots.

The ballot API stores and returns no credential-type field. Finalization reads
the private registry, removes ballots whose commitments match panic credentials,
and records only an aggregate `excludedPanicBallotCount`. Public results and
the chain receipt do not contain a panic flag or credential type. C3 uses the
same private credential mechanism and additionally enables ballot replacement.

This is a trusted-backend experiment, not formal JCJ coercion resistance: the
registrar/tally service can link voters to their credentials and distinguish
the two login passwords. The app does not provide client-held anonymous
credentials or publicly verifiable cleansing proof. See
[docs/EXPERIMENT_PROTOCOL.md](./docs/EXPERIMENT_PROTOCOL.md) for the flow and
trust assumptions.

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
