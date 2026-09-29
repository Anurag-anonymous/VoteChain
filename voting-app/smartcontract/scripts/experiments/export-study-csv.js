const fs = require('fs');
const path = require('path');

const COLUMNS = [
  'record_type',
  'network',
  'chain_id',
  'campaign_path',
  'campaign_status',
  'campaign_expected_runs',
  'campaign_completed_runs',
  'run_id',
  'run_status',
  'configuration',
  'repetition',
  'population',
  'seed',
  'election_id',
  'contract_address',
  'started_at',
  'completed_at',
  'error',
  'total_gas',
  'contract_transaction_count',
  'audit_verified',
  'proof_type',
  'committed_ballots',
  'revealed_ballots',
  'superseded_ballots',
  'unrevealed_active_ballots',
  'exceptional_records',
  'storage_growth_words',
  'storage_growth_bytes',
  'storage_measurement',
  'commit_phase_duration_seconds',
  'reveal_phase_duration_seconds',
  'tally_json',
  'auditor_transactions_processed',
  'auditor_bytes_processed',
  'auditor_verification_time_ms',
  'compiler_version',
  'node_version',
  'git_commit',
  'git_dirty',
  'revote_rate_percent',
  'panic_rate_percent',
  'padding_rate_percent',
  'tally_mode',
  'padding_config_json',
  'transaction_hash',
  'operation',
  'sender',
  'recipient',
  'block_number',
  'transaction_index',
  'timestamp_unix',
  'gas_used',
  'calldata_bytes',
  'method_id',
  'event_names_json',
  'inter_transaction_seconds',
  'block_interval',
  'sender_transaction_count'
];

const readJson = (filePath, required = false) => {
  if (!fs.existsSync(filePath)) {
    if (required) throw new Error(`Required study output is missing: ${filePath}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not parse study output ${filePath}: ${error.message}`, {
      cause: error
    });
  }
};

const findOutputs = (root) => {
  const campaigns = [];
  const runs = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && entry.name === 'campaign.json') {
        campaigns.push(fullPath);
      } else if (entry.isFile() && entry.name === 'result.json') {
        runs.push(fullPath);
      }
    }
  };
  visit(root);
  return {
    campaigns: campaigns.sort(),
    runs: runs.sort()
  };
};

const csvValue = (value) => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const spreadsheetSafe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(spreadsheetSafe)
    ? `"${spreadsheetSafe.replace(/"/g, '""')}"`
    : spreadsheetSafe;
};

const csvRow = (row) => COLUMNS.map((column) => csvValue(row[column])).join(',');

const replaceFile = (temporaryPath, outputPath) => {
  const backupPath = `${outputPath}.${process.pid}.bak`;
  let backedUp = false;
  try {
    if (fs.existsSync(outputPath)) {
      fs.renameSync(outputPath, backupPath);
      backedUp = true;
    }
    fs.renameSync(temporaryPath, outputPath);
    if (backedUp) fs.unlinkSync(backupPath);
  } catch (error) {
    if (backedUp && !fs.existsSync(outputPath) && fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, outputPath);
    }
    if (!backedUp && fs.existsSync(outputPath) &&
        ['EBUSY', 'EACCES', 'EPERM'].includes(error.code)) {
      throw new Error(
        `Cannot replace ${outputPath}; close applications using that file or choose a different --output path.`,
        { cause: error }
      );
    }
    throw error;
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
};

const campaignPathFor = (root, runDirectory) => {
  const relative = path.relative(root, runDirectory);
  const parts = relative.split(path.sep);
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
};

const campaignRow = (root, filePath, campaign) => ({
  record_type: 'campaign',
  network: campaign.network,
  chain_id: campaign.chainId,
  campaign_path: path.relative(root, path.dirname(filePath)).split(path.sep).join('/'),
  campaign_status: campaign.status,
  campaign_expected_runs: campaign.expectedRuns,
  campaign_completed_runs: campaign.completedRuns,
  started_at: campaign.startedAt,
  completed_at: campaign.completedAt,
  error: campaign.error && campaign.error.message
});

const auditFields = (audit) => ({
  audit_verified: audit && audit.verified,
  proof_type: audit && audit.proofType,
  committed_ballots: audit && audit.committedBallots,
  revealed_ballots: audit && audit.revealedBallots,
  superseded_ballots: audit && audit.supersededBallots,
  unrevealed_active_ballots: audit && audit.unrevealedActiveBallots,
  exceptional_records: audit && audit.exceptionalRecords,
  storage_growth_words: audit && audit.storageGrowthWords,
  storage_growth_bytes: audit && audit.storageGrowthBytes,
  storage_measurement: audit && audit.storageMeasurement,
  commit_phase_duration_seconds: audit && audit.commitPhaseDurationSeconds,
  reveal_phase_duration_seconds: audit && audit.revealPhaseDurationSeconds,
  tally_json: audit && audit.tally,
  auditor_transactions_processed: audit && audit.transactionsProcessed,
  auditor_bytes_processed: audit && audit.bytesProcessed,
  auditor_verification_time_ms: audit && audit.verificationTimeMs
});

const runFields = ({ root, resultPath, result, manifest, audit }) => {
  const directory = path.dirname(resultPath);
  const provenance = (manifest && manifest.provenance) || {};
  return {
    network: manifest && manifest.network && manifest.network.key,
    chain_id: (manifest && manifest.network && manifest.network.chainId) ||
      provenance.chainId,
    campaign_path: campaignPathFor(root, directory),
    run_id: result.runId,
    run_status: result.status,
    configuration: result.configuration ||
      (manifest && manifest.configuration && manifest.configuration.label),
    repetition: manifest && manifest.repetition,
    population: result.population || (manifest && manifest.population),
    seed: result.seed || (manifest && manifest.seed),
    election_id: manifest && manifest.electionId,
    contract_address: result.contractAddress || provenance.contractAddress,
    started_at: result.startedAt || provenance.startedAt,
    completed_at: result.completedAt,
    error: result.error && result.error.message,
    total_gas: result.totalGas,
    contract_transaction_count: result.contractTransactionCount,
    ...auditFields(audit),
    compiler_version: provenance.solcVersion,
    node_version: provenance.nodeVersion,
    git_commit: provenance.commit,
    git_dirty: provenance.dirty,
    revote_rate_percent: manifest && manifest.revoteRatePercent,
    panic_rate_percent: manifest && manifest.panicRatePercent,
    padding_rate_percent: manifest && manifest.paddingConfig &&
      manifest.paddingConfig.paddingRatePercent,
    tally_mode: manifest && manifest.tallyMode,
    padding_config_json: manifest && manifest.paddingConfig
  };
};

const transactionRows = ({ root, resultPath, result, manifest, audit }) => {
  const directory = path.dirname(resultPath);
  const completed = result.status === 'complete';
  const operations = readJson(path.join(directory, 'operations.json')) ||
    readJson(path.join(directory, 'partial-operations.json')) ||
    [];
  const publicRecords = completed
    ? readJson(path.join(directory, 'public-records.json'), true)
    : readJson(path.join(directory, 'partial-public-records.json')) || [];
  const publicByHash = new Map(publicRecords.map((record) => [
    String(record.transactionHash).toLowerCase(),
    record
  ]));
  const seenHashes = new Set();
  const context = runFields({ root, resultPath, result, manifest, audit });
  const rows = [];

  for (const operation of operations) {
    const hash = String(operation.transactionHash || '').toLowerCase();
    const record = hash ? publicByHash.get(hash) : null;
    if (hash) seenHashes.add(hash);
    rows.push({
      record_type: 'transaction',
      ...context,
      transaction_hash: operation.transactionHash,
      operation: operation.operation,
      sender: (record && record.submitter) || operation.from,
      recipient: record && record.recipient,
      block_number: (record && record.blockNumber) || operation.blockNumber,
      transaction_index: record && record.transactionIndex,
      timestamp_unix: record && record.timestamp,
      gas_used: operation.gasUsed || (record && record.gasUsed),
      calldata_bytes: operation.calldataBytes || (record && record.calldataBytes),
      method_id: record && record.methodId,
      event_names_json: record && record.eventNames,
      inter_transaction_seconds: record && record.interTransactionSeconds,
      block_interval: record && record.blockInterval,
      sender_transaction_count: record && record.senderTransactionCount
    });
  }

  for (const record of publicRecords) {
    const hash = String(record.transactionHash || '').toLowerCase();
    if (seenHashes.has(hash)) continue;
    rows.push({
      record_type: 'transaction',
      ...context,
      transaction_hash: record.transactionHash,
      sender: record.submitter,
      recipient: record.recipient,
      block_number: record.blockNumber,
      transaction_index: record.transactionIndex,
      timestamp_unix: record.timestamp,
      gas_used: record.gasUsed,
      calldata_bytes: record.calldataBytes,
      method_id: record.methodId,
      event_names_json: record.eventNames,
      inter_transaction_seconds: record.interTransactionSeconds,
      block_interval: record.blockInterval,
      sender_transaction_count: record.senderTransactionCount
    });
  }
  return rows;
};

const exportStudyCsv = ({ inputRoot, outputFile }) => {
  const root = path.resolve(inputRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Study output directory does not exist: ${root}`);
  }
  const output = path.resolve(outputFile || path.join(root, 'study-output.csv'));
  const { campaigns, runs } = findOutputs(root);
  if (campaigns.length === 0 && runs.length === 0) {
    throw new Error(`No campaign.json or result.json files found under ${root}`);
  }

  const lines = [COLUMNS.join(',')];
  for (const filePath of campaigns) {
    lines.push(csvRow(campaignRow(root, filePath, readJson(filePath, true))));
  }

  let completedRuns = 0;
  let incompleteRuns = 0;
  let transactionCount = 0;
  for (const resultPath of runs) {
    const result = readJson(resultPath, true);
    const directory = path.dirname(resultPath);
    const completed = result.status === 'complete';
    const manifest = readJson(
      path.join(directory, 'manifest.json'),
      completed
    );
    const audit = readJson(path.join(directory, 'auditor.json'), completed);
    const context = runFields({ root, resultPath, result, manifest, audit });
    lines.push(csvRow({ record_type: 'run', ...context }));
    if (completed) completedRuns += 1;
    else incompleteRuns += 1;
    const txRows = transactionRows({
      root,
      resultPath,
      result,
      manifest,
      audit
    });
    txRows.forEach((row) => lines.push(csvRow(row)));
    transactionCount += txRows.length;
  }

  const temporaryPath = `${output}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(temporaryPath, `${lines.join('\r\n')}\r\n`, {
    encoding: 'utf8',
    flag: 'wx'
  });
  replaceFile(temporaryPath, output);
  return {
    output,
    campaignCount: campaigns.length,
    runCount: runs.length,
    completedRuns,
    incompleteRuns,
    transactionCount
  };
};

const parseArguments = (argv) => {
  let inputRoot = 'research-runs';
  let outputFile;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--output') {
      if (!argv[index + 1]) throw new Error('--output requires a file path');
      outputFile = argv[++index];
    } else if (argument.startsWith('--')) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (inputRoot === 'research-runs') {
      inputRoot = argument;
    } else {
      throw new Error('Provide only one study output directory');
    }
  }
  return { inputRoot, outputFile };
};

if (require.main === module) {
  try {
    const result = exportStudyCsv(parseArguments(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`Study CSV export failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { COLUMNS, exportStudyCsv };
