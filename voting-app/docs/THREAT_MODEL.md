# Threat Model

Status: Phase 2 research prototype. This document records what the current
system actually protects and what it explicitly does not.

## Assets

- Voter identity records (name, Aadhaar reference, email, phone, wallet address).
- Credentials issued per election and the nullifiers derived from them.
- Ballot contents (the chosen candidate).
- Trustee shares and the final tally.
- Wallet private keys held by the backend for the local prototype.

## Adversaries

1. **Passive chain observer** - sees public chain data only: timing, block
   number, gas use, calldata size, method and event patterns, transaction
   sequence metadata. This is the adversary the experiment matrix targets.
2. **Active network attacker** - can drop, reorder, or replay HTTP traffic to the
   API between the browser and the backend.
3. **Single backend operator** - runs the Express process and the local chain.
4. **Curious other user** - an authenticated voter looking at other voters' data
   through the API.

## What the current design does provide

- Poll creation, voting, and closing require a JWT from `verifyToken`, and poll
  writes additionally require `verifyAadhar`.
- Votes must be cast with the wallet address already linked to the account;
  a mismatch is rejected with `Votes must be cast with your linked wallet address`.
- On-chain calls are signed by the user's own generated wallet key, not by a
  shared service key, so `msg.sender` distinguishes voters on-chain.
- Encrypted-protocol ballots cannot double-vote: `Poll.addEncryptedBallot` and
  `Poll.hasNullifierVoted` reject a reused nullifier unless the poll explicitly
  allows multiple votes.
- Encrypted-protocol results stay hidden until the tally is finalized:
  `Poll.getResults()` returns `votes: null` while `tallyState` is `hidden`.
- The legacy `/vote` endpoint refuses encrypted-protocol polls, and the ballot
  endpoint refuses legacy polls, so the two paths cannot be mixed on one poll.
- Mock services return a `securityNotice` in every payload so mock output cannot
  be mistaken for a real guarantee.

## What the current design does NOT provide

- **No ballot secrecy.** `MockBallotService` hashes the candidate together with
  randomness; it does not encrypt. Anyone with the randomness commitment and the
  candidate list can test candidate guesses offline.
- **No anonymity.** `MockCredentialProvider` derives a deterministic credential
  from `electionId` and `subjectId`, so the backend can link a credential back to
  the account, and therefore link a ballot (via nullifier) to a voter.
- **No verifiable tally.** `MockTallyCoordinator` enforces a share threshold but
  performs no decryption and produces no correctness proof. The tally counts rely
  on `tallyHintOptionId`, a plaintext field kept in the poll document.
- **No trustee separation.** A single backend process holds the only mock trustee
  share and can finalize any election.
- **No transport or storage hardening for research data.** Access control stops
  at JWT + Aadhaar middleware; there is no per-ballot authorization beyond the
  nullifier check.
- **No protection against a malicious backend.** The backend can read every
  credential, nullifier, and eligibility proof, and can drop ballots before they
  are stored.

## Known weaknesses

| ID | Weakness | Where | Impact |
| --- | --- | --- | --- |
| T1 | Backend stores wallet private keys | `models/User.js`, `pollController.js` | Full compromise of every voter wallet if the DB leaks |
| T2 | Deterministic mock credentials | `MockCredentialProvider.issueCredential` | Ballots are linkable to voters |
| T3 | Plaintext tally hint | `Poll.encryptedBallots.tallyHintOptionId` | Ballot choice is readable in the DB |
| T4 | Mock proofs are HMAC-based | `Mock*` services | Nothing is actually verified |
| T5 | Single mock trustee | `researchProtocolController.finalizeTally` | No quorum; operator can finalize alone |
| T6 | Mumbai values in legacy docs | `SETUP.md`, `README.md` | Operator confusion and failed deployments |

T1-T5 are accepted only for the local research prototype. Each must be replaced
by a real primitive before any production claim. T6 is a documentation fix.

## Out of scope for Phase 2

- Coercion resistance and receipt-freeness.
- End-to-end verifiable client-side encryption.
- Threshold decryption across independent trustees.
- Sybil resistance beyond the prototype Aadhaar verification path.
