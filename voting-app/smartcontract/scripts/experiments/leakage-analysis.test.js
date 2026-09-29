const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  analyzeLeakage,
  buildPrivateDatasetCsv,
  buildTradeoffCsv
} = require('./analyze-leakage');
const { getLeakageFeatureNames } = require('./classifiers');

const transactionHash = (number) => `0x${number.toString(16).padStart(64, '0')}`;

test('leakage analysis labels commit actions and compares paired runs with event ablation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'votechain-leakage-'));
  try {
    let transaction = 1;
    for (let repetition = 1; repetition <= 3; repetition += 1) {
      for (const configuration of ['C1', 'C1p', 'C2', 'C2p']) {
        const runId = `fixture-${configuration}-r${repetition}`;
        const directory = path.join(root, runId);
        fs.mkdirSync(directory, { recursive: true });
        const operations = [];
        const publicRecords = [];
        const privateLabels = [];
        const activities = configuration.startsWith('C1')
          ? ['ordinary', 'ordinary', 'revote', 'revote']
          : ['ordinary', 'ordinary', 'panic', 'panic', 'decoy', 'decoy'];
        for (const activity of activities) {
          const hash = transactionHash(transaction++);
          operations.push({
            operation: 'commit',
            transactionHash: hash,
            gasUsed: '100000',
            calldataBytes: 132
          });
          publicRecords.push({
            transactionHash: hash,
            submitter: `actor-${hash}`,
            timestamp: 1000,
            interTransactionSeconds: 1,
            blockInterval: 1,
            gasUsed: '100000',
            calldataBytes: 132,
            methodId: '0x30058839',
            eventNames: activity === 'revote'
              ? ['BallotCommitted', 'BallotSuperseded']
              : ['BallotCommitted'],
            senderTransactionCount: 1,
            transactionIndex: 0,
            blockNumber: 100
          });
          privateLabels.push({
            transactionHash: hash,
            activity,
            revote: activity === 'revote',
            panic: activity === 'panic',
            decoy: activity === 'decoy'
          });
        }
        if (configuration === 'C1p' || configuration === 'C2p') {
          const hash = transactionHash(transaction++);
          operations.push({
            operation: 'commit',
            transactionHash: hash,
            gasUsed: '100000',
            calldataBytes: 132
          });
          publicRecords.push({
            transactionHash: hash,
            submitter: `padding-actor-${hash}`,
            timestamp: 1000,
            interTransactionSeconds: 1,
            blockInterval: 1,
            gasUsed: '100000',
            calldataBytes: 132,
            methodId: '0x30058839',
            eventNames: ['BallotCommitted'],
            senderTransactionCount: 1,
            transactionIndex: 0,
            blockNumber: 100
          });
          privateLabels.push({
            transactionHash: hash,
            activity: 'padding',
            revote: false,
            panic: false,
            decoy: false
          });
        }

        const manifest = {
          runId,
          repetition,
          configuration: {
            label: configuration,
            padding: configuration.endsWith('p')
          },
          network: { key: 'anvil', chainId: 31337 },
          population: 1000,
          seed: runId,
          paddingConfig: configuration.endsWith('p')
            ? { paddingRatePercent: 20 }
            : null,
          electionId: transactionHash(transaction)
        };
        const result = {
          status: 'complete',
          runId,
          configuration,
          population: 1000,
          totalGas: '500000',
          auditVerified: true
        };
        const audit = {
          verified: true,
          verificationTimeMs: 2,
          storageGrowthBytes: 1024
        };
        for (const [filename, value] of Object.entries({
          'manifest.json': manifest,
          'result.json': result,
          'operations.json': operations,
          'public-records.json': publicRecords,
          'private-labels.json': privateLabels,
          'auditor.json': audit
        })) {
          fs.writeFileSync(
            path.join(directory, filename),
            JSON.stringify(value)
          );
        }
      }
    }
    const incompleteDirectory = path.join(root, 'incomplete-run');
    fs.mkdirSync(incompleteDirectory);
    fs.writeFileSync(path.join(incompleteDirectory, 'result.json'), JSON.stringify({
      status: 'running',
      runId: 'incomplete-run'
    }));

    const report = analyzeLeakage({ root, populations: [1000] });
    assert.equal(report.includedCompletedRunCount, 12);
    assert.equal(report.excludedIncompleteRuns.length, 1);
    assert.equal(report.comparisons.length, 2);
    const [comparison, panicComparison] = report.comparisons;
    assert.equal(comparison.pairedRepetitionGroups, 3);
    assert.equal(comparison.featureViews.full.samplesByConfiguration.C1, 12);
    assert.equal(comparison.featureViews.full.samplesByConfiguration.C1p, 12);
    assert.equal(comparison.featureViews.full.classBalanceByConfiguration.C1.sensitive, 6);
    assert.equal(comparison.featureViews.full.results['logistic-regression']
      .metricsByConfiguration.C1.rocAuc, 1);
    assert.equal(comparison.featureViews.full.results['random-forest']
      .metricsByConfiguration.C1p.rocAuc, 1);
    assert.equal(comparison.featureViews['without-events']
      .results['decision-tree'].metricsByConfiguration.C1.rocAuc, 0.5);
    assert.equal(comparison.tradeoffs.full.models['logistic-regression'].leakageReduction, 0);
    assert.equal(
      comparison.tradeoffs.full.models['logistic-regression']
        .pairedFoldLeakageReduction.mean,
      0
    );
    assert.equal(panicComparison.target, 'panicOrDecoy');
    assert.equal(
      panicComparison.featureViews.full.samplesByConfiguration.C2p,
      18
    );
    assert.equal(
      panicComparison.featureViews.full.classBalanceByConfiguration.C2p.sensitive,
      12
    );
    const csv = buildTradeoffCsv(report);
    assert.ok(csv.includes('baseline_roc_auc,padded_roc_auc'));
    assert.equal(csv.trim().split('\r\n').length, 13);
    const json = JSON.stringify(report);
    assert.ok(!json.includes('transactionHash'));
    assert.ok(!json.includes('actor-0x'));
    const labeledCsv = buildPrivateDatasetCsv([{
      target: 'revote',
      configuration: 'C1',
      paddingRatePercent: 0,
      runId: 'fixture-C1-r1',
      groupId: '1000:repetition-1',
      transactionHash: transactionHash(1),
      actual: true,
      vector: Array(getLeakageFeatureNames().length).fill(0)
    }]);
    assert.ok(labeledCsv.includes('transaction_hash'));
    assert.ok(labeledCsv.includes(`${transactionHash(1)},1,`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
