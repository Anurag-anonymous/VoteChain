const assert = require('node:assert/strict');
const test = require('node:test');
const Web3 = require('web3');
const {
  createCampaignPlan,
  createRunManifest
} = require('../../../backend/src/config/researchStudy');
const { createScenario } = require('./scenario');
const { evaluateClassifiers } = require('./classifiers');
const { summarize } = require('./analyze-campaign');
const {
  assertAnvilRpc,
  campaignFromArguments
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

test('classifier holdout keeps election runs disjoint across all three models', () => {
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
  assert.equal(report.results['logistic-regression'].total, 40);
  assert.ok(report.features.includes('method:other'));
  assert.ok(!report.features.includes('method:0xabcdef01'));
  assert.equal(report.standardization, 'z-score parameters fitted on training rows only');
  assert.equal(
    report.results['logistic-regression'].splitMethod,
    'deterministic campaign/election-level holdout'
  );
  const heldOutRepetitions = report.heldOutRunIds.map((runId) => (
    Number(runId.slice('run-'.length))
  ));
  assert.equal(heldOutRepetitions.length, 2);
  assert.equal(
    Math.floor(heldOutRepetitions[0] / 2),
    Math.floor(heldOutRepetitions[1] / 2)
  );
  for (const model of Object.values(report.results)) {
    assert.equal(model.heldOutRunIds.length, 2);
    assert.deepEqual(Object.keys(model.metricsByConfiguration).sort(), ['C1', 'C1p']);
    assert.ok(model.accuracy >= 0 && model.accuracy <= 1);
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
