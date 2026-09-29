# Network Compatibility

C0 supports two actively generated networks. Legacy names are accepted as
aliases so existing configuration files keep working.

| Network key | Chain ID | RPC env | Default RPC | Signing |
| --- | --- | --- | --- | --- |
| `anvil` | 31337 | `ANVIL_RPC_URL` | `http://127.0.0.1:8545` | backend key or user key |
| `polygon-amoy` | 80002 | `POLYGON_RPC_URL` | none (must be set) | external wallet only |

Accepted aliases in `NETWORK_ALIASES`: `local` and `localhost` map to `anvil`;
`amoy` and `mumbai` map to `polygon-amoy` (Mumbai's 80001 is retired, so the
alias now resolves to Amoy 80002).

The registry lives in `backend/src/config/networks.js` and exports:

- `DEFAULT_NETWORK_KEY` (`anvil`) and `DEFAULT_CHAIN_ID` (`31337`).
- `getNetworkConfig(key)` returning `key`, `chainId`, `name`, `rpcUrlEnv`,
  `rpcUrl`, `explorerUrl`, `allowLocalPrivateKeySigning`,
  `metamaskSwitchingEnabled`, and `deploymentDir`. Unknown keys throw
  `Unsupported blockchain network: <key>`.
- `normalizeNetworkKey(value)`, which resolves an alias or falls back to
  `NETWORK`, `BLOCKCHAIN_NETWORK`, then `anvil`.
- `listNetworks()`, `canSignLocally(key)`, and
  `loadDeployment(contractName, networkKey)`.

`backend/src/config/blockchain.js` consumes this registry directly. It does not
fall back from an unset public-network RPC, and local private-key signing is
refused for `polygon-amoy`. Only `anvil` sets
`allowLocalPrivateKeySigning: true`; generated user wallet keys must not be
carried to a public network.

## Deployment manifests

`loadDeployment(contractName, networkKey)` reads
`deployments/<network>/<Contract>.json` and returns `null` when the file is
missing. It throws when the manifest's `contractName` or `chainId` disagrees with
the request, so a stale copy cannot be silently used for the wrong chain.

Manifests under `deployments/anvil` and `deployments/polygon-amoy` currently
declare `address: null` with `abiVersion: "phase-2-placeholder"`. They document
the target contract set (`Election`, `ElectionManager`, `CredentialVerifier`,
`BallotBox`, `TallyVerifier`) and must be updated with real addresses and ABIs
before any experiment that touches a chain.

## Local chain requirements

- Anvil must run with `--chain-id 31337`; `npm run chain:anvil` does this.
- The Truffle network name is `anvil`, so the deployed address lands under
  `networks["31337"]` in `smart-contracts/build/contracts/VotingPoll.json`.
- `scripts/setup-local.ps1` reads that address and writes
  `ANVIL_VOTING_CONTRACT_ADDRESS` into `backend/.env`, then
  `REACT_APP_VOTING_CONTRACT_ADDRESS` into `frontend/.env.local`.
- Anvil is ephemeral. Restarting it invalidates previously stored poll
  contract IDs, so re-run `npm run deploy:anvil` and re-create polls.

## Frontend

- `REACT_APP_CHAIN_ID` is `31337` and `REACT_APP_NETWORK_NAME` is `Local Anvil`
  in `frontend/.env.example`. `walletService.js` verifies the connected network
  against `REACT_APP_CHAIN_ID` and prompts a switch when it differs.
- `smart-contracts/truffle-config.js` exposes only `anvil` and
  `polygon-amoy`; Polygon deployment requires `POLYGON_RPC_URL` and
  `DEPLOYER_PRIVATE_KEY`.

## Migration notes

- Mumbai (80001) is retired. Use Amoy (80002) for public testnet work.
- `docs/EXPERIMENT_PROTOCOL.md` requires each experiment run to record the
  network and chain ID. Read them from the registry instead of hardcoding
  numbers in scripts.
