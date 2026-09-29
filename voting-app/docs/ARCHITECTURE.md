# VoteChain Architecture

Status: C0/C1/C2/C3 experimental voting prototype. The system is not production secure.
See [SECURITY_ASSUMPTIONS.md](./SECURITY_ASSUMPTIONS.md) and
[THREAT_MODEL.md](./THREAT_MODEL.md).

## System Overview

```text
Frontend (React 18)
  - api.js
  - walletService.js
        |
        | HTTP /api
        v
Backend (Express)
  - auth / OTP / Aadhaar verification
  - legacy plaintext voting
  - C0/C1 encrypted ballot voting
  - C2/C3 private panic-credential issuance and cleansing
        |                         |
        v                         v
MongoDB                    Local Anvil / configured EVM network
```

## Layers

### Frontend (`frontend/`)

- React 18, TailwindCSS, Zustand, Axios.
- `src/services/api.js` calls the Express API; `src/services/walletService.js`
  talks to MetaMask when the legacy chain path needs it.
- Poll cards and poll details hide encrypted vote counts until tally finalization.
- C0/C1/C2/C3 votes use `POST /api/polls/:pollId/ballot`; legacy votes use
  `POST /api/polls/:pollId/vote`.

### Backend (`backend/`)

- Express entry point: `src/server.js`; routes in `src/routes/*`, controllers
  in `src/controllers/*`, models in `src/models/*`.
- `src/config/blockchain.js` builds the web3/ethers providers used by
  `src/services/blockchainService.js` for the legacy on-chain poll flow.
- `src/config/networks.js` is the network registry: chain IDs, RPC env names,
  explorer URLs, signing policy, and deployment manifest paths.

### C0/C1/C2/C3 protocol boundary

- Composition root: `src/protocol/index.js`.
- Active protocol version: `c0-encrypted`.
- `c2-private-decoy` adds encrypted private credential classification and
  cleansing; `c3-revoting-decoy` also enables replacement ballots.
- Backward-compatible read support remains for old local `c0-mock-encrypted`
  documents, but new polls use `c0-encrypted`.
- Service families:
  - `src/services/eligibility-authority/EligibilityAuthority.js`
  - `src/services/credentials/CredentialProvider.js`
  - `src/services/credentials/ElectionCredentialProvider.js`
  - `src/services/credentials/PrivateCredentialRegistry.js`
  - `src/models/PrivateCredentialRecord.js` (credential/type ciphertext only)
  - `src/services/ballots/BallotService.js`
  - `src/services/ballots/EncryptedBallotService.js`
  - `src/services/tally/TallyCoordinator.js`
  - `src/services/tally/DevelopmentTallyCoordinator.js`

The C0 flow issues a genuine election credential, derives a per-election
nullifier, encrypts the selected option with randomized AES-256-GCM, stores the
encrypted ballot, and reveals counts only after finalization. C2/C3 use a
separate persistent registry, encrypt the credential plus its private genuine
/ panic label with AES-256-GCM, and exclude panic-linked ballots during trusted
finalization. The backend still manages credential issuance and secrets; these
modes are not anonymous credentials, formal JCJ, or end-to-end verifiable
voting protocols. Configure a stable `C2_REGISTRY_ENCRYPTION_KEY` for C2/C3.

### Chain and deployments

- Contracts: `smart-contracts/contracts/VotingPoll.sol` (Truffle, solc 0.8.20).
- Network definitions: `smart-contracts/truffle-config.js` (`anvil` local,
  `amoy` 80002, legacy `mumbai`, `polygon` mainnet).
- Manifests: `deployments/<network>/<Contract>.json` with `contractName`,
  `network`, `chainId`, `address`, `abiVersion`, and `notes`.
