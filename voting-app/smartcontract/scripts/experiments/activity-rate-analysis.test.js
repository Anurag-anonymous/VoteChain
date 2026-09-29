const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  analyzeActivityRates,
  buildActivityRateCsv
} = require('./analyze-activity-rates');

const transactionHash = (value) => `0x${value.toString(16).padStart(64, '0')}`;

test('activity-rate analysis pairs repetitions and reports costs, counts, and commit classifiers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'votechain-activity-rate-'));
  try {
    let transaction = 1;
    for (const mechanism of ['revote', 'panic']) {
      const configuration = mechanism === 'revote' ? 'C1' : 'C2';
      const rateField = mechanism === 'revote'
        ? 'revoteRatePercent'
        : 'panicRatePercent';
      for (let repetition = 1; repetition <= 3; repetition += 1) {
        for (const rate of [0, 20, 40]) {
          const runId = `fixture-${mechanism}-${rate}-${repetition}`;
          const directory = path.join(root, `${mechanism}-sweep`, runId);
          fs.mkdirSync(directory, { recursive: true });
          const activities = mechanism === 'revote'
            ? ['ordinary', 'ordinary', ...Array(rate / 20).fill('revote')]
            : ['ordinary', 'ordinary', ...Array(rate / 20).fill('panic')];
          const operations = [];
          const publicRecords = [];
          const privateLabels = [];
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
              submitter: `actor-${transaction}`,
              timestamp: transaction,
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
              blockNumber: transaction
            });
            privateLabels.push({
              transactionHash: hash,
              activity,
              revote: activity === 'revote',
              panic: activity === 'panic',
              decoy: false
            });
          }
          const manifest = {
            runId,
            repetition,
            configuration: { label: configuration },
            network: { key: 'anvil', chainId: 31337 },
            population: 100,
            electionId: transactionHash(transaction),
            revoteRatePercent: mechanism === 'revote' ? rate : 20,
            panicRatePercent: mechanism === 'panic' ? rate : 10
          };
          const result = {
            status: 'complete',
            runId,
            configuration,
            population: 100,
            totalGas: String(1000000 + rate * 1000),
            contractTransactionCount: operations.length,
            auditVerified: true
          };
          const audit = {
            verified: true,
            committedBallots: operations.length,
            revealedBallots: operations.length,
            storageGrowthBytes: 1000 + rate * 10,
            verificationTimeMs: 10 + rate,
            bytesProcessed: 10000 + rate * 100
          };
          for (const [filename, value] of Object.entries({
            'manifest.json': manifest,
            'result.json': result,
            'auditor.json': audit,
            'operations.json': operations,
            'public-records.json': publicRecords,
            'private-labels.json': privateLabels
          })) {
            fs.writeFileSync(path.join(directory, filename), JSON.stringify(value));
          }
        }
      }
    }
    const copiedCampaignPath = path.join(root, 'revote-sweep-copy');
    fs.cpSync(path.join(root, 'revote-sweep'), copiedCampaignPath, { recursive: true });
    for (const rate of [0, 20, 40]) {
      for (let repetition = 1; repetition <= 3; repetition += 1) {
        const resultPath = path.join(
          copiedCampaignPath,
          `fixture-revote-${rate}-${repetition}`,
          'result.json'
        );
        const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        result.totalGas = String(Number(result.totalGas) + 500000);
        fs.writeFileSync(resultPath, JSON.stringify(result));
      }
    }
    const incompleteDirectory = path.join(root, 'revote-sweep', 'incomplete-run');
    fs.mkdirSync(incompleteDirectory, { recursive: true });
    fs.writeFileSync(path.join(incompleteDirectory, 'result.json'), JSON.stringify({
      status: 'failed',
      runId: 'incomplete-run'
    }));
    const report = analyzeActivityRates({
      root,
      population: 100,
      mechanism: 'both'
    });
    assert.equal(report.sweeps.length, 3);
    assert.equal(report.includedCompletedRunCount, 27);
    assert.deepEqual(report.excludedIncompleteRuns, [{
      runId: 'incomplete-run',
      status: 'failed'
    }]);
    for (const sweep of report.sweeps) {
      assert.equal(sweep.pairedRepetitions.length, 3);
      assert.deepEqual(sweep.rates.map(({ ratePercent }) => ratePercent), [0, 20, 40]);
      assert.equal(
        sweep.classifier.results['logistic-regression'].splitMethod,
        'leave-one-repetition-group-out'
      );
      assert.equal(sweep.rates[0].leakageClassifier['logistic-regression'].rocAuc, null);
      assert.equal(sweep.rates[2].actual.sensitiveCommitCount.mean, 2);
      assert.equal(sweep.rates[2].deltasFromZeroRate.totalGas, 40000);
    }
    const revote = report.sweeps.find(
      ({ mechanism, campaignPath }) => mechanism === 'revote' && campaignPath === 'revote-sweep'
    );
    assert.equal(revote.rates[2].actual.replacementBallots.mean, 2);
    assert.ok(revote.rates.every(({ runCount }) => runCount === 3));
    assert.equal(revote.rates[0].cost.totalGas.mean, 1000000);
    const copiedRevote = report.sweeps.find(
      ({ campaignPath }) => campaignPath === 'revote-sweep-copy'
    );
    assert.equal(copiedRevote.rates[0].cost.totalGas.mean, 1500000);
    const panic = report.sweeps.find(({ mechanism }) => mechanism === 'panic');
    assert.equal(panic.rates[2].actual.panicCredentialBallots.mean, 2);
    const csv = buildActivityRateCsv(report);
    assert.ok(csv.includes('replacement_ballots_mean'));
    assert.ok(csv.includes('logistic-regression_rocAuc'));
    assert.equal(csv.trim().split('\r\n').length, 10);
    assert.ok(!JSON.stringify(report).includes('transactionHash'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
