# VoteChain Local Requirements

This project runs a local blockchain voting stack:

- React frontend on `http://localhost:3000`
- Express backend on `http://localhost:5000`
- MongoDB on `mongodb://127.0.0.1:27017/voting-app`
- Anvil local blockchain on `http://127.0.0.1:8545`
- Truffle smart-contract deployment to Anvil

## Required Software

The setup script tries to install missing tools automatically on Windows. If automatic install fails, install these manually:

1. Node.js LTS with npm
   - Download: https://nodejs.org/
   - Verify: `node --version` and `npm --version`

2. MongoDB Community Server
   - Download: https://www.mongodb.com/try/download/community
   - Make sure `mongod` is available in your terminal PATH.
   - Verify: `mongod --version`

3. Foundry, for Anvil
   - Install guide: https://book.getfoundry.sh/getting-started/installation
   - After installing, run `foundryup`.
   - Verify: `anvil --version`

4. PowerShell
   - Windows includes PowerShell by default.

## One Command Setup

From the project root:

```powershell
cd voting-app
powershell -ExecutionPolicy Bypass -File .\scripts\setup-local.ps1
```

Or:

```powershell
npm run setup:local
```

The setup script will:

- Check for Node.js/npm, MongoDB, and Anvil.
- Try to install missing Node.js and MongoDB with `winget`.
- Try to install missing Anvil through the Foundry installer.
- Create `backend/.env` from `backend/.env.example` if missing.
- Create `frontend/.env.local` from `frontend/.env.example` if missing.
- Install npm dependencies for root, backend, frontend, and smart contracts.
- Start MongoDB locally if port `27017` is not already running.
- Start Anvil locally if port `8545` is not already running.
- Compile and deploy `VotingPoll.sol` to Anvil.
- Write the deployed contract address into backend and frontend env files.

To only check tools without attempting automatic installs:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-local.ps1 -NoAutoInstall
```

## Start The App

After setup completes:

```powershell
npm run dev
```

Open:

- Frontend: http://localhost:3000
- Backend health: http://localhost:5000/api/health
- Anvil RPC: http://127.0.0.1:8545

## Development OTPs

If real email, SMS, and Aadhaar providers are not configured, the app uses development OTPs.

During registration:

- OTPs are shown on the registration screen.
- OTPs are also logged in the backend terminal.

For real delivery, configure these in `backend/.env`:

- Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
- SMS: `SMS_API_URL`, `SMS_API_KEY`
- Aadhaar provider: `AADHAR_API_URL`, `AADHAR_API_KEY`

## Local Wallet Behavior

For local Anvil development:

- Each new user gets one generated wallet address.
- The backend stores that wallet private key locally so blockchain actions can be signed from the user's address.
- The wallet is funded automatically from Anvil's default account.
- A user's wallet cannot be changed after it is generated.

Do not use this private-key storage pattern in production. In production, users should sign transactions from their own wallet, such as MetaMask.

## Useful Commands

```powershell
npm run setup:local
npm run dev
npm run build
npm run lint
```

Smart contracts only:

```powershell
cd smart-contracts
npm run compile
npx truffle migrate --network anvil --reset
```

## Common Issues

### Port 5000 Already In Use

An old backend process is already running. Stop it, or change `PORT` in `backend/.env`.

### Anvil Is Not Found

Install Foundry and run `foundryup`, then open a new terminal.

### MongoDB Is Not Found

Install MongoDB Community Server and ensure `mongod` is on PATH.

### Contract Address Is Missing

Run:

```powershell
npm run setup:local
```

The script redeploys the contract and updates env files.
