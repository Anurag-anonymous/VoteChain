# Threat Model

Status: C0 encrypted baseline prototype. This document records what the current
system protects and what it explicitly does not.

## Assets

- Voter identity records: name, Aadhaar reference, email, phone, wallet address.
- Election credentials and per-election nullifiers.
- Encrypted ballot payloads and the backend encryption secret.
- Trustee shares and finalized tally data.
- Wallet private keys held by the backend for the local prototype.

## Adversaries

1. **Passive chain observer** - sees public chain data only: timing, block
   number, gas use, calldata size, method and event patterns, transaction
   sequence metadata.
2. **Active network attacker** - can drop, reorder, or replay HTTP traffic to
   the API between the browser and backend.
3. **Single backend operator** - runs the Express process, database, and local
   chain.
4. **Curious authenticated user** - tries to view other users' private data
   through the API.

## What The Current Design Provides

- Poll creation, voting, and closing require a JWT from `verifyToken`, and poll
  writes additionally require `verifyAadhar`.
- Votes must be cast with the wallet address linked to the account; mismatches
  are rejected.
- Legacy on-chain calls can be signed by a generated user wallet, so `msg.sender`
  can distinguish users when that path is enabled.
- C0 ballots cannot double-vote: `Poll.addEncryptedBallot` and
  `Poll.hasNullifierVoted` reject a reused nullifier unless the poll explicitly
  allows multiple votes.
- C0 ballot choices are stored as AES-256-GCM ciphertexts, not plaintext option
  ids.
- C0 results stay hidden until finalization: `Poll.getResults()` returns
  `votes: null` while `tallyState` is `hidden`.
- The legacy `/vote` endpoint refuses encrypted-protocol polls, and the ballot
  endpoint refuses legacy polls, so the paths cannot be mixed on one poll.
- Both ballot endpoints require an approved decision from the separate
  Eligibility Authority. The VoteChain backend receives only a signed decision,
  an opaque authority subject, and its credential commitment; private authority
  fields are excluded from ordinary user responses.

## What The Current Design Does Not Provide

- **No anonymous voting.** `ElectionCredentialProvider` is deterministic and
  backend-issued, so the backend can link credential issuance to an account.
- **No backend privacy.** The backend holds `C0_BALLOT_ENCRYPTION_SECRET` and can
  decrypt ballots during finalization.
- **No end-to-end verifiability.** `DevelopmentTallyCoordinator` does not produce
  public correctness proofs.
- **No independent trustee model.** A single backend process can provide the
  development trustee share and finalize an election.
- **No complete storage hardening.** Access control stops at JWT + Aadhaar
  middleware; there is no per-ballot storage encryption beyond the C0 ballot
  ciphertext itself.
- **No protection against a malicious backend.** The backend can read every
  credential request, nullifier, and eligibility proof, and can drop ballots
  before storage.
- **No independently proven identity.** The Eligibility Authority is a separate
  application and review process, but reviewers must still check identity
  evidence themselves. The prototype stores no supporting documents and OTP
  flags alone are not identity proof.
- **No formal anonymous credentials.** The authority-issued subject is an
  opaque random handle, while VoteChain creates its own election-scoped
  credentials. The backend can still correlate its account database, private
  subject, and election activity.
- **No trusted institutional separation by deployment alone.** The authority's
  encrypted store and signed API reduce direct database coupling, but the
  authority operator and VoteChain operator remain trusted, and the authority
  must be deployed behind HTTPS with protected HMAC and encryption keys.

## Known Weaknesses

| ID | Weakness | Where | Impact |
| --- | --- | --- | --- |
| T1 | Backend stores wallet private keys | `models/User.js`, `pollController.js` | Full compromise of generated voter wallets if the DB leaks |
| T2 | Deterministic backend-issued credentials | `ElectionCredentialProvider.issueCredential` | The backend can link voters to credentials |
| T3 | Backend-held ballot key | `EncryptedBallotService` | Backend can decrypt every ballot |
| T4 | Plaintext tally hint | `Poll.encryptedBallots.tallyHintOptionId` | Ballot choice is readable in the DB if this development field is inspected |
| T5 | Development-only tally coordinator | `DevelopmentTallyCoordinator` | No public proof or independent trustee separation |
| T6 | Human authority review and shared integration secrets | `eligibility-authority/`, `eligibilityAuthorityClient.js` | A compromised reviewer or operator can approve an ineligible account; key compromise can forge enrollment/decision messages |

T1-T5 are accepted only for the local C0 baseline. Each must be replaced before
making a production security claim.

## Out Of Scope For C0

- Coercion resistance and receipt-freeness.
- Anonymous credential systems or zero-knowledge eligibility proofs.
- End-to-end verifiable client-side encryption.
- Threshold decryption across independent trustees.
- Sybil resistance beyond the prototype Aadhaar verification path.
