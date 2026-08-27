# Blockchain Voting Platform - Setup Guide

## 📋 Prerequisites

- **Node.js** v14+ installed
- **MongoDB** (local or Atlas cloud)
- **MetaMask** browser extension
- **Test MATIC** tokens from [Polygon Faucet](https://faucet.polygon.technology/)
- Aadhar verification API credentials (for production)

## 🚀 Quick Start

### 1. Clone and Setup

```bash
cd voting-app

# Install all dependencies
npm run install-all
```

### 2. Configure Environment Variables

#### Backend Setup (.env)

```bash
cd backend
cp .env.example .env
```

Edit `backend/.env` with:
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/voting-app
JWT_SECRET=your_super_secret_key_here
POLYGON_RPC_URL=https://rpc-mumbai.maticvigil.com
POLYGON_CHAIN_ID=80001
POLYGON_WALLET_PRIVATE_KEY=your_wallet_private_key
AADHAR_API_KEY=your_aadhar_api_key
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
```

#### Frontend Setup (.env.local)

```bash
cd ../frontend
cp .env.example .env.local
```

Edit `frontend/.env.local` with:
```env
REACT_APP_API_URL=http://localhost:5000
REACT_APP_POLYGON_RPC=https://rpc-mumbai.maticvigil.com
REACT_APP_CHAIN_ID=80001
```

### 3. Setup Database

#### Option A: Local MongoDB
```bash
# Start MongoDB service
mongod

# MongoDB will be available at localhost:27017
```

#### Option B: MongoDB Atlas (Cloud)
1. Create account at [mongodb.com](https://www.mongodb.com)
2. Create a cluster
3. Get connection string
4. Update `MONGODB_URI` in `.env`

### 4. Deploy Smart Contracts

```bash
cd smart-contracts

# Set your wallet private key
export PRIVATE_KEY=your_wallet_private_key

# Compile contracts
npm run compile

# Deploy to Mumbai Testnet
npm run migrate -- --network mumbai

# Copy the deployed contract address and update:
# - backend/.env: VOTING_CONTRACT_ADDRESS
# - frontend/.env.local: REACT_APP_CONTRACT_ADDRESS
```

### 5. Start Development

#### Terminal 1: Backend
```bash
cd backend
npm run dev
# Server runs on http://localhost:5000
```

#### Terminal 2: Frontend
```bash
cd frontend
npm start
# App runs on http://localhost:3000
```

Or run both simultaneously:
```bash
npm run dev
```

## 📱 Testing the Application

### 1. Register a New User
1. Go to `http://localhost:3000/register`
2. Fill in details:
   - **Aadhar**: Use any 12-digit number (e.g., 123456789012)
   - **Phone**: Use any Indian format (e.g., 9876543210)
   - **Password**: Min 8 characters
3. Verify OTP (check console or email)

### 2. Connect Wallet
1. Login to account
2. Click on profile
3. Link your MetaMask wallet
4. Ensure you're on **Polygon Mumbai Testnet**
5. Get test MATIC from [Polygon Faucet](https://faucet.polygon.technology/)

### 3. Create a Poll
1. Go to **Create Poll**
2. Add title, description, and options
3. Set end date/time
4. Submit (transaction on blockchain)

### 4. Vote
1. View polls
2. Select a poll
3. Choose an option
4. Confirm vote (blockchain transaction)
5. Check real-time results

### 5. Discuss
1. Go to **Discussions**
2. Start a new discussion
3. Add comments and engage with community

## 🧪 Testing

### Run Tests
```bash
npm run test
```

### Backend Tests
```bash
cd backend
npm test
```

### Smart Contract Tests
```bash
cd smart-contracts
npm test
```

## 🔧 Troubleshooting

### MongoDB Connection Error
```bash
# Check MongoDB is running
mongod

# Or update connection string in .env
MONGODB_URI=mongodb://localhost:27017/voting-app
```

### MetaMask Network Issues
1. MetaMask settings → Add Network
2. Network name: Polygon Mumbai
3. RPC URL: https://rpc-mumbai.maticvigil.com
4. Chain ID: 80001
5. Currency: MATIC

### Contract Deployment Failed
```bash
# Ensure private key is valid
# Check account has sufficient MATIC
# Verify RPC URL is correct
```

### Frontend API Connection Error
1. Ensure backend is running on port 5000
2. Check `REACT_APP_API_URL` in .env.local
3. Check CORS settings in backend

### OTP Not Received
1. For development, check backend console logs
2. For production, verify SMTP credentials
3. Check email spam folder

## 📊 API Documentation

### Authentication Endpoints
- `POST /api/auth/register` - Register with Aadhar
- `POST /api/auth/verify-otp` - Verify OTP
- `POST /api/auth/login` - Login
- `POST /api/auth/reset-password` - Reset password

### Poll Endpoints
- `GET /api/polls` - Get all polls
- `POST /api/polls` - Create poll
- `GET /api/polls/:id` - Get poll details
- `POST /api/polls/:id/vote` - Vote
- `GET /api/polls/:id/results` - Get results

### Discussion Endpoints
- `GET /api/discussions` - Get all discussions
- `POST /api/discussions` - Create discussion
- `POST /api/discussions/:id/comments` - Add comment

## 🔒 Security Considerations

- **Aadhar Verification**: Prevents duplicate users
- **OTP Authentication**: Two-factor authentication
- **Blockchain Verification**: Immutable voting records
- **JWT Tokens**: Secure API authentication
- **Password Hashing**: bcrypt encryption
- **Rate Limiting**: Prevents brute force attacks

## 📦 Production Deployment

### Backend (Heroku)
```bash
cd backend
git push heroku main
```

### Frontend (Vercel)
```bash
cd frontend
vercel deploy
```

### Smart Contracts (Polygon Mainnet)
```bash
cd smart-contracts
npm run migrate -- --network polygon
```

## 📚 Additional Resources

- [Polygon Documentation](https://polygon.technology/developers/)
- [Truffle Documentation](https://trufflesuite.com/docs/)
- [Solidity Documentation](https://docs.soliditylang.org/)
- [Express.js Guide](https://expressjs.com/)
- [React Documentation](https://react.dev/)
- [MongoDB Manual](https://docs.mongodb.com/manual/)

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Submit a pull request

## 📄 License

MIT License

## 📞 Support

For issues and support:
1. Check GitHub Issues
2. Review documentation
3. Contact development team
