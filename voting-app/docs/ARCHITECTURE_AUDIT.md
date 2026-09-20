# Architecture Audit

Status: Phase 2 audit of the existing repository, plus the alignment work done in
this phase. Findings are grouped by area with the current disposition.

## 1. Documentation state

| Finding | Impact | Disposition |
| --- | --- | --- |
| `docs/ARCHITECTURE.md`, `docs/THREAT_MODEL.md`, `docs/CRYPTOGRAPHIC_ARCHITECTURE.md`, `docs/NETWORK_COMPATIBILITY.md` were UTF-16LE with 2-6 lines of stub content | Unreadable as Markdown and unusable as references | Rewritten as UTF-8 with real content |
| Two competing doc sets existed: root `ARCHITECTURE.md` / `THREAT_MODEL.md` and `docs/*` | Ambiguous authority for reviewers | `docs/` is authoritative for the research program; root `ARCHITECTURE.md` describes the prototype app only |
| `docs/` was entirely untracked in git | Docs could be lost | Left for the repository owner to commit as a single documentation change |
| `SETUP.md` and `README.md` documented Mumbai (80001) and `rpc-mumbai.maticvigil.com` | Operators could not follow the documented setup | Updated to Anvil 31337 primary with Amoy 80002 for testnet |

## 2. Network configuration

| Finding | Impact | Disposition |
| --- | --- | --- |
| `docs/NETWORK_COMPATIBILITY` and the registry disagreed on chain ID for the legacy Mumbai key | Deployments could target the wrong chain | Mumbai removed as a network; `mumbai` kept only as an alias resolving to Amoy |
| Registry had no default-network constant, no signing policy helper, and no manifest validation | Scattered defaults and no guard against stale manifests | Added `DEFAULT_NETWORK_KEY`, `DEFAULT_CHAIN_ID`, `NETWORK_ALIASES`, `listNetworks`, `canSignLocally`, and manifest `contractName`/`chainId` validation |
| `backend/src/config/blockchain.js` falls back to the Amoy branch when `BLOCKCHAIN_NETWORK` is unset | A missing env value silently targets a public testnet | Documented as a deliberate backwards-compatibility branch; `BLOCKCHAIN_NETWORK` is set explicitly in `.env.example` and by `setup-local.ps1` |

## 3. Protocol boundary

| Finding | Impact | Disposition |
| --- | --- | --- |
| `createPhaseTwoProtocol` hardcoded a tally threshold of 3 with no way to change it | The mock tally could never finalize in the single-trustee backend path | Threshold now comes from `RESEARCH_TALLY_THRESHOLD` (default 1) |
| No shared protocol instance | Credentials issued for a ballot could not be verified by a later tally call | Added `getPhaseTwoProtocol` / `resetPhaseTwoProtocol` |
| `Poll.protocolVersion` defaulted to `c0-mock-encrypted` | Every poll created through the plaintext API was mislabelled and its results were hidden | Default is now `legacy-plaintext`; the enum reads from `PROTOCOL_VERSIONS` |
| `Poll.getResults()` hid results for every poll | The dashboard stopped showing counts for the prototype flow | Hiding is now conditional on `Poll.usesEncryptedProtocol()` |
| `Poll.addEncryptedBallot` assumed `ballot.eligibilityProof.nullifier` existed | A malformed ballot produced a `TypeError` instead of a validation error | Explicit guard with a clear message |
| No API write path for the encrypted protocol | The boundary was not exercisable outside unit tests | Added `POST /api/polls/:pollId/ballot` and `POST /api/polls/:id/finalize` in `researchProtocolController.js` |
| No way to disable the research surface | The mock path could not be turned off for an operator demo of the prototype | `RESEARCH_PROTOCOL_ENABLED` gates creation, ballot casting, and finalization |

## 4. Test coverage

- `backend/src/__tests__/phase2Protocol.test.js` covers the four mock
  capabilities, protocol version wiring, result visibility, the nullifier
  duplicate check, threshold enforcement, and the runtime registry helpers.
- The suite is pure unit test: no MongoDB and no chain required.
- `smart-contracts/test/voting_poll_test.js` still needs a live Truffle network,
  so it is not part of the offline test run.

## 5. Open items for later phases

1. Replace the five placeholder deployment manifests with real addresses and ABIs
   once the contract set exists.
2. Remove backend-held wallet private keys from the research voting path.
3. Commit the currently untracked Phase 2 tree (`docs/`, `deployments/`,
   `scripts/*`, `tools/`, `backend/src/services/*`, `backend/src/protocol/`).
4. Add integration tests that exercise the ballot and finalize endpoints against
   an in-memory MongoDB instance.