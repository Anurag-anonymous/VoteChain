# Experiment Protocol

Status: Phase 2. The harness that runs the experiments is not implemented yet;
this file fixes the record format and the data-visibility rules so later runs are
comparable. See [CRYPTOGRAPHIC_ARCHITECTURE.md](./CRYPTOGRAPHIC_ARCHITECTURE.md)
for the versions under test and [THREAT_MODEL.md](./THREAT_MODEL.md) for the
observer model.

## Configuration labels

| Label | Flow | Write path |
| --- | --- | --- |
| `C0` | `legacy-plaintext`, database-only (no chain call) | `POST /api/polls/:pollId/vote` |
| `C1` | `legacy-plaintext`, with chain call | `POST /api/polls/:pollId/vote` |
| `C2` | `c0-mock-encrypted`, database-only | `POST /api/polls/:pollId/ballot` |
| `C3` | `c0-mock-encrypted`, with chain call | `POST /api/polls/:pollId/ballot` |
| `C1p` | `C1` with the passive observer recording chain traffic | same as `C1` |
| `C2p` | `C2` with the passive observer recording chain traffic | same as `C2` |

The `p` variants only change what the observer records, not what the system
stores. Never describe a `C0`/`C1` run as private: both store plaintext options.

## Required record per run

Each run must record:

- git commit hash;
- network key and chain ID, read from `backend/src/config/networks.js`
  (`getNetworkConfig`) instead of being hardcoded;
- contract deployment manifests (`deployments/<network>/<Contract>.json`);
- Solidity compiler version (`smart-contracts/truffle-config.js`, currently 0.8.20);
- cryptographic library versions (Node.js version and any added dependency);
- population size;
- election parameters (option count, poll duration, tally threshold);
- configuration label from the table above;
- experiment seed;
- UTC timestamp;
- output dataset location.

## Protocol controls that affect a run

- `RESEARCH_PROTOCOL_ENABLED` (default `true`): when `false`, the
  `c0-mock-encrypted` write path returns HTTP 400. The `C2`/`C3`/`C2p` labels
  require it to be `true`.
- `RESEARCH_TALLY_THRESHOLD` (default `1`): mock trustee share threshold for
  `POST /api/polls/:id/finalize`. A value above `1` makes finalization fail with
  the collected-versus-required share count, which is the failure path to record
  when studying partial tallying.
- `BLOCKCHAIN_ENABLED` / `DATABASE_ENABLED`: when `false`, the corresponding
  write path is skipped. This is what separates the `C0`/`C2` labels (no chain)
  from `C1`/`C3` (chain).

## Observer visibility rules

The passive observer must receive public chain data only: timing, block number,
gas use, calldata size, method/event patterns, and transaction sequence metadata.
The observer must not receive voter identities, private keys, plaintext choices,
credential mappings, nullifiers, or privileged backend logs.

API responses must not expose the candidate choice for
`c0-mock-encrypted` polls. `POST /api/polls/:pollId/ballot` returns only
`ballotId`, `electionId`, `nullifier`, `acceptedAt`, `tallyState`, and the mock
service's `securityNotice`. `GET /api/polls/:id/results` returns options with
`votes: null` and `hidden: true` until `POST /api/polls/:id/finalize` succeeds.

## Before the first recorded run

1. Replace the placeholder deployment manifests with real addresses and ABIs.
2. Decide how the observer is isolated from the backend host.
3. Confirm the tally hint (`Poll.encryptedBallots.tallyHintOptionId`) is not
   exported in any dataset, since it reveals the choice behind a ballot.
