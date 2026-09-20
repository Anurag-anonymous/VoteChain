# VoteChain Architecture

Status: Phase 2 research prototype. The system is not production secure. See
[SECURITY_ASSUMPTIONS.md](./SECURITY_ASSUMPTIONS.md) and [THREAT_MODEL.md](./THREAT_MODEL.md).

## System Overview

```
┌───────────────────────────────┐
│ Frontend (React 18)           │
│ api.js + walletService.js     │
└──────────────┬────────────────┘
               │ HTTP /api
┌──────────────▼────────────────┐
│ Backend (Express)             │
│  ├─ auth / otp / aadhaar      │
│  ├─ legacy plaintext voting   │
│  └─ C0 mock-encrypted voting  │
└───┬───────────────────────┬───┘
    │                       │
    ▼                       ▼
 MongoDB            Anvil 31337 (local)
                    Polygon Amoy 80002 (testnet)
```

## Layers

### Frontend (`frontend/`)
- React 18, TailwindCSS, Zustand, Axios.
- `src/services/api.js` calls the Express API; `src/services/walletService.js`
  talks to MetaMask.
- The UI currently drives the legacy plaintext path only. The C0
  mock-encrypted path is an API-only research surface.

### Backend (`backend/`)
- Express entry point: `src/server.js`; routes in `src/routes/*`,
  controllers in `src/controllers/*`, models in `src/models/*`.
- `src/config/blockchain.js` builds the web3/ethers providers used by
  `src/services/blockchainService.js` for the legacy on-chain poll flow.
- `src/config/networks.js` is the Phase 2 network registry: chain IDs, RPC env
  names, explorer URLs, per-network signing policy, and deployment manifests.

### Research protocol boundary
- Composition root: `src/protocol/index.js` (`createPhaseTwoProtocol`,
  `getPhaseTwoProtocol`, `PROTOCOL_VERSIONS`, `isResearchProtocolEnabled`).
- Service families, each with an interface class and a mock implementation:
  - `src/services/eligibility-authority/EligibilityAuthority.js`
  - `src/services/credentials/CredentialProvider.js` + `MockCredentialProvider.js`
  - `src/services/ballots/BallotService.js` + `MockBallotService.js`
  - `src/services/tally/TallyCoordinator.js` + `MockTallyCoordinator.js`
- Every mock response carries a `securityNotice` string so no caller can mistake
  mock output for a real cryptographic guarantee.

### Chain and deployments
- Contracts: `smart-contracts/contracts/VotingPoll.sol` (Truffle, solc 0.8.20).
- Network definitions: `smart-contracts/truffle-config.js`
  (`anvil` local, `amoy` 80002, legacy `mumbai`, `polygon` mainnet).
- Manifests: `deployments/<network>/<Contract>.json` with
  `contractName`, `network`, `chainId`, `address`, `abiVersion`, `notes`.
