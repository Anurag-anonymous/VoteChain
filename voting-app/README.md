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

✅ **Aadhar-Based Registration** - Unique user identification using Aadhar Card No.  
✅ **OTP Verification** - Mobile verification linked to Aadhar  
✅ **Secure Login System** - No duplicate users allowed  
✅ **Blockchain Voting** - Immutable voting records on Polygon  
✅ **Poll Creation & Management** - Create and manage voting polls  
✅ **Real-time Results** - View poll results instantly  
✅ **Discussion Forum** - Community discussion platform  
✅ **Password Reset via OTP** - Secure account recovery  

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

Phase 2 research protocol controls (mock cryptography, research boundary only):

```env
RESEARCH_PROTOCOL_ENABLED=true
RESEARCH_TALLY_THRESHOLD=1
BLOCKCHAIN_ENABLED=true
DATABASE_ENABLED=true
```

`RESEARCH_PROTOCOL_ENABLED=false` disables the `c0-mock-encrypted` poll type and
its ballot and finalize endpoints. See
[docs/CRYPTOGRAPHIC_ARCHITECTURE.md](./docs/CRYPTOGRAPHIC_ARCHITECTURE.md).

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
- `c0-mock-encrypted` polls require `RESEARCH_PROTOCOL_ENABLED=true` in
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

**Note**: This is a testnet implementation. For production, ensure proper security audits, legal compliance, and mainnet deployment procedures as we are just using it as our project so we can ignore those compliances till it gets fully ready.
