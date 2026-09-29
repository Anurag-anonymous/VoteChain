# Security Assumptions

The C0 encrypted baseline improves the old local prototype by storing randomized
encrypted ballots instead of plaintext selections. It still does not provide
production election security. See [THREAT_MODEL.md](./THREAT_MODEL.md) and
[CRYPTOGRAPHIC_ARCHITECTURE.md](./CRYPTOGRAPHIC_ARCHITECTURE.md).

Current assumptions:

- Synthetic identity data is used for local development only.
- Election credentials are deterministic HMAC credentials. They are useful for
  one-vote-per-election nullifiers, but they are not anonymous credentials.
- Ballots are encrypted with AES-256-GCM using `C0_BALLOT_ENCRYPTION_SECRET`.
  This is real authenticated encryption, but the backend holds the key.
- The backend can link a credential request to a user account, and can decrypt
  ballots during tally finalization.
- Development tallying does not perform public proof verification, threshold
  decryption, or homomorphic aggregation. It decrypts stored C0 ballots inside
  the backend and counts them after the configured share threshold is met.
- The encrypted flow hides vote counts until finalization, but the poll document
  still contains `tallyHintOptionId` for development diagnostics. That field is
  never returned by the API and must not be exported in experiment datasets.
- The legacy plaintext poll flow remains available for compatibility and must
  not be described as private.
- Backend-held wallet private keys are acceptable only for local prototype
  migration work and must be removed from any production-oriented flow.
- `loadDeployment` requires the manifest chain ID to match the registry, so a
  manifest cannot silently point at the wrong network. Manifest addresses still
  need to be kept current by the operator.
- The C0 surface can be disabled with `C0_PROTOCOL_ENABLED=false` or the legacy
  compatibility flag `RESEARCH_PROTOCOL_ENABLED=false`.
- C2 does not implement formal JCJ-style coercion resistance. The design assumes
  a trusted registrar can privately mark some credentials as `panic` or `genuine`
  and then run a private cleansing step before tally finalization. The public
  election layer stores only a credential commitment and nullifier; it does not
  store a public `panic=true` flag or any type label.
- C2/C3 credential labels and credential values are encrypted in the private
  `PrivateCredentialRecord` collection using `C2_REGISTRY_ENCRYPTION_KEY`.
  The database must remain connected for issuance and finalization, and the key
  must be backed up and retained. The backend (or registrar process) decrypts
  the records and excludes ballots whose commitments map to panic credentials.
  This is a trust assumption, not a cryptographic guarantee of deniable voting.
- A panic or decoy credential is not identifiable from a special contract flag,
  chain event, or public ballot field. The only observable signal is that a
  trusted registrar excluded ballots during the private cleansing step.

Future secure phases must replace backend-held credential and ballot secrets
with client-side encryption, anonymous eligibility proofs, independent trustees,
and publicly verifiable tally proofs.
# Production gate

When `NODE_ENV=production`, the backend fails closed unless strong JWT,
credential-issuer, and ballot-encryption secrets are configured and the
database URI is not a local development endpoint. Production startup also
rejects Anvil/local blockchain selection and disabled encrypted protocol mode.
