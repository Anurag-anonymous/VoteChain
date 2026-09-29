const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { COLUMNS, exportStudyCsv } = require('./export-study-csv');

test('exports campaign, run, auditor, public transaction and partial-operation rows without private labels', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'votechain-study-csv-'));
  try {
    const campaignDirectory = path.join(root, 'anvil', 'sample');
    const completeDirectory = path.join(campaignDirectory, 'run-one');
    const failedDirectory = path.join(campaignDirectory, 'run-two');
    fs.mkdirSync(completeDirectory, { recursive: true });
    fs.mkdirSync(failedDirectory, { recursive: true });
    const writeJson = (directory, filename, value) => {
      fs.writeFileSync(path.join(directory, filename), JSON.stringify(value));
    };
    writeJson(campaignDirectory, 'campaign.json', {
      status: 'failed',
      network: 'anvil',
      chainId: 31337,
      expectedRuns: 2,
      completedRuns: 1,
      error: { message: 'interrupted campaign' }
    });
    writeJson(completeDirectory, 'result.json', {
      status: 'complete',
      runId: 'run-one',
      seed: 'seed-one',
      configuration: 'C1',
      population: 2,
      totalGas: '90000',
      contractTransactionCount: 1,
      auditVerified: true
    });
    writeJson(completeDirectory, 'manifest.json', {
      runId: 'run-one',
      seed: 'seed-one',
      repetition: 1,
      configuration: { label: 'C1' },
      network: { key: 'anvil', chainId: 31337 },
      population: 2,
      electionId: '0xelection',
      revoteRatePercent: 20,
      panicRatePercent: 10,
      tallyMode: 'single',
      paddingConfig: null,
      provenance: { solcVersion: '0.8.20', nodeVersion: 'v24' }
    });
    writeJson(completeDirectory, 'operations.json', [{
      operation: 'commit',
      transactionHash: '0xtx1',
      from: '0xactor',
      blockNumber: 10,
      gasUsed: '90000',
      calldataBytes: 132
    }]);
    writeJson(completeDirectory, 'public-records.json', [{
      transactionHash: '0xtx1',
      submitter: '0xactor',
      recipient: '0xcontract',
      blockNumber: 10,
      transactionIndex: 0,
      timestamp: 100,
      gasUsed: '90000',
      calldataBytes: 132,
      methodId: '0x12345678',
      eventNames: ['BallotCommitted', 'Test, Event'],
      interTransactionSeconds: 1,
      blockInterval: 1,
      senderTransactionCount: 1
    }]);
    writeJson(completeDirectory, 'auditor.json', {
      verified: true,
      proofType: 'event reconstruction',
      committedBallots: 1,
      tally: { '0': 1 },
      transactionsProcessed: 1,
      bytesProcessed: 42,
      verificationTimeMs: 2.5
    });
    writeJson(completeDirectory, 'private-labels.json', [
      { transactionHash: '0xtx1', activity: 'PRIVATE_LABEL_SENTINEL' }
    ]);
    writeJson(completeDirectory, 'private-scenario.json', {
      secret: 'PRIVATE_SCENARIO_SENTINEL'
    });

    writeJson(failedDirectory, 'result.json', {
      status: 'failed',
      runId: 'run-two',
      seed: 'seed-two',
      error: { message: 'synthetic failure' }
    });
    writeJson(failedDirectory, 'partial-operations.json', [{
      operation: 'deployment',
      transactionHash: '0xtx2',
      from: '0xadmin',
      gasUsed: '50000'
    }]);

    const output = path.join(root, 'study-output.csv');
    const summary = exportStudyCsv({ inputRoot: root, outputFile: output });
    const csv = fs.readFileSync(output, 'utf8');
    const rows = csv.trimEnd().split('\r\n');
    assert.equal(rows[0], COLUMNS.join(','));
    assert.equal(summary.campaignCount, 1);
    assert.equal(summary.runCount, 2);
    assert.equal(summary.completedRuns, 1);
    assert.equal(summary.incompleteRuns, 1);
    assert.equal(summary.transactionCount, 2);
    assert.equal(rows.filter((row) => row.startsWith('campaign,')).length, 1);
    assert.equal(rows.filter((row) => row.startsWith('run,')).length, 2);
    assert.equal(rows.filter((row) => row.startsWith('transaction,')).length, 2);
    assert.ok(csv.includes('"[""BallotCommitted"",""Test, Event""]"'));
    assert.ok(csv.includes('"{""0"":1}"'));
    assert.ok(csv.includes('PRIVATE_LABEL_SENTINEL') === false);
    assert.ok(csv.includes('PRIVATE_SCENARIO_SENTINEL') === false);
    assert.ok(csv.includes('synthetic failure'));
    const refreshed = exportStudyCsv({ inputRoot: root, outputFile: output });
    assert.equal(refreshed.transactionCount, 2);
    assert.ok(fs.existsSync(output));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
