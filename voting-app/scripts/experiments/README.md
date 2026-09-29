# Executing the empirical study

The runner executes the manuscript's six profiles against the study-only
`ResearchElection` contract, exports public chain observations and separate
private ground-truth labels, runs an independent event/commitment auditor, and
produces a campaign analysis. It does not submit transactions through the
production web application.

## Anvil primary campaign

In one terminal, start Anvil from the repository root:

```powershell
npm run chain:anvil
```

In a second terminal, compile and run all 70 planned repetitions:

```powershell
cd smart-contracts
npm run compile
cd ..
npm run experiment:run -- --network anvil --seed paper-anvil `
  --revote-rate 20 --panic-rate 10 --padding-rate 20 `
  --selection-strategy population-sample --timing-distribution uniform `
  --timing-window-seconds 10 --dummy-transactions-per-ballot 1 `
  --election-population 1000 --concurrency 8
```

The runner refuses any chain other than chain ID 31337 before deploying. It
derives fresh deterministic actor keys from each run seed and funds those
accounts using Anvil's local-only balance RPC. Do not use deterministic test
keys on a public network. The runner serializes campaigns against a chain and
rejects concurrent runs sharing an RPC. Anvil phase deadlines are advanced
locally only after the actions in each phase have completed.

To run a small check instead of the paper matrix:

```powershell
npm run experiment:run -- --network anvil --configuration C3 `
  --population 20 --repetitions 2 --seed smoke-c3 `
  --commit-duration 60 --reveal-duration 60
```

The matrix can be filtered without changing its per-run seeds:

```powershell
npm run experiment:run -- --network anvil --configurations C1,C1p `
  --populations 1000 --seed c1-padding-1000 `
  --padding-rate 20 --selection-strategy population-sample `
  --timing-distribution uniform --timing-window-seconds 10 `
  --dummy-transactions-per-ballot 1 --election-population 1000
```

Padded conditions require all six padding parameters. `population-sample`
selects an exact rounded share without replacement; `per-ballot` uses a
deterministic independent draw. Supported timing schedules are immediate,
fixed, uniform, and truncated exponential. The default rates (20% revoting,
10% panic actions, and 20% padding) are explicit study parameters, not values
specified by the pre-results manuscript; change them only before collecting
the full campaign and record the selected values.

## Polygon Amoy confirmation

Public execution is deliberately opt-in. It requires a funded administrator
key in `RESEARCH_ADMIN_PRIVATE_KEY` (or
`POLYGON_DEPLOYER_PRIVATE_KEY`), `POLYGON_RPC_URL`, and a private actor-key
file supplied with `--actor-keys-file`. Use `--confirm-public-chain` only after
reviewing the generated plan and estimated cost.

The full 42-run Amoy matrix requires **40,000 fresh, funded actor keys** to
match the manuscript's fresh-account-per-run control. The key file can be a
flat JSON array partitioned in planned-run order or an object of the form
`{"runs":{"<runId>":["0x..."]}}`. Keys must be unique across runs and must not
reuse the administrator account. The runner checks key coverage and uniqueness
before the first transaction; each run then checks balances before deployment.
It never writes supplied keys, addresses derived from the keys, or balances to
the result files. Do not use this workflow with real voter accounts.

```powershell
$env:POLYGON_RPC_URL = "https://<your-amoy-rpc>"
$env:RESEARCH_ADMIN_PRIVATE_KEY = "<funded-testnet-deployer-key>"
npm run experiment:run -- --network polygon-amoy --confirm-public-chain `
  --actor-keys-file C:\private\amoy-actors.json --seed paper-amoy `
  --revote-rate 20 --panic-rate 10 --padding-rate 20 `
  --selection-strategy population-sample --timing-distribution uniform `
  --timing-window-seconds 10 --dummy-transactions-per-ballot 1 `
  --election-population 1000 --concurrency 8
```

Amoy phases use real elapsed time and cannot be fast-forwarded. The default
30-minute commit and 30-minute reveal deadlines apply to every run. The
manuscript's 5,000-voter Amoy runs and the fresh funded-account requirement may
make a full campaign impractical on a testnet; do not silently substitute
shared actors or smaller populations. A partial run is recorded as failed and
is not included in a completed analysis.

## Audit, outputs, and analysis

Outputs are written under `research-runs/<network>/<seed>/`; the directory is
Git-ignored because it contains private ground-truth labels. Each completed
run has a manifest, operation receipts, public records, private labels and
scenario counts in separate files, and the runner's auditor result. To rerun
the audit as a separate process against the same RPC:

```powershell
npm run experiment:audit -- research-runs\anvil\paper-anvil\<run-id>
```

Aggregate only complete runs:

```powershell
npm run experiment:analyze -- research-runs\anvil\paper-anvil
```

Export all campaigns and run results below `research-runs` into one spreadsheet
friendly CSV:

```powershell
npm run experiment:export -- research-runs --output research-runs\study-output.csv
```

The CSV contains campaign and run summaries, auditor measurements, and one
transaction row per available public operation/chain record. Failed or still
running runs are listed too; any confirmed partial operation receipts are
included. Private label and private scenario files are deliberately excluded,
so the CSV is appropriate for sharing as public study output. Re-run the export
after campaigns finish to refresh the snapshot. If a spreadsheet application
has the output open, close it before replacing the file or pass a different
`--output` path.

## Leakage classifier and padding-rate sweep

Run the C1/C1p and C2/C2p comparison at the study's 1,000-participant
population with five padding rates:

```powershell
npm run experiment:run -- --network anvil --configurations C1,C1p --populations 1000 `
  --padding-rates 0,10,20,40,60 --seed leakage-c1 `
  --selection-strategy population-sample --timing-distribution uniform `
  --timing-window-seconds 10 --dummy-transactions-per-ballot 1 `
  --election-population 1000

npm run experiment:run -- --network anvil --configurations C2,C2p --populations 1000 `
  --padding-rates 0,10,20,40,60 --seed leakage-c2 `
  --selection-strategy population-sample --timing-distribution uniform `
  --timing-window-seconds 10 --dummy-transactions-per-ballot 1 `
  --election-population 1000
```

This schedules five baseline repetitions plus 25 padded repetitions per
campaign. `--padding-rates` is accepted only with matrix filters and padded
conditions; it gives each rate a unique reproducible run seed. Since this is
considerably more work than a one-rate study, use a smaller rate list or
`--limit` for a smoke run, and always use the same rates for both comparison
families.

Run the classifier over all completed run folders:

```powershell
npm run experiment:leakage -- research-runs --population 1000
```

This writes `leakage-analysis.json` and `leakage-tradeoff.csv`. It constructs
labels from private run labels but trains only on public commit metadata:
ordinary commits are class 0; revote commits are class 1 for C1/C1p; panic
credential or decoy commits are class 1 for C2/C2p. Reveal, administrator,
padding-only, and unrelated transactions are excluded from the labeled
comparison. Classifiers are evaluated with leave-one-repetition-group-out
cross-validation; both sides of a baseline/padded pair for a repetition are
held out together. Reported metrics include accuracy, precision, recall, F1
and ROC-AUC for each condition and model, plus paired padding-versus-baseline
AUC changes and gas overhead.

The `full` feature view includes all public fields, including event names. The
`without-events` ablation tests whether timing, gas, calldata, method, sender
activity, and block/transaction position still reveal the labels without
public event names. This matters because a `BallotSuperseded` event is itself
a direct public signal, not a subtle statistical inference. The analysis
report stores aggregate results and run IDs only, never row-level private
labels or transaction hashes. To explicitly materialize the joined,
ground-truth-labeled feature rows for local inspection or downstream analysis,
use:

```powershell
npm run experiment:leakage -- research-runs --population 1000 `
  --export-private-datasets
```

This writes `private-leakage-dataset.csv` separately from the public metrics.
It contains transaction hashes, public features, configuration, and the
private target label. It is Git-ignored with the other research outputs and
must not be shared or published; remove or securely retain it according to
your research data-handling policy.

Analysis reports per-action and total gas, modeled contract-storage words and
bytes, auditor verification time and data volume, the repeated-submitter
baseline, logistic regression, a decision tree, a random forest, 95% t
intervals where repetitions permit them, per-population pairwise contrasts,
the C3 factorial interaction, and a Pareto frontier. Classifier train/test
splits hold out campaign/election repetition groups, keeping corresponding
conditions in the same partition. Sampling is deterministic and
class-stratified (at most 500 rows per class per run); feature standardization
is fitted on training rows only. The fixed method-ID vocabulary comes from the
study contract ABI, with unrecognized methods mapped to `other`. Reports
contain aggregate metrics, model configuration/seeds, and held-out run IDs;
they do not serialize transaction hashes or feature rows. A split without
both classes is explicitly marked insufficient rather than filled with
estimates.

## Controlled revote- and panic-rate sweeps

The activity-rate sweeps hold population at 1,000 and vary the mechanism
activity while keeping the other study parameters fixed. Start Anvil as above,
then run these as separate campaigns:

```powershell
npm run experiment:run -- --network anvil --configurations C1 --populations 1000 `
  --revote-rates 0,10,20,40,50 --seed revote-rate-1000

npm run experiment:run -- --network anvil --configurations C2 --populations 1000 `
  --panic-rates 0,5,10,20,40 --seed panic-rate-1000
```

Each rate expands to the matrix's five repetitions: 25 runs per sweep, 50
total. C1 replacement-ballot counts should be 0/100/200/400/500 at the
configured rates; C2 panic-credential counts should be 0/50/100/200/400.
Incomplete runs remain recorded but are excluded from analysis. Rate options
require matrix filters, a configuration with the selected mechanism enabled,
and cannot be combined with a padding-rate sweep.

After both campaigns finish, summarize only completed auditor-verified runs:

```powershell
npm run experiment:activity-rates -- research-runs --population 1000
```

The command writes `activity-rate-analysis.json` and
`activity-rate-analysis.csv` under `research-runs`. The reports include
observed action counts, total gas, modeled storage growth, contract transaction
and ballot counts, auditor verification time/bytes, deltas from the 0% rate,
and logistic-regression, decision-tree, and random-forest accuracy, precision,
recall, F1, and ROC-AUC. Classifier folds hold out all rates from the same
repetition together. ROC-AUC is null when a held-out rate has only one class
(notably the 0% positive-activity baseline); no score is fabricated. Private
labels are used only to construct targets and are not written to these
aggregate reports.

## What this experiment does and does not establish

`ResearchElection` is a common study contract with timed commit and reveal
phases, replacement/supersession, commitment checking, and a tally that an
independent program can reconstruct. C2 panic credentials and C2p registrar
decoys are controlled synthetic inputs with private labels; they are not a
credential issuer, a zero-knowledge eligibility proof, or a complete JCJ
cleansing protocol. C1p recommitment padding is synthetic traffic. The public
chain still exposes senders, timing, calldata, events, and revealed choices.

Gas values come from receipts. Storage bytes are a Solidity layout model of
non-zero contract data slots; they exclude the state trie, transaction trie,
and client-specific database overhead. The auditor's tally commitment check
is not a zero-knowledge proof. These are implementation-level measurements,
not evidence of coercion resistance, voter anonymity, or production election
security. Report the model and limitations with any paper results.
