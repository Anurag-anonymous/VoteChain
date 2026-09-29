# Research study execution readiness

## Bottom line

The repository now contains an executable, reproducible research harness for
the paper's campaign matrix. It can deploy one common study contract, generate
seeded ballot and mechanism traffic, enforce timed commit/reveal phases,
collect chain receipts and public metadata, keep ground-truth labels separate,
independently reconstruct the tally from public events, and analyze completed
runs. The full 70-run Anvil matrix and 42-run Polygon Amoy confirmation matrix
are executable through the documented commands.

**The full primary campaign and the new controlled activity-rate sweeps have
not been completed.** Existing partial/smoke runs validate portions of the
pipeline, but are not a substitute for the prescribed study matrix. The paper
must not be populated with unmeasured results.

The harness executes a study-specific contract and synthetic controlled
participants. It does not route votes through the production web application,
and it does not make the application production-ready for elections.

## Paper requirements versus executable support

| Requirement / research question | Current implementation | Readiness |
| --- | --- | --- |
| Six conditions and population/repetition matrix | Deterministic C0/C1/C2/C3/C1p/C2p planner and runner; 70 Anvil and 42 Amoy entries. | Executable |
| Common commit-reveal contract | `ResearchElection` enforces commit/reveal phases and deadlines, sequence-based replacement, commitment opening, final tally state, and public events. | Executable research model; separate from the web app |
| RQ1: gas and storage growth | Transaction receipt gas is collected for deployment, phase controls, ordinary commits/reveals, revotes, panic/decoy, and padding. Auditor reports modeled non-zero Solidity storage slots/bytes by declared data layout. | Executable; storage is a layout model, not client state-trie byte size |
| RQ2: independent auditor burden | Separate process reads chain logs, transaction inputs, and receipts; verifies phase timing, sequence/supersession, commit openings, tally totals and tally commitment; records runtime, transactions and JSON byte volume. | Executable for the study model |
| RQ3: public-ledger leakage | Commit-only datasets label ordinary vs revote (C1/C1p) and ordinary vs panic/decoy (C2/C2p). Logistic regression, decision tree, and random forest use leave-one-repetition-group-out evaluation with paired conditions held out together; an event-name ablation separates direct event disclosure from other metadata. | Executable; only the existing 20% padding-rate data are analyzed so far |
| RQ4: combined effect | Per-population C3 − C1 − C2 + C0 difference-in-differences are reported for gas and auditor time. | Executable |
| RQ5: practical trade-off | Campaign Pareto analysis is cost-only: its objectives are total gas and auditor verification time; classifier AUC is not included. Classifier AUC is a separate leakage-analysis result, reported using leave-one-repetition-group-out evaluation. | Executable when comparable data exist |
| Leakage/padding-rate trade-off | `experiment:leakage` writes cross-validated accuracy, precision, recall, F1, ROC-AUC and per-rate gas overhead; the campaign runner accepts a `--padding-rates` matrix. | Executable; 0/10/40/60% campaigns remain to be collected |
| Activity-rate trade-off | `--revote-rates` and `--panic-rates` plan paired five-repetition, population-1,000 C1/C2 sweeps; `experiment:activity-rates` reports action counts, gas, modeled storage, transaction counts, auditor time/bytes, and leave-one-repetition-out classifier metrics. | Executable; 50-run sweeps remain to be collected |
| Reproducibility and failure handling | Seeds control per-run actor keys (Anvil only), ballots, action labels, actor selection, and padding schedule. Results are immutable per run; failed/incomplete runs block analysis. A chain-wide lock prevents concurrent writers. | Substantially supported |
| Public confirmation | Amoy uses the same contract and enforces chain ID 80002, requires explicit confirmation, administrator credentials, unique actor keys for each run, and funding preflight. | Executable but operationally constrained; requires 40,000 fresh funded actors for all 42 planned runs |

## Material boundaries and paper updates still required

1. **The app and the study contract are different systems.** The production
   app stores encrypted ballots and tally mappings in MongoDB and can anchor
   receipt hashes. The `ResearchElection` contract is a separate benchmarking
   harness. Results must be described as measurements of this study contract,
   not as measurements of the production app's ballot route.
2. **C2 is a controlled panic-action proxy.** Panic-labelled commitments are
   left unrevealed and excluded from the tally. Ground-truth types exist only
   in a separate private-label dataset; the contract does not implement a
   credential issuer, eligibility proof, real/panic credential mapping, or
   JCJ-style cleansing proof.
3. **C2p registrar decoys are synthetic.** They are generated from the
   registrar/admin account and submitted as extra commitments; this sender is
   visible to the passive observer. The result measures that implementation,
   not indistinguishable registrar traffic.
4. **C1p padding is synthetic recommitment traffic.** The runner creates
   deterministic synthetic nullifiers and sends sequence-1 and sequence-2
   commitments according to the configured schedule. The padding rate and
   timing settings were not fully specified in the proposal. The documented
   defaults (20% revoting, 10% panic actions, 20% padding) are explicit
   operational assumptions and must be held fixed or preregistered before the
   full run.
5. **The tally check is not a proof system.** The auditor independently
   reconstructs choices from public reveal calldata and verifies the
   contract's running tally commitment and state. It is not a zero-knowledge
   `finalizeTally` proof and does not establish privacy.
6. **Storage results have a defined scope.** Gas is taken from receipts.
   Storage growth counts modeled non-zero contract data slots and excludes the
   client state trie, transaction trie, and node database overhead. Label this
   metric as modeled contract data storage, not measured database bytes.
7. **Revealed choices and senders are public.** The observer sees addresses,
   timing, gas, calldata size, method IDs, events, and revealed choices. The
   experiment is not evidence of voter anonymity, coercion resistance, or
   suitability for real elections.
8. **Polygon resource requirements are significant.** The paper calls for
   fresh accounts per run; the full Amoy matrix therefore needs 40,000 unique,
   already-funded actor accounts plus the administrator. The runner fails
   closed rather than reusing keys or silently shrinking the matrix.

## Reproduction commands

See [the experiment runner guide](../scripts/experiments/README.md) for
complete Anvil and Amoy commands, safety checks, artifact formats, audit, and
analysis. The essential local workflow is:

```powershell
npm run chain:anvil
# In another terminal:
cd smart-contracts
npm run compile
cd ..
npm run experiment:run -- --network anvil --seed paper-anvil `
  --revote-rate 20 --panic-rate 10 --padding-rate 20 `
  --selection-strategy population-sample --timing-distribution uniform `
  --timing-window-seconds 10 --dummy-transactions-per-ballot 1 `
  --election-population 1000 --concurrency 8
npm run experiment:analyze -- research-runs\anvil\paper-anvil
```

The controlled activity-rate experiment uses separate campaigns and emits
both JSON and CSV analysis:

```powershell
npm run experiment:run -- --network anvil --configurations C1 --populations 1000 `
  --revote-rates 0,10,20,40,50 --seed revote-rate-1000
npm run experiment:run -- --network anvil --configurations C2 --populations 1000 `
  --panic-rates 0,5,10,20,40 --seed panic-rate-1000
npm run experiment:activity-rates -- research-runs --population 1000
```

Each campaign plans 25 runs (five rates × five repetitions). Do not run the
campaigns concurrently against the same Anvil instance. The analyzer excludes
incomplete runs and returns null ROC-AUC where a held-out rate has only one
class; it does not claim results until those runs have actually completed.

Run `npm run experiment:test` for deterministic scenario, planner, classifier,
and summary tests. The contract suite is `cd smart-contracts; npm test`.

Do not call the prototype production-ready. A production election requires a
separate cryptographic protocol and threat model, externally reviewed
contracts and client, privacy-preserving eligibility, independently verifiable
credential and tally proofs, operational key management, incident response,
and election governance.
