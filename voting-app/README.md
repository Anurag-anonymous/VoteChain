# Blockchain Voting Platform

A secure, decentralized voting platform built with **Polygon blockchain**, **React**, **Node.js + Express**, and **MongoDB**. Features Aadhar-based verification with OTP for preventing duplicate votes and fraud.

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
```
PORT=5000
MONGODB_URI=mongodb://localhost:27017/voting-app
JWT_SECRET=your_jwt_secret_key
AADHAR_API_KEY=your_aadhar_api_key
AADHAR_API_URL=https://aadhar-api-url
POLYGON_RPC_URL=https://rpc-mumbai.maticvigil.com
POLYGON_CHAIN_ID=80001
PRIVATE_KEY=your_wallet_private_key
OTP_EXPIRE_TIME=10
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
```

**frontend/.env.local**
```
REACT_APP_API_URL=http://localhost:5000
REACT_APP_POLYGON_RPC=https://rpc-mumbai.maticvigil.com
REACT_APP_CONTRACT_ADDRESS=0x...
REACT_APP_CHAIN_ID=80001
```

### 3. Deploy Smart Contracts

```bash
cd smart-contracts
truffle migrate --network mumbai
```

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
- Switch to Mumbai Testnet (Chain ID: 80001)
- Ensure you have test MATIC tokens

**OTP Not Received**
- Check email/SMS service configuration
- Verify Aadhar linked phone number
- Check OTP expiration time

**Transaction Failures**
- Verify sufficient test MATIC balance
- Check gas price settings
- Ensure contract address is correct

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

---

**Note**: This is a testnet implementation. For production, ensure proper security audits, legal compliance, and mainnet deployment procedures.
