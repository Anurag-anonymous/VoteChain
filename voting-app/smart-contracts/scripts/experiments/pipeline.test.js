const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Web3 = require('web3');
const {
  createCampaignPlan,
  createRunManifest
} = require('../../../backend/src/config/researchStudy');
const { createScenario } = require('./scenario');
const { evaluateClassifiers } = require('./classifiers');
const { analyzeCampaign, summarize } = require('./analyze-campaign');
const {
  assertAnvilRpc,
  campaignFromArguments,
  privateKeyFromSeed,
  loadPublicActorKeys,
  actorAccountIndex,
  estimateActorGasByAccount,
  estimateGasLimit,
  retrieveLedger,
  runOne
} = require('./run-campaign');

const web3 = new Web3();
const paddingConfig = {
  paddingRatePercent: 20,
  selectionStrategy: 'population-sample',
  timingDistribution: 'uniform',
  timingWindowSeconds: 10,
  dummyTransactionsPerBallot: 1,
  electionPopulation: 20
};

test('campaign planner keeps the paper run matrix and phase timing reproducible', () => {
  const anvil = createCampaignPlan({
    network: 'anvil',
    seed: 'matrix',
    paddingConfig: { ...paddingConfig, electionPopulation: 1000 }
  });
  const amoy = createCampaignPlan({
    network: 'polygon-amoy',
    seed: 'matrix',
    paddingConfig: { ...paddingConfig, electionPopulation: 1000 }
  });
  assert.equal(anvil.length, 70);
  assert.equal(amoy.length, 42);
  assert.ok(anvil.every((run) => (
    run.durationSeconds === run.commitDurationSeconds + run.revealDurationSeconds
  )));
  assert.throws(() => createRunManifest({
    commitDurationSeconds: 10,
    revealDurationSeconds: 10,
    durationSeconds: 3600
  }), /must equal/);
});

test('single-profile runner supports repetitions and matrix filtering', () => {
  const repeated = campaignFromArguments({
    network: 'anvil',
    configuration: 'C1',
    population: '20',
    repetitions: '3',
    seed: 'repeat'
  });
  assert.equal(repeated.plans.length, 3);
  assert.equal(new Set(repeated.plans.map((run) => run.runId)).size, 3);
  const unpadded = campaignFromArguments({
    network: 'anvil',
    configurations: 'C0,C1',
    populations: '100',
    seed: 'unpadded-only'
  });
  assert.equal(unpadded.plans.length, 10);
  assert.ok(unpadded.plans.every((run) => !run.configuration.padding));
  const filtered = campaignFromArguments({
    network: 'anvil',
    configurations: 'C1,C1p',
    populations: '1000',
    limit: '3',
    seed: 'filtered',
    'padding-rate': '20',
    'selection-strategy': 'population-sample',
    'timing-distribution': 'uniform',
    'timing-window-seconds': '10',
    'dummy-transactions-per-ballot': '1',
    'election-population': '1000'
  });
  assert.equal(filtered.plans.length, 3);
  assert.ok(filtered.plans.every((run) => run.population === 1000));
  const paddingRates = campaignFromArguments({
    network: 'anvil',
    configurations: 'C1,C1p',
    populations: '1000',
    'padding-rates': '0,10,20,40,60',
    seed: 'leakage-rates',
    'selection-strategy': 'population-sample',
    'timing-distribution': 'uniform',
    'timing-window-seconds': '10',
    'dummy-transactions-per-ballot': '1',
    'election-population': '1000'
  });
  assert.equal(paddingRates.plans.length, 30);
  assert.equal(
    new Set(paddingRates.plans.map((run) => run.runId)).size,
    paddingRates.plans.length
  );
  assert.deepEqual(
    [...new Set(paddingRates.plans
      .filter((run) => run.configuration.padding)
      .map((run) => run.paddingConfig.paddingRatePercent))].sort((a, b) => a - b),
    [0, 10, 20, 40, 60]
  );
  const revoteRates = campaignFromArguments({
    network: 'anvil',
    configurations: 'C1',
    populations: '1000',
    'revote-rates': '0,10,20,40,50',
    seed: 'controlled-revote'
  });
  assert.equal(revoteRates.plans.length, 25);
  assert.deepEqual(
    revoteRates.plans.slice(0, 5).map((run) => run.revoteRatePercent),
    [0, 0, 0, 0, 0]
  );
  assert.deepEqual(
    [...new Set(revoteRates.plans.map((run) => run.revoteRatePercent))]
      .sort((a, b) => a - b),
    [0, 10, 20, 40, 50]
  );
  assert.deepEqual(
    [0, 10, 20, 40, 50].map((rate) => revoteRates.plans.filter(
      (run) => run.revoteRatePercent === rate
    ).length),
    [5, 5, 5, 5, 5]
  );
  const panicRates = campaignFromArguments({
    network: 'anvil',
    configurations: 'C2',
    populations: '1000',
    'panic-rates': '0,5,10,20,40',
    seed: 'controlled-panic'
  });
  assert.equal(panicRates.plans.length, 25);
  assert.deepEqual(
    [...new Set(panicRates.plans.map((run) => run.panicRatePercent))]
      .sort((a, b) => a - b),
    [0, 5, 10, 20, 40]
  );
  assert.deepEqual(
    [0, 5, 10, 20, 40].map((rate) => panicRates.plans.filter(
      (run) => run.panicRatePercent === rate
    ).length),
    [5, 5, 5, 5, 5]
  );
  assert.throws(() => campaignFromArguments({
    network: 'anvil',
    configurations: 'C2',
    populations: '1000',
    'revote-rates': '0,10'
  }), /requires a configuration with revote enabled/);
});

test('ledger retrieval caches blocks and fetches transaction metadata concurrently', async () => {
  const hashes = Array.from({ length: 10 }, (_, index) => (
    `0x${index.toString(16).padStart(64, '0')}`
  ));
  const blockCalls = new Map();
  let activeTransactions = 0;
  let maximumActiveTransactions = 0;
  const fakeWeb3 = {
    eth: {
      getTransaction: async (hash) => {
        activeTransactions += 1;
        maximumActiveTransactions = Math.max(
          maximumActiveTransactions,
          activeTransactions
        );
        await new Promise((resolve) => setTimeout(resolve, 5));
        activeTransactions -= 1;
        const index = hashes.indexOf(hash);
        const blockGroup = Math.floor(index / 3);
        return {
          from: '0x0000000000000000000000000000000000000001',
          to: '0x0000000000000000000000000000000000000002',
          blockNumber: 100 + blockGroup,
          transactionIndex: index % 3,
          input: '0x12345678'
        };
      },
      getTransactionReceipt: async () => ({ gasUsed: 21000 }),
      getBlock: async (blockNumber) => {
        blockCalls.set(blockNumber, (blockCalls.get(blockNumber) || 0) + 1);
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { timestamp: 1700000000 + blockNumber };
      }
    }
  };
  const contract = {
    getPastEvents: async () => hashes.map((transactionHash) => ({
      transactionHash,
      event: 'BallotCommitted'
    }))
  };
  const labels = new Map();
  const operations = hashes.slice().reverse().map((transactionHash) => ({
    transactionHash
  }));
  const ledger = await retrieveLedger({
    web3: fakeWeb3,
    contract,
    fromBlock: 100,
    toBlock: 103,
    labels,
    operations
  });

  assert.deepEqual(
    ledger.publicRecords.map(({ transactionHash }) => transactionHash),
    hashes
  );
  assert.equal(ledger.publicRecords[0].senderTransactionCount, 1);
  assert.equal(ledger.publicRecords[9].senderTransactionCount, 10);
  assert.ok(maximumActiveTransactions > 1);
  assert.ok(maximumActiveTransactions <= 8);
  assert.deepEqual([...blockCalls.keys()].sort((a, b) => a - b), [100, 101, 102, 103]);
  assert.ok([...blockCalls.values()].every((count) => count === 1));
});

test('run recovery reuses completed results and preserves interrupted run markers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'votechain-run-recovery-'));
  const run = async (runId) => runOne({
    web3: null,
    artifact: null,
    manifest: { runId, seed: 'recovery-seed', population: 3 },
    network: 'polygon-amoy',
    outputRoot: root,
    concurrency: 1
  });
  try {
    const completed = {
      status: 'complete',
      runId: 'complete-run',
      seed: 'recovery-seed'
    };
    const completeDirectory = path.join(root, completed.runId);
    fs.mkdirSync(completeDirectory);
    fs.writeFileSync(
      path.join(completeDirectory, 'result.json'),
      JSON.stringify(completed)
    );
    assert.deepEqual(await run(completed.runId), completed);

    const interrupted = {
      status: 'running',
      runId: 'interrupted-run',
      seed: 'recovery-seed'
    };
    const interruptedDirectory = path.join(root, interrupted.runId);
    fs.mkdirSync(interruptedDirectory);
    const interruptedResultPath = path.join(interruptedDirectory, 'result.json');
    fs.writeFileSync(interruptedResultPath, JSON.stringify(interrupted));
    await assert.rejects(run(interrupted.runId), /already exists but is not complete/);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(interruptedResultPath, 'utf8')),
      interrupted
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Amoy smoke plans cover each configuration at a small population', () => {
  const configurations = ['C0', 'C1', 'C2', 'C3', 'C1p', 'C2p'];
  const plans = configurations.map((configuration) => campaignFromArguments({
    network: 'polygon-amoy',
    configuration,
    population: '20',
    repetitions: '1',
    seed: `amoy-smoke-${configuration}`,
    'commit-duration': '60',
    'reveal-duration': '60',
    ...(configuration.endsWith('p') ? {
      'padding-rate': '20',
      'selection-strategy': 'population-sample',
      'timing-distribution': 'uniform',
      'timing-window-seconds': '10',
      'dummy-transactions-per-ballot': '1',
      'election-population': '20'
    } : {})
  }));
  assert.deepEqual(plans.map(({ plans: [plan] }) => plan.configuration.label), configurations);
  assert.ok(plans.every(({ network, plans: [plan] }) => (
    network === 'polygon-amoy' &&
    plan.network.chainId === 80002 &&
    plan.population === 20 &&
    plan.repetitions === 1 &&
    plan.durationSeconds === 120
  )));
});

test('reused Amoy actor pool maps simulated participants and aggregates funding estimates', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'votechain-amoy-actors-'));
  try {
    const actorKeys = Array.from({ length: 3 }, (_, index) => (
      privateKeyFromSeed('amoy-smoke-test-actors', index)
    ));
    const keyFile = path.join(root, 'actors.json');
    fs.writeFileSync(keyFile, JSON.stringify({ accounts: actorKeys }));
    const plans = [
      { runId: 'smoke-c0', population: 20 },
      { runId: 'smoke-c1', population: 20 }
    ];
    const keysByRun = loadPublicActorKeys({
      web3,
      actorKeyFile: keyFile,
      plans,
      administratorAddress: '0x0000000000000000000000000000000000000001',
      reuseActorKeys: true
    });
    assert.deepEqual([...keysByRun.get('smoke-c0')], actorKeys);
    assert.deepEqual([...keysByRun.get('smoke-c1')], actorKeys);
    assert.deepEqual(
      Array.from({ length: 8 }, (_, actor) => actorAccountIndex(actor, 3)),
      [0, 1, 2, 0, 1, 2, 0, 1]
    );
    const gasByAccount = estimateActorGasByAccount([
      { actor: 0, commits: [{}, {}], reveals: [{}] },
      { actor: 1, commits: [{}], reveals: [{}] },
      { actor: 3, commits: [{}], reveals: [] }
    ], 3);
    assert.deepEqual(gasByAccount, [900000n, 400000n, 0n]);
    assert.throws(() => loadPublicActorKeys({
      web3,
      actorKeyFile: keyFile,
      plans,
      administratorAddress: web3.eth.accounts.privateKeyToAccount(actorKeys[0]).address,
      reuseActorKeys: true
    }), /Administrator key must not appear/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('single-account Amoy smoke mode uses administrator key as the sole actor', () => {
  const adminKey = privateKeyFromSeed('amoy-single-funded-account', 0);
  const keysByRun = loadPublicActorKeys({
    web3,
    plans: [{ runId: 'single-account-smoke', population: 2 }],
    adminPrivateKey: adminKey,
    reuseAdminAccount: true
  });
  assert.deepEqual(keysByRun.get('single-account-smoke'), [adminKey]);
  assert.throws(() => loadPublicActorKeys({
    web3,
    plans: [{ runId: 'single-account-smoke', population: 1 }],
    adminPrivateKey: adminKey,
    reuseAdminAccount: true
  }), /at least two simulated participants/);
});

test('estimated transaction gas leaves a bounded safety margin within action limits', async () => {
  assert.equal(await estimateGasLimit(async () => 234506, 250000, 5), 246232);
  await assert.rejects(
    estimateGasLimit(async () => 234506, 250000, 20),
    /safety margin exceeds/
  );
  await assert.rejects(
    estimateGasLimit(async () => 200000, 250000, 101),
    /between 0 and 100 percent/
  );
});

test('Anvil runner rejects a chain-31337 RPC without Foundry Anvil methods', async () => {
  const ganache = {
    eth: { getChainId: async () => 31337 },
    currentProvider: {
      request: async ({ method }) => {
        if (method === 'anvil_nodeInfo') {
          throw new Error('The method anvil_nodeInfo does not exist/is not available');
        }
        throw new Error(`Unexpected RPC method ${method}`);
      }
    }
  };
  await assert.rejects(
    assertAnvilRpc(ganache),
    /not Foundry Anvil \(anvil_nodeInfo is unavailable\)/
  );

  const anvil = {
    eth: { getChainId: async () => 31337 },
    currentProvider: {
      request: async ({ method }) => (
        method === 'anvil_nodeInfo' ? { chainId: '0x7a69' } : null
      )
    }
  };
  await assert.doesNotReject(assertAnvilRpc(anvil));
});

test('scenario generator makes deterministic separated mechanism actions', () => {
  const manifest = createRunManifest({
    configuration: 'C3',
    population: 20,
    seed: 'c3-scenario'
  });
  const first = createScenario(manifest, web3);
  const second = createScenario(manifest, web3);
  assert.deepEqual(first.counts, second.counts);
  assert.equal(first.counts.panicVoters, 2);
  assert.equal(first.counts.revotingVoters, 4);
  assert.equal(first.counts.committedBallots, 24);
  assert.equal(first.registrarActions.length, 0);
  assert.equal(
    first.actorPlans.reduce((sum, actor) => sum + actor.reveals.length, 0),
    18
  );
});

test('controlled activity rates produce the requested replacement and panic counts', () => {
  for (const [rate, expected] of [[0, 0], [10, 100], [20, 200], [40, 400], [50, 500]]) {
    const scenario = createScenario(createRunManifest({
      configuration: 'C1',
      population: 1000,
      seed: `revote-rate-${rate}`,
      revoteRatePercent: rate
    }), web3);
    assert.equal(scenario.counts.revotingVoters, expected);
    assert.equal(scenario.actorPlans.flatMap(({ commits }) => commits)
      .filter(({ activity }) => activity === 'revote').length, expected);
  }
  for (const [rate, expected] of [[0, 0], [5, 50], [10, 100], [20, 200], [40, 400]]) {
    const scenario = createScenario(createRunManifest({
      configuration: 'C2',
      population: 1000,
      seed: `panic-rate-${rate}`,
      panicRatePercent: rate
    }), web3);
    assert.equal(scenario.counts.panicVoters, expected);
    assert.equal(scenario.actorPlans.flatMap(({ commits }) => commits)
      .filter(({ activity }) => activity === 'panic').length, expected);
  }
});

test('padding profiles create timed recommitment streams and registrar decoys', () => {
  const c1p = createScenario(createRunManifest({
    configuration: 'C1p',
    population: 20,
    seed: 'c1p-scenario',
    paddingConfig
  }), web3);
  assert.equal(c1p.counts.paddingActors, 4);
  assert.equal(c1p.counts.committedBallots, 32);
  assert.ok(c1p.actorPlans.flatMap((actor) => actor.commits)
    .filter((ballot) => ballot.activity === 'padding')
    .every((ballot) => ballot.delayMs >= 0 && ballot.delayMs <= 10000));

  const c2p = createScenario(createRunManifest({
    configuration: 'C2p',
    population: 20,
    seed: 'c2p-scenario',
    paddingConfig
  }), web3);
  assert.equal(c2p.counts.panicVoters, 2);
  assert.equal(c2p.registrarActions.length, 4);
  assert.equal(c2p.counts.committedBallots, 24);
  assert.ok(c2p.registrarActions.every((ballot) => ballot.activity === 'decoy'));
});

test('classifier leave-one-group-out keeps paired election runs together', () => {
  const runs = Array.from({ length: 10 }, (_, runIndex) => {
    const publicRecords = [];
    const privateLabels = [];
    for (let index = 0; index < 20; index += 1) {
      const revote = index < 8;
      const transactionHash = `0x${String(runIndex * 20 + index + 1).padStart(64, '0')}`;
      publicRecords.push({
        transactionHash,
        submitter: `sender-${runIndex}-${index}`,
        gasUsed: String(revote ? 120000 : 50000),
        calldataBytes: 132,
        interTransactionSeconds: index,
        blockInterval: 1,
        methodId: '0xabcdef01',
        eventNames: revote
          ? ['BallotCommitted', 'BallotSuperseded']
          : ['BallotCommitted']
      });
      privateLabels.push({
        transactionHash,
        activity: revote ? 'revote' : 'ordinary',
        sensitiveActivity: revote,
        revote,
        panic: false,
        decoy: false,
        padding: false
      });
    }
    return {
      runId: `run-${runIndex}`,
      groupId: `campaign:20:r${Math.floor(runIndex / 2) + 1}`,
      configuration: runIndex % 2 === 0 ? 'C1' : 'C1p',
      publicRecords,
      privateLabels
    };
  });
  const report = evaluateClassifiers({ runs, target: 'revote', seed: 'classifier-test' });
  assert.equal(report.status, 'complete');
  assert.equal(report.groupCount, 5);
  assert.equal(report.sampleCount, 200);
  assert.ok(report.features.includes('method:other'));
  assert.ok(!report.features.includes('method:0xabcdef01'));
  assert.equal(
    report.standardization,
    'z-score parameters fitted independently on each training fold'
  );
  assert.equal(
    report.results['logistic-regression'].splitMethod,
    'leave-one-repetition-group-out'
  );
  for (const model of Object.values(report.results)) {
    assert.equal(model.folds.length, 5);
    assert.equal(new Set(model.folds.map(({ heldOutGroupId }) => heldOutGroupId)).size, 5);
    assert.deepEqual(Object.keys(model.metricsByConfiguration).sort(), ['C1', 'C1p']);
    assert.ok(model.metricsByConfiguration.C1.accuracy >= 0);
    assert.ok(model.metricsByConfiguration.C1.accuracy <= 1);
    assert.ok(model.modelConfiguration);
    assert.ok(model.seed);
  }
  const serializedReport = JSON.stringify(report);
  assert.ok(!serializedReport.includes('transactionHash'));
  assert.ok(!serializedReport.includes('groupId'));
  assert.ok(!serializedReport.includes('0x0000000000000000000000000000000000000000000000000000000000000001'));
  const malformedRuns = structuredClone(runs);
  malformedRuns[0].publicRecords[0].gasUsed = 'not-a-number';
  assert.throws(() => evaluateClassifiers({
    runs: malformedRuns,
    target: 'revote',
    seed: 'classifier-test'
  }), /invalid public feature gasUsed/);
});

test('metric summaries use sample standard deviation and omit single-run intervals', () => {
  const summary = summarize([1, 2, 3, 4, 5]);
  assert.equal(summary.mean, 3);
  assert.equal(summary.standardDeviation, Math.sqrt(2.5));
  assert.ok(summary.confidenceInterval95);
  assert.equal(summarize([3]).confidenceInterval95, null);
});

test('campaign reports keep legacy observer AUC out of comparisons and Pareto scoring', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'votechain-campaign-analysis-'));
  try {
    const runDirectory = path.join(root, 'run-c0');
    fs.mkdirSync(runDirectory);
    const writeJson = (filename, value) => {
      fs.writeFileSync(path.join(runDirectory, filename), JSON.stringify(value));
    };
    writeJson('result.json', {
      status: 'complete',
      runId: 'run-c0',
      auditVerified: true,
      totalGas: '1000'
    });
    writeJson('manifest.json', {
      population: 100,
      configuration: { label: 'C0' }
    });
    writeJson('operations.json', [{ operation: 'deployment' }]);
    writeJson('public-records.json', []);
    writeJson('private-labels.json', []);
    writeJson('auditor.json', {
      storageGrowthBytes: 12,
      verificationTimeMs: 5,
      bytesProcessed: 42,
      exceptionalRecords: 0
    });

    const report = analyzeCampaign(root);
    assert.equal('observerRocAuc' in report.summaryByConfiguration.C0, false);
    assert.equal('observerAuc' in report.comparisons[0].populations[0], false);
    assert.deepEqual(Object.keys(report.paretoFrontier[0]).sort(), [
      'auditTimeMs',
      'configuration',
      'population',
      'totalGas'
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
