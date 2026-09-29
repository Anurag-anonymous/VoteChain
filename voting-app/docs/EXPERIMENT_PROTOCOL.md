# Experiment Protocol

Status: a study-specific runner, common commit-reveal contract, independent
auditor, and statistical analysis pipeline are implemented. Full paper
campaigns have not yet been collected; smoke runs are pipeline checks only.
The study runner is separate from the application's MongoDB ballot routes.
Observer predictions are measurements under a passive metadata model, not a
cryptographic anonymity proof. See
[CRYPTOGRAPHIC_ARCHITECTURE.md](./CRYPTOGRAPHIC_ARCHITECTURE.md) and
[THREAT_MODEL.md](./THREAT_MODEL.md).

## Modular study execution

The paper configurations are independent run profiles in
`backend/src/config/researchStudy.js`: `C0`, `C1`, `C2`, `C3`, `C1p`, and
`C2p`. Generate a run manifest with:

```powershell
npm run experiment:manifest -- --configuration C1p --network anvil --population 1000 --repetitions 5 --seed c1p-1000-r1
```

The manifest records the condition, network, population, repetitions, seed,
contract phase durations, selected action rates, and required
cost/storage/auditor/observer measurements. Padded profiles require all six
padding parameters.

Generate the draft's full per-run plan with
`npm run experiment:campaign -- --network anvil ...` or `--network
polygon-amoy ...`. The planner emits 70 Anvil or 42 Amoy run entries. Execute
the matrix with `npm run experiment:run -- --network anvil ...`; the
Polygon Amoy runner requires both `--confirm-public-chain` and funded, unique
actor keys. Use the [experiment runner guide](../scripts/experiments/README.md)
for complete commands, key-file format, outputs, and analysis instructions.
Results are stored under the Git-ignored `research-runs/` directory; actor
private keys are never written there.

`ResearchElection` is a benchmarking contract: it enforces timed commit and
reveal phases, supports superseding commits, checks openings, and publishes a
reconstructable tally commitment. Anvil deadlines are advanced locally after
phase actions; Amoy deadlines use real time. The runner serializes writers to
each network and marks incomplete runs as failed.

Padding and action-rate defaults (20% revoting, 10% panic actions, and 20%
padding) are explicit assumptions because the pre-results manuscript does not
fully specify these values. Fix them before running the primary campaign.

## Configuration Labels

The following table describes application routes only. The empirical runner
uses the common `ResearchElection` contract and synthetic participants; its C2
panic, C2p decoy, and C1p padding semantics are bounded as documented in
`RESEARCH_READINESS.md`.

| Label | Flow | Write path |
| --- | --- | --- |
| `L0` | `legacy-plaintext`, database-only | `POST /api/polls/:pollId/vote` |
| `L1` | `legacy-plaintext`, with chain call | `POST /api/polls/:pollId/vote` |
| `C0` | `c0-encrypted`, database-only | `POST /api/polls/:pollId/ballot` |
| `C1` | `c0-encrypted`, revoting enabled (chain receipts optional) | `POST /api/polls/:pollId/ballot` |
| `C2` | `c2-private-decoy`, encrypted ballot + private panic cleansing | `POST /api/polls/:pollId/ballot` |
| `C3` | `c3-revoting-decoy`, C1 replacement + C2 private panic cleansing | `POST /api/polls/:pollId/ballot` |
| `C1p` | C1 revoting plus configurable indistinguishable padding receipts | `POST /api/polls/:pollId/ballot` |
| `C2p` | C2 panic/decoy cleansing plus configurable padding receipts | `POST /api/polls/:pollId/ballot` |

Never describe a legacy run as private: the legacy path stores plaintext options.

## Required Record Per Run

Each executed run records:

- git commit hash;
- network key, chain ID, contract address, deployment transaction, and block
  range;
- Solidity compiler and Node.js versions;
- population size;
- revote and panic action rates and, for C1p/C2p, padding rate, selection
  strategy, timing distribution/window, dummy actions, and declared population;
- commit and reveal duration, option count, configuration, and run seed;
- configuration label from the table above;
- start/end UTC timestamps and output dataset location.

The per-run output separates `public-records.json` from
`private-labels.json` and `private-scenario.json`. Do not merge or publish the
private labels with the public observer input. Gas is measured from transaction
receipts. Storage is a model of non-zero Solidity data slots, not state-trie or
node-database bytes. The separate auditor verifies contract events and reveal
commitments; it does not verify a zero-knowledge tally proof.

## Protocol Controls That Affect A Run

- `C0_PROTOCOL_ENABLED` (default `true`): when `false`, the `c0-encrypted` write
  path returns HTTP 400. The legacy `RESEARCH_PROTOCOL_ENABLED` flag is also
  accepted for backward compatibility.
- `RESEARCH_TALLY_THRESHOLD` (default `1`): development trustee share threshold
  for `POST /api/polls/:id/finalize`.
- `C1_REVOTING_ENABLED` (default `false`): when `true`, a voter may submit a
  replacement commitment while the poll is active. The prior ballot is marked
  superseded and only the final active ballot contributes to the tally. When
  `false`, the first ballot is permanent (C0 control condition), even if the
  legacy `allowMultipleVotes` poll field is set.
- `C1_CHAIN_RECEIPTS_ENABLED` (default `false`): optional on-chain receipt
  anchoring. Keep this `false` for the local experimental C1 run; enabling it
  adds one registry transaction per accepted replacement.
- C1p/C2p require `BLOCKCHAIN_ENABLED=true`,
  `C1_CHAIN_RECEIPTS_ENABLED=true`, `DATABASE_ENABLED=true`, and a deployed
  `EncryptedBallotRegistry`; poll creation fails clearly when a prerequisite is
  absent.
- C1p/C2p `paddingConfig` is supplied per poll and kept private from public poll
  responses. Its controls are:
  - `paddingRatePercent` (0-100): share of declared voters sampled, or
    per-ballot sampling probability depending on `selectionStrategy`;
  - `selectionStrategy`: `population-sample` (exact target sampled without
    replacement) or `per-ballot` (independent draw per accepted ballot);
  - `timingDistribution`: `immediate`, `fixed`, `uniform`, or `exponential`;
  - `timingWindowSeconds` (0-60);
  - `dummyTransactionsPerBallot` (0-20, for selected activity);
  - `electionPopulation` (1-10000): declared experiment population and upper
    bound for distinct participants sampled.
- Observer records are capped at 5,000 receipts per padded poll to bound
  embedded-document growth. At capacity, a new padded ballot is rejected before
  it is anchored and the API returns HTTP 503 with `ballotAccepted: false`.
- `C2_REGISTRY_ENCRYPTION_KEY`: required for C2/C3; exactly 32 random bytes
  encoded as 64 hexadecimal characters. It must be kept stable and backed up
  securely. C2/C3 poll creation is refused unless MongoDB is connected and the
  key is valid; ballots/finalization fail explicitly if private records cannot
  be read or decrypted.
- `C0_CREDENTIAL_ISSUER_SECRET`: HMAC secret for deterministic election
  credential issuance.
- `C0_BALLOT_ENCRYPTION_SECRET`: AES-256-GCM key material for ballot encryption.
- `ELIGIBILITY_AUTHORITY_URL` and the two HMAC secrets configure the external
  review service; `ELIGIBILITY_AUTHORITY_CREDENTIAL_KEY` encrypts delivered
  credentials in VoteChain storage. Do not record secret values. The authority's
  signed decision, opaque subject, and credential secret are synchronized over
  the authenticated callback. Ballot clients now send an election-scoped
  Chaum-Pedersen proof instead of the secret, but this experimental custom proof
  is not independently audited and authenticated ballots remain linkable to
  accounts in backend records.
- `BLOCKCHAIN_ENABLED` / `DATABASE_ENABLED`: when `false`, the corresponding
  write path is skipped.

## Independent human eligibility review

The sibling `../eligibility-authority/` directory contains a standalone
Node.js service and reviewer UI with an encrypted-at-rest case store. It has no
VoteChain MongoDB connection or dependency on the application's React bundle.
Registration submits name, email, phone, Aadhaar number, and OTP verification
flags over HMAC-authenticated HTTP; use HTTPS for any non-local deployment.
Applicants can refresh their submission from their profile after completing
OTP verification so reviewers see the latest flags.

An authorized reviewer signs in to the authority UI, checks the applicant's
identity and eligibility against appropriate evidence, and records eligible,
rejected, or needs-information. The prototype does not upload identity
documents; OTP results do not establish legal identity. An approval creates a
random anonymous bearer credential in the authority's encrypted store, then
synchronizes it with the commitment and decision using a separate signed
callback. VoteChain encrypts the credential at rest; an authenticated eligible
user retrieves it from Profile. The ballot UI uses the secret locally to create
an election-scoped Chaum-Pedersen proof and sends the proof rather than the
secret. Both ballot endpoints verify the proof against the approved
commitment. This custom proof is experimental and has not received an
independent cryptographic audit. Both plain and encrypted ballot endpoints
reject accounts without synchronized approval and a valid proof.
Decisions are global to a user, not scoped to an individual poll.

Existing accounts default to `pending` and must submit through the profile page
for authority review. If the authority is down during registration, the account
remains stored but pending; after the authority is available, the user can
submit or refresh the case from Profile. If a decision callback fails, the
authority UI marks synchronization as pending and returns the error to the
reviewer; re-saving the decision retries delivery.

This split does not prove institutional independence or formal anonymous
credentials. VoteChain knows the authenticated account and opaque subject, and
the human reviewer and both operators are trusted. The proof hides the
credential secret from the ballot request; it does not hide the voter's
account from VoteChain or provide unlinkable ballot submission.
Review the sibling authority README for its own environment, key generation,
deployment, and backup instructions.

## Observer Visibility Rules

The passive observer must receive public chain data only: timing, block number,
gas use, calldata size, method/event patterns, and transaction sequence
metadata. The observer must not receive voter identities, private keys,
plaintext choices, credential mappings, nullifiers, C0 secrets, or privileged
backend logs.

API responses must not expose the candidate choice for `c0-encrypted` polls.
`POST /api/polls/:pollId/ballot` returns `ballotId`, `electionId`, `nullifier`,
`acceptedAt`, `tallyState`, and the ballot provider name. `GET
/api/polls/:id/results` returns options with `votes: null` and `hidden: true`
until `POST /api/polls/:id/finalize` succeeds.

## Before The First Recorded Run

1. Replace placeholder deployment manifests with real addresses and ABIs.
2. Decide how the observer is isolated from the backend host.
3. Confirm `Poll.encryptedBallots.tallyHintOptionId` is not exported in any
   dataset, since it reveals the choice behind a ballot.
4. Reconcile the paper's common commit-reveal contract design with the code:
   the current application uses off-chain encrypted ballot storage and a
   separate receipt registry, while `Election`/`BallotBox` contracts are not
   wired into the application write path.
5. Add the independent chain-state auditor and the planned trained observer
   classifiers/statistical analysis before claiming RQ2/RQ3 are answered.

## C1 revoting run

Use the database-only C1 variant when measuring revoting behavior without gas
or registry fees:

```env
C0_PROTOCOL_ENABLED=true
C1_REVOTING_ENABLED=true
C1_CHAIN_RECEIPTS_ENABLED=false
RESEARCH_TALLY_THRESHOLD=1
```

This preserves the encrypted ballot path and replacement semantics while
avoiding an on-chain transaction for each ballot. Enable
`C1_CHAIN_RECEIPTS_ENABLED` only for a separate receipt-anchoring measurement.

## Phase 10: C1p/C2p padding and observer test

Create a `C1p revoting + activity padding` or `C2p panic/decoy + activity
padding` poll. Configure the rate, selection strategy, timing distribution and
window, dummy transaction count, and declared population in the form. C1p
enables replacement ballots; C2p uses private panic credential cleansing.
Padding settings and participant selections are not returned by public poll
APIs.

For each selected accepted ballot, the backend sends the configured number of
additional calls to `submitEncryptedBallotReceipt`, using random bytes32 values
for ballot/nullifier/ciphertext hashes. The ABI method, calldata size, event
shape, and signer are the same as genuine receipt submissions; dummy receipts
are never stored as ballots or counted in the tally. Timed sends run
synchronously before the HTTP request completes, within the configured window.
If a dummy transaction fails after a ballot is accepted, the API explicitly
reports that the ballot succeeded but padding did not complete. Dummy calls use
the voter's linked wallet and consume its test-network gas. These tradeoffs
must be disclosed to experiment participants.

For a no-padding comparison, use a C0/C1/C2 poll with chain receipt anchoring
enabled and record the same controls; C1 uses `C1_REVOTING_ENABLED=true`.
`GET /api/polls/:id/observer-dataset` is creator-authenticated and exports
`publicRecords` separately from `privateLabels`; it includes chain transaction
hashes to join the streams. The exported JSON combines public observations with
private ground truth and must never be given to the passive observer. Keep the
labels file/access restricted to the analyst. Private targets separately mark
revoting, panic credential activity, and (after tally finalization) panic-ballot
exclusion during cleansing. The public record fields are limited to transaction
hash, block/time, gas, calldata length, and submitter.

Compare a no-padding control export and a C1p/C2p export with:

```powershell
node scripts/experiments/analyze-observer.js .\control.json .\padded.json
```

The included observer is intentionally a simple repeated-submitter heuristic.
It reports overall accuracy for the private binary target (revote/panic versus
other activity) and per-target accuracy for revoting, panic activity, and
cleansing exclusion, using public submitter reuse. The comparison checks
whether padding lowered accuracy for these targets. A lower result is evidence
only against this heuristic and this sample; it is not proof that a real
observer cannot infer behavior. Synthetic tests verify that padding can
increase false positives and reduce per-target predictive accuracy.

The cleansing operation itself still occurs off-chain and emits no public
exclusion event. This model permits the experimenter to test whether available
transaction timing/activity predicts private ground-truth labels; it does not
publish or prove which credentials were excluded.

## C2 panic/decoy credential mode

C2 is selected by creating a poll with protocol version
`c2-private-decoy`. It uses the C0 ballot path with these credential rules:

- on a voter's first C2 ballot, the backend creates a stable genuine credential
  and a stable panic/decoy credential for that voter and election;
- they authenticate with either their standard password or a separately
  generated panic login password; the authenticated session selects the
  corresponding credential mode for C2/C3 ballots;
- the registrar privately records the two credentials and their types without
  exposing the label to the public chain;
- only the credential commitment is used in public proof material, so the
  chain sees a commitment hash rather than a credential-type marker;
- panic ballots are stripped from the counted tally during the private
  cleansing step before finalization. The exclusion is performed by the trusted
  registrar / tally operator using the private credential registry; nothing is
  marked `panic=true` on the ballot, contract, or public election record.

The separate MongoDB `PrivateCredentialRecord` collection stores the private
voter-to-credential mapping. Both credential values and their types are
encrypted together with AES-256-GCM; ballot records and the chain receipt layer
do not carry the type label. The application reuses the same credentials after
restart, so their election-scoped nullifiers remain stable.

The voter chooses a distinct panic login password while registering. Logging in
with the same email and this password creates a private panic-mode session; that
session selects the panic credential on C2/C3 ballots. The backend knows the
session mode. Its marker is encrypted in a fixed-length JWT claim rather than
exposed as a plain `panic` flag in the browser token. C0 continues to use only
a genuine credential.

### Trust assumptions and scope limits

This C2 implementation is an experimental private decoy mechanism and does not
claim the full JCJ coercion-mitigation machinery. The trust assumptions are:

1. the registrar is trusted to maintain the private `genuine`/`panic` mapping
   and distinguish the two authentication passwords;
2. the tally operator is trusted to apply the cleansing list before finalization;
3. public observers do not learn which ballots were panic credentials from on-chain data;
4. the backend holds the credential and ballot secrets, and operators protect
   `C2_REGISTRY_ENCRYPTION_KEY` and keep it stable for the election lifetime.

This is a private decoy mechanism, not a formal anonymous-credential or
coercion-resistant construction. It is appropriate for experiment and local
prototype work, but it is not equivalent to a full JCJ or pseudo-credential stack.

## C3 combined revoting + panic credentials

C3 is selected by creating a poll with protocol version
`c3-revoting-decoy`. It combines C1 replacement behavior with C2 cleansing:

- genuine credentials may still replace earlier valid ballots under the C1
  revoting rule;
- panic credentials remain private to the registrar and are not exposed in the
  public ballot layer;
- the Tally Authority applies the private cleansing list before finalization so
  panic ballots are excluded without ever publishing a public `panic=true` flag;
- the public layer remains commitment-based and indistinguishable between real
  and panic credentials at the on-chain surface.

The same ballot submission path handles replacement detection and panic
exclusion. Finalization removes superseded ballots first and then excludes
remaining ballots with panic commitments. This is the combined behavior of the
experimental prototype; it is not a claim of formal JCJ security.
