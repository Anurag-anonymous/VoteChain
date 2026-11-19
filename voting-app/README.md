# Blockchain Voting Platform

A secure, decentralized voting platform built with **Polygon blockchain**, **React**, **Node.js + Express**, and **MongoDB**. Features Aadhar-based verification with OTP for preventing duplicate votes and fraud.

## Local Anvil Quick Start

For a fresh clone, read [REQUIREMENTS.md](./REQUIREMENTS.md), install Node.js, MongoDB, and Foundry/Anvil, then run:

```powershell
npm run setup:local
npm run dev
```

The setup script creates env files, installs dependencies, starts MongoDB and Anvil, deploys the smart contract, and writes the contract address into the backend/frontend configuration.

## Features

✅ **Aadhar-Based Registration** - Unique user identification using Aadhar Card No.   (currently not implemented as Aadhaar e-KYC through an authorized KUA/Sub-KUA arrangement is not done yet.)
✅ **OTP Verification** - Mobile verification linked to Aadhar  (development otp is used currently, will try to implement twilio or some other service for it.)
✅ **Secure Login System** - No duplicate users allowed  
✅ **Blockchain Voting** - Immutable voting records on Polygon  (shifted to anvil for local testing and gas fee headache.)
✅ **Poll Creation & Management** - Create and manage voting polls  
✅ **Real-time Results** - View poll results instantly  (comming soon)
✅ **Discussion Forum** - Community discussion platform  (comming soon)
✅ **Password Reset via OTP** - Secure account recovery  (comming soon)

## Project Structure

```
voting-app/
├── frontend/              # React web application
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── .env.local
├── backend/              # Node.js + Express API
│   ├── src/
│   ├── config/
│   ├── controllers/
│   ├── routes/
│   ├── models/
│   ├── middleware/
│   ├── services/
│   ├── package.json
│   └── .env
├── smart-contracts/      # Solidity contracts for Polygon
│   ├── contracts/
│   ├── test/
│   ├── truffle-config.js
│   └── package.json
└── README.md
```

## Independent Eligibility Authority

The human eligibility-review service is maintained separately from this
application in the sibling [`eligibility-authority`](../eligibility-authority/)
directory. It has its own reviewer UI, encrypted case storage, configuration,
and Node.js process; it does not read the VoteChain database. Start it from
that directory with `npm start` after configuring its `.env` and the matching
`ELIGIBILITY_AUTHORITY_*` values in `backend/.env`. Reviewers open the service
URL, sign in with the configured authority password, check cases, and record a
decision. Applicants can submit or refresh a case from their profile.

An approval callback synchronizes an opaque authority-issued subject and
credential commitment to VoteChain. Eligibility is required before either
legacy or encrypted ballots are accepted. See the authority README for
secrets, deployment, review limitations, and the distinction between the
authority identity handle and per-election voting credentials.

Encrypted and legacy voting requests now submit a Chaum-Pedersen proof of
credential possession with an election-scoped nullifier instead of including
the credential secret in the ballot request. The browser creates the proof;
the backend checks it against the approved credential commitment. This protects
the credential secret in transit but is not end-to-end voter anonymity: voting
still requires an authenticated account, and VoteChain can associate a ballot
submission with that account. A deployment intended to hide voter identity
from the backend needs anonymous group-membership proofs (for example,
Semaphore), unlinkable submission/relaying, and independent security review.

## Tech Stack

- **Frontend**: React, Web3.js, Ethers.js, TailwindCSS
- **Backend**: Node.js, Express, MongoDB, JWT, Nodemailer
- **Blockchain**: Polygon, Solidity, Truffle, Ganache
- **Authentication**: JWT, OTP Verification
- **Database**: MongoDB (User data, polls, discussions)

## Prerequisites

- Node.js (v14+)
- npm or yarn
- MongoDB (local or cloud - MongoDB Atlas)
- MetaMask wallet
- Polygon Testnet setup
- Aadhar API credentials (for production)

## Installation & Setup

### 1. Clone and Install Dependencies

```bash
cd voting-app

# Backend setup
cd backend
npm install

# Frontend setup
cd ../frontend
npm install

# Smart Contracts setup
cd ../smart-contracts
npm install
```

### 2. Environment Setup

Create `.env` files:

**backend/.env**
```env
PORT=5000

# MongoDB configuration
MONGODB_MODE=local
MONGODB_LOCAL_URI=mongodb://localhost:27017/voting-app
MONGODB_ATLAS_URI=mongodb+srv://username:password@cluster.mongodb.net/voting-app
# Optional direct override for a full connection string:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/voting-app

JWT_SECRET=your_jwt_secret_key
AADHAR_API_KEY=your_aadhar_api_key
AADHAR_API_URL=https://aadhar-api-url
BLOCKCHAIN_NETWORK=anvil
ANVIL_RPC_URL=http://127.0.0.1:8545
ANVIL_CHAIN_ID=31337
ANVIL_VOTING_CONTRACT_ADDRESS=0x...
PRIVATE_KEY=your_wallet_private_key
OTP_EXPIRE_TIME=10
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
```

For Polygon testnet instead of the local chain, set
`BLOCKCHAIN_NETWORK=polygon-amoy`, `POLYGON_RPC_URL=<amoy rpc>`, and
`POLYGON_CHAIN_ID=80002`. Amoy is chain ID 80002; Mumbai (80001) is retired.

Encrypted C0 baseline controls:

```env
C0_PROTOCOL_ENABLED=true
RESEARCH_TALLY_THRESHOLD=1
C0_CREDENTIAL_ISSUER_SECRET=change-me-c0-credential-secret
C0_BALLOT_ENCRYPTION_SECRET=change-me-c0-ballot-encryption-secret
C1_CHAIN_RECEIPTS_ENABLED=false
C1_ENCRYPTED_BALLOT_REGISTRY_ADDRESS=
C1_REVOTING_ENABLED=false
BLOCKCHAIN_ENABLED=true
DATABASE_ENABLED=true
```

`C0_PROTOCOL_ENABLED=false` disables the encrypted C0 poll type and its ballot
and finalize endpoints. The older `RESEARCH_PROTOCOL_ENABLED` name is still
accepted when `C0_PROTOCOL_ENABLED` is not set. See
[docs/CRYPTOGRAPHIC_ARCHITECTURE.md](./docs/CRYPTOGRAPHIC_ARCHITECTURE.md).

Set `C1_CHAIN_RECEIPTS_ENABLED=true` and
`C1_ENCRYPTED_BALLOT_REGISTRY_ADDRESS=<deployed registry>` to anchor encrypted
ballot receipts on Anvil. With the flag off, encrypted polls stay in C0
database-only mode.

Run modes:

| Mode | Settings | What happens |
| --- | --- | --- |
| Legacy | `protocolVersion=legacy-plaintext` | Plain vote counts are stored and shown. |
| C0 | `C0_PROTOCOL_ENABLED=true`, `C1_CHAIN_RECEIPTS_ENABLED=false` | Ballots are encrypted in the backend DB; public counts stay hidden until finalization. |
| C1 | `C0_PROTOCOL_ENABLED=true`, `C1_REVOTING_ENABLED=true`, `C1_CHAIN_RECEIPTS_ENABLED=false` | Experimental C1 revoting condition: replacement ballots are stored encrypted in the database, and only the final active ballot counts. |
| C1 + receipts | `C0_PROTOCOL_ENABLED=true`, `C1_REVOTING_ENABLED=true`, `C1_CHAIN_RECEIPTS_ENABLED=true` | C1 revoting plus one on-chain receipt transaction per accepted ballot/replacement. |

To inspect a C1 receipt transaction on the current Anvil chain:

```powershell
npm run chain:c1-receipt -- -TransactionHash 0xYOUR_TX_HASH
```

Useful C1 commands:

```powershell
npm run setup:local     # deploys VotingPoll and EncryptedBallotRegistry
npm run setup:c1:on     # enables C1 revoting and receipt anchoring in backend/.env
npm run setup:c1:off    # returns to C0 database-only encrypted ballots
```

For the experimental C1 revoting flow, set
`C1_REVOTING_ENABLED=true` and leave `C1_CHAIN_RECEIPTS_ENABLED=false`.
The paper's campaign runner is implemented, but the full matrix has not yet
been executed. See
[docs/RESEARCH_READINESS.md](./docs/RESEARCH_READINESS.md) for the requirements
and limitations of the implemented study harness, and
[scripts/experiments/README.md](./scripts/experiments/README.md) for commands
to execute the Anvil or Polygon Amoy matrix. The harness is separate from the
production app and no full campaign results have been collected.

Contract regression tests run on Truffle's ephemeral development chain with
`npm run test:contracts`; the empirical runner requires Anvil at
`127.0.0.1:8545`.

**frontend/.env.local**
```
REACT_APP_API_URL=http://localhost:5000/api
REACT_APP_POLYGON_RPC=http://127.0.0.1:8545
REACT_APP_CONTRACT_ADDRESS=0x...
REACT_APP_CHAIN_ID=31337
REACT_APP_NETWORK_NAME=Local Anvil
```

### 3. Deploy Smart Contracts

```bash
cd smart-contracts
npx truffle migrate --network anvil --reset
```

For Polygon Amoy use `--network amoy` after setting `POLYGON_RPC_URL` and
`PRIVATE_KEY` in `smart-contracts/.env`.

### 4. Start Backend

```bash
cd backend
npm start
```

### 5. Start Frontend

```bash
cd frontend
npm start
```

The application will be available at `http://localhost:3000`

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register with Aadhar ID
- `POST /api/auth/verify-otp` - Verify OTP
- `POST /api/auth/login` - User login
- `POST /api/auth/reset-password` - Reset password with OTP
- `POST /api/auth/refresh-token` - Refresh JWT token

### Polls
- `GET /api/polls` - Get all polls
- `POST /api/polls` - Create new poll
- `GET /api/polls/:id` - Get poll details
- `POST /api/polls/:id/vote` - Cast vote (blockchain)
- `GET /api/polls/:id/results` - Get poll results

### Discussions
- `GET /api/discussions` - Get all discussions
- `POST /api/discussions` - Create discussion thread
- `POST /api/discussions/:id/comments` - Add comment
- `GET /api/discussions/:id` - Get thread with comments

## Workflow

### User Registration & Login Flow
1. User enters Aadhar Card Number
2. System verifies Aadhar with third-party API
3. OTP sent to registered mobile number
4. User verifies OTP
5. User sets password
6. Account created in MongoDB
7. User can now login with email/Aadhar + password

### Voting Flow
1. User views available polls
2. User selects a poll
3. User casts vote (stored on Polygon blockchain)
4. Transaction recorded immutably
5. Vote counted in real-time results

### Password Reset Flow
1. User requests password reset
2. Aadhar number verified
3. OTP sent to registered mobile
4. OTP verified
5. New password set
6. Account secured

## Security Features

🔒 **No Duplicate Users** - Aadhar ID uniqueness check  
🔒 **OTP Verification** - Two-factor authentication  
🔒 **Blockchain Immutability** - Votes cannot be altered  
🔒 **JWT Authentication** - Secure API endpoints  
🔒 **Encrypted Passwords** - bcrypt hashing  
🔒 **Rate Limiting** - Prevent brute force attacks  

## Contract Details

The `VotingPoll` smart contract includes:
- Poll creation with description and options
- One vote per wallet per poll
- Blockchain timestamp for vote verification
- Immutable voting records
- Poll status management

## Testing

```bash
# Backend tests
cd backend
npm test

# Smart contract tests
cd ../smart-contracts
truffle test
```

## Troubleshooting

**MetaMask Connection Issues**
- Ensure MetaMask is installed
- Add the local chain: RPC `http://127.0.0.1:8545`, Chain ID `31337`,
  Currency `ETH`, name `Local Anvil`
- Anvil accounts already hold test ETH; no faucet is needed
- For Polygon testnet, switch to Amoy (Chain ID: 80002) and get test POLYM
  from the Polygon faucet

**Encrypted Research Polls Return 400**
- `c0-encrypted` polls require `C0_PROTOCOL_ENABLED=true` in
  `backend/.env`
- Cast ballots with `POST /api/polls/:pollId/ballot` and finalize with
  `POST /api/polls/:id/finalize`; `POST /api/polls/:pollId/vote` is for legacy
  plaintext polls only

**OTP Not Received**
- Check email/SMS service configuration
- Verify Aadhar linked phone number
- Check OTP expiration time

**Transaction Failures**
- Confirm Anvil (or Amoy) is reachable at the configured RPC URL
- Check the account balance and gas price settings
- Ensure the contract address in `.env` matches the deployed contract

## Future Enhancements

- Multi-language support
- Mobile app (React Native)
- Advanced analytics dashboard
- Voting analytics and reports
- Email notifications
- Biometric authentication
- Voting history and statistics
- Poll scheduling

## License

MIT License

## Support

For issues or questions, please open an issue in the repository.
And if you aren't sure about your idea or fix please kindly contact me or just go for it i will check it from your merge request so go on clone it and start working.

---

**Note**: This is a testnet implementation which is based on polygon amoy but you will find anvil local chain configuration in the code as we used the local chain for testing and initial building but it works of polygon amoy as i have tested it. For production, ensure proper security audits, legal compliance, and mainnet deployment procedures as we are just using it as our project so we can ignore those compliances till it gets fully ready.
