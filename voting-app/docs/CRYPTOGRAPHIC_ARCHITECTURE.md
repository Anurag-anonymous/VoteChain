# Cryptographic Architecture

Status: C0 encrypted baseline.

The active C0 ballot layer now uses randomized AES-256-GCM encryption for ballot
payloads. The credential layer is still an election-scoped HMAC construction,
not a zero-knowledge anonymous credential. The tally coordinator is still a
single-process development coordinator, not threshold decryption.

The production boundary now fails closed unless a deployed Semaphore verifier
and `ELECTION_BALLOT_ENCRYPTION_MODE=threshold-elgamal` are configured. The
modular contracts record only encrypted ballot and proof commitments and
require a 3-of-5 signed trustee quorum for a tally commitment. These guards do
not claim that the external cryptographic implementations are audited.

Eligibility Authority approvals now deliver a versioned
`jcj-civitas-v1-envelope` instead of placing the raw bearer credential in the
signed callback. VoteChain decrypts the envelope only for the authenticated
eligible account and verifies its commitment before returning it. The `JcjCivitasCredentialProvider` now implements a concrete finite-field
Fiat–Shamir Schnorr credential proof, election-scoped nullifiers, and
commitment-based fake credentials. Its private registry determines whether a
credential is genuine or fake during cleansing. This remains a research
implementation requiring independent cryptographic audit before real public
elections; the legacy HMAC provider remains development-only.

## Design rule

Split the voting system into four replaceable capabilities. Each capability has
one interface class and at least one active implementation:

| Capability | Interface | Active C0 implementation | Remaining replacement target |
| --- | --- | --- | --- |
| Eligibility decision | `services/eligibility-authority/EligibilityAuthority.js` | same class (in-memory registry) | Aadhaar/electoral-roll service |
| Election-scoped credential | `services/credentials/CredentialProvider.js` | `ElectionCredentialProvider.js` | Semaphore/BBS+/CL-style anonymous credential |
| Ballot confidentiality | `services/ballots/BallotService.js` | `EncryptedBallotService.js` using AES-256-GCM | Threshold/homomorphic election encryption |
| Verifiable tally | `services/tally/TallyCoordinator.js` | development share-count coordinator | Threshold decryption + NIZK |

Composition root: `backend/src/protocol/index.js`.

## Current C0 behaviour

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

### ElectionCredentialProvider
- `issueCredential` builds a credential id as `HMAC-SHA256(issuerSecret, electionId, subjectId)`.
- `proveEligibility` throws for a credential issued for another election or for a
  revoked credential, then returns `{ electionId, nullifier, proof }`.
- The nullifier is `HMAC(issuerSecret, credentialId, electionId, scope)`, so it
  is stable per election and scope. This is what makes double-voting detectable
  without storing the voter id on the ballot. This credential provider is not an
  anonymous credential system.

### EncryptedBallotService
- `createEncryptedBallot({ electionId, candidateId, eligibilityProof })` returns
  an AES-256-GCM ciphertext. The plaintext contains the election id and option
  commitment, and the associated data binds the ciphertext to the nullifier.
- The encryption IV is random for every ballot, so two ballots for the same
  option produce different ciphertexts.
- `verifyBallot` verifies the ballot integrity proof and delegates eligibility
  proof checks to the credential provider.

### Development tally coordinator
- `registerTrustee`, `submitShare`, `canFinalize`, and `finalizeTally` implement a
  share-count threshold. No distributed trustee process or public tally proof is
  implemented yet.
- `finalizeTally` throws until the threshold is met, then returns the accepted
  share count and the public ballot count.

## Protocol versions

`Poll.protocolVersion` selects the flow. The value set is frozen in
`PROTOCOL_VERSIONS` and enforced by the schema enum.

- `legacy-plaintext`: the original flow. Plaintext option text and
  per-user `voters` entries are stored, results are public immediately, and
  `/api/polls/:pollId/vote` is the write path.
- `c0-encrypted` (default): the C0 flow. Ballots carry an eligibility proof and
  a nullifier, results stay hidden until finalization, and
  `/api/polls/:pollId/ballot` is the write path.
- `c0-mock-encrypted`: accepted only for backward compatibility with old local
  records and tests.

`isEncryptedProtocolVersion(version)` is the single predicate used by the model
and controllers, so the two flows cannot diverge on version checks.

## Environment controls

- `C0_PROTOCOL_ENABLED` (default `true`): when `false`, creating a C0 encrypted
  poll and casting or finalizing encrypted ballots are rejected. The legacy
  `RESEARCH_PROTOCOL_ENABLED` name is accepted only when `C0_PROTOCOL_ENABLED`
  is not set.
- `RESEARCH_TALLY_THRESHOLD` (default `1`): development trustee share threshold. Values
  above `1` make finalization fail with the collected-vs-required share count,
  which is useful for exercising the failure path.
- `C0_CREDENTIAL_ISSUER_SECRET`: server-side HMAC secret for credential ids and
  nullifiers.
- `C0_BALLOT_ENCRYPTION_SECRET`: server-side secret used to derive the AES-256-GCM
  ballot encryption key.

## Deliberate non-goals

C0 does not yet provide anonymous credentials, threshold decryption,
voter-verifiable receipts, coercion resistance, or receipt-freeness. See
[THREAT_MODEL.md](./THREAT_MODEL.md) and
[SECURITY_ASSUMPTIONS.md](./SECURITY_ASSUMPTIONS.md).
