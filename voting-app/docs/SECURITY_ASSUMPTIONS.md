# Security Assumptions

Phase 2 does not provide production election security. It creates boundaries for
later secure implementations. See [THREAT_MODEL.md](./THREAT_MODEL.md) for the
accepted weaknesses and [CRYPTOGRAPHIC_ARCHITECTURE.md](./CRYPTOGRAPHIC_ARCHITECTURE.md)
for where each mock lives.

Current assumptions:

- Synthetic identity data is used for research only.
- Mock credentials are not anonymous. A credential id and the nullifier derived
  from it are deterministic per election, so the backend can link a ballot to an
  account.
- Mock ballots are not encrypted. `MockBallotService` hashes the candidate with
  randomness; it provides no confidentiality against anyone who can enumerate
  candidates.
- Mock tallying does not perform decryption or proof verification. It only counts
  trustee shares and requires a threshold.
- The legacy plaintext poll flow is the default (`protocolVersion:
  legacy-plaintext`) and remains a prototype path until Phase 3 replaces it. The
  `c0-mock-encrypted` flow is opt-in per poll.
- The encrypted flow hides vote counts until finalization, but the poll document
  still contains a plaintext `tallyHintOptionId` per accepted ballot. That field
  is never returned by the API and must not be treated as confidential.
- Backend-held wallet private keys are acceptable only for local prototype
  migration work and must be removed from the research voting path.
- `loadDeployment` requires the manifest chain ID to match the registry, so a
  manifest cannot silently point at the wrong network. Manifest addresses are
  still placeholders.
- The research surface can be disabled with `RESEARCH_PROTOCOL_ENABLED=false`,
  which is the recommended setting for any demo of the prototype path.

Future secure phases must replace each mock provider with an established
primitive or document why a property is not provided.
