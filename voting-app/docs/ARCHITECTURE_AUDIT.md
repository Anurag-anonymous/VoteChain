# Architecture Audit

Status: architecture audit of the existing repository, plus the C0 alignment
work. Findings are grouped by area with the current disposition.

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
| `createPhaseTwoProtocol` hardcoded a tally threshold of 3 with no way to change it | The development tally could never finalize in the single-trustee backend path | Threshold now comes from `RESEARCH_TALLY_THRESHOLD` (default 1) |
| No shared protocol instance | Credentials issued for a ballot could not be verified by a later tally call | Added `getC0Protocol` / `resetC0Protocol`, with legacy aliases kept |
| `Poll.protocolVersion` defaulted to the old mock encrypted value | Every poll created through the plaintext API was mislabelled and its results were hidden | New polls now use `c0-encrypted`; old local `c0-mock-encrypted` records remain readable |
| `Poll.getResults()` hid results for every poll | The dashboard stopped showing counts for the prototype flow | Hiding is now conditional on `Poll.usesEncryptedProtocol()` |
| `Poll.addEncryptedBallot` assumed `ballot.eligibilityProof.nullifier` existed | A malformed ballot produced a `TypeError` instead of a validation error | Explicit guard with a clear message |
| No API write path for the encrypted protocol | The boundary was not exercisable outside unit tests | Added `POST /api/polls/:pollId/ballot` and `POST /api/polls/:id/finalize` in `researchProtocolController.js` |
| No way to disable the encrypted surface | The C0 path could not be turned off for an operator demo of the prototype | `C0_PROTOCOL_ENABLED` gates creation, ballot casting, and finalization; the old `RESEARCH_PROTOCOL_ENABLED` flag is a fallback |

## 4. Test coverage

- `backend/src/__tests__/phase2Protocol.test.js` covers the C0 credential,
  ballot, and development tally capabilities, protocol version wiring, result
  visibility, the nullifier duplicate check, threshold enforcement, and the
  runtime registry helpers.
- The suite is pure unit test: no MongoDB and no chain required.
- `smart-contracts/test/voting_poll_test.js` still needs a live Truffle network,
  so it is not part of the offline test run.

## 5. Open items for later phases

1. Replace the five placeholder deployment manifests with real addresses and ABIs
   once the contract set exists.
2. Remove backend-held wallet private keys from the research voting path.
3. Commit the currently untracked C0 tree (`docs/`, `deployments/`,
   `scripts/*`, `tools/`, `backend/src/services/*`, `backend/src/protocol/`).
4. Add integration tests that exercise the ballot and finalize endpoints against
   an in-memory MongoDB instance.

## 6. Production-readiness checkpoint

The following requirements are intentionally **not** marked production-complete:

- `VotingPoll.sol` is still the legacy wallet-address/plaintext-results
  contract; `EncryptedBallotRegistry.sol` stores encrypted-ballot receipts but
  is not a complete election manager, proof verifier, or threshold tally.
- `ElectionCredentialProvider` is an HMAC bearer-credential prototype, not a
  Semaphore, BBS+, or zero-knowledge anonymous credential.
- `DevelopmentTallyCoordinator` models a share threshold in one process; it is
  not distributed threshold decryption.
- The deployment manifests are placeholders until actual contracts are
  deployed; they must not be used as production addresses.
- The separate Eligibility Authority now fails closed on missing secrets and
  rejects replayed signed integration requests, but it remains a trusted
  human-review service with encrypted local file storage.

These limitations are security boundaries, not configuration switches. They
must be resolved with independently reviewed cryptographic and contract
implementations before describing the system as production-grade or formally
coercion-resistant.

## 7. Encrypted bulletin-board contract boundary

`smart-contracts/contracts/ElectionBallotBox.sol` is now the production
deployment baseline for publishing election-scoped ciphertext commitments. It
enforces election opening/closing windows, nullifier uniqueness, finalization,
and does not store a voter address or candidate plaintext. The legacy
`VotingPoll` and receipt-only registry contracts remain deployable only for
non-production regression tests; production migrations exclude them.

This contract intentionally does not claim to verify a zero-knowledge proof or
decrypt/tally a ballot. A reviewed anonymous credential verifier and
independent threshold trustees must be integrated before a live election is
authorized.

The modular contract set now includes `ElectionManager`, `Election`,
`BallotBox`, and `TallyVerifier`. `BallotBox` records encrypted ciphertext and
proof commitments, enforces deadlines, and supports C1 sequence supersession
without a wallet-to-vote mapping. `TallyVerifier` requires three distinct
approvals from a configured five-trustee set for one tally commitment.

The backend production gate requires explicit Semaphore verifier and
threshold-ElGamal configuration. It rejects password-based panic mode and C3
padding unless the JCJ verifier and prerequisite verifier are explicitly
enabled. This is deliberately fail-closed: configuration flags do not
substitute for an audited implementation.
