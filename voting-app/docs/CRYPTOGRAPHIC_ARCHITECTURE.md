# Cryptographic Architecture

Status: Phase 2 research prototype. Nothing in this document is production
cryptography. Every primitive is a mock chosen to establish a boundary that a
later phase replaces.

## Design rule

Split the voting system into four replaceable capabilities. Each capability has
one interface class and at least one mock implementation, and each mock response
carries a `securityNotice` string:

| Capability | Interface | Mock implementation | Real replacement target |
| --- | --- | --- | --- |
| Eligibility decision | `services/eligibility-authority/EligibilityAuthority.js` | same class (in-memory registry) | Aadhaar/electoral-roll service |
| Anonymous credential | `services/credentials/CredentialProvider.js` | `MockCredentialProvider.js` | BBS+/CL signature credential |
| Ballot confidentiality | `services/ballots/BallotService.js` | `MockBallotService.js` | ElGamal/Paillier homomorphic encryption |
| Verifiable tally | `services/tally/TallyCoordinator.js` | `MockTallyCoordinator.js` | Threshold decryption + NIZK |

Composition root: `backend/src/protocol/index.js`.

## Current mock behaviour

### EligibilityAuthority
- `registerVoter({ voterId, identityRef, electionId })` records the voter against
  one election. The in-memory store is keyed by
  `sha256(electionId:voterId)`, so records are never looked up by raw identity,
  though `identityRef` itself is kept as provided for this process only.
- `verifyEligibility({ voterId, electionId, eligible })` marks the record
  eligible (default `true`) and stamps `verifiedAt`.
- `issueCredential({ voterId, electionId, credentialProvider })` throws for an
  ineligible or revoked voter, then delegates issuance so the authority never
  hands raw identity to the credential provider.
- `revokeCredential({ voterId, electionId })`, `getCredentialStatus`, and
  `getRecordKey` complete the boundary.

### MockCredentialProvider
- `issueCredential` builds a credential id as `HMAC-SHA256(issuerSecret, ...)`.
  With `deterministicCredentialIds: true` (the runtime default) it is derived
  only from `electionId` and `subjectId`, so a voter always receives the same
  credential for one election.
- `proveEligibility` throws for a credential issued for another election or for a
  revoked credential, then returns `{ electionId, nullifier, proof }`.
- The nullifier is `HMAC(issuerSecret, credentialId, electionId, scope)`, so it
  is stable per election and scope. This is what makes double-voting detectable
  without storing the voter id on the ballot - and it is also why the scheme is
  not anonymous.

### MockBallotService
- `createEncryptedBallot({ electionId, candidateId, eligibilityProof })` returns
  `mock-ciphertext` derived from `sha256('mock-ciphertext', electionId, candidateId, randomness)`.
  It is a hash, not a ciphertext: the field name is aspirational.
- `randomnessCommitment` is a hash of fresh 32-byte randomness.
- `verifyBallot` delegates to `credentialProvider.verifyEligibilityProof`, which
  only checks that the proof object has the expected shape.

### MockTallyCoordinator
- `registerTrustee`, `submitShare`, `canFinalize`, and `finalizeTally` implement a
  share-count threshold. No share is verified and no decryption happens.
- `finalizeTally` throws until the threshold is met, then returns the accepted
  share count and the public ballot count.

## Protocol versions

`Poll.protocolVersion` selects the flow. The value set is frozen in
`PROTOCOL_VERSIONS` and enforced by the schema enum.

- `legacy-plaintext` (default): the original flow. Plaintext option text and
  per-user `voters` entries are stored, results are public immediately, and
  `/api/polls/:pollId/vote` is the write path. Keeping it as the default means
  existing clients and stored polls keep working.
- `c0-mock-encrypted`: the research flow. Ballots carry an eligibility proof and
  a nullifier, results stay hidden until finalization, and
  `/api/polls/:pollId/ballot` is the write path.

`isEncryptedProtocolVersion(version)` is the single predicate used by the model
and controllers, so the two flows cannot diverge on version checks.

## Environment controls

- `RESEARCH_PROTOCOL_ENABLED` (default `true`): when `false`, creating a
  `c0-mock-encrypted` poll and casting or finalizing encrypted ballots are
  rejected with HTTP 400.
- `RESEARCH_TALLY_THRESHOLD` (default `1`): mock trustee share threshold. Values
  above `1` make finalization fail with the collected-vs-required share count,
  which is useful for exercising the failure path.

## Deliberate non-goals

The mock layer does not attempt voter-verifiable receipts, coercion resistance,
or receipt-freeness. See [THREAT_MODEL.md](./THREAT_MODEL.md) for the full list of
accepted weaknesses and [SECURITY_ASSUMPTIONS.md](./SECURITY_ASSUMPTIONS.md) for
the assumptions those weaknesses depend on.