const fs = require('fs');
const path = require('path');
const {
  evaluateLeaveOneGroupOut,
  getLeakageFeatureNames,
  makeCommitFeatureRows
} = require('./classifiers');

const MECHANISMS = {
  revote: {
    configurations: ['C1', 'C3'],
    target: 'revote',
    rateField: 'revoteRatePercent',
    label: 'ordinary commit vs replacement/revote commit'
  },
  panic: {
    configurations: ['C2', 'C3'],
    target: 'panicOrDecoy',
    rateField: 'panicRatePercent',
    label: 'ordinary commit vs panic credential commit'
  }
};
const MODELS = ['logistic-regression', 'decision-tree', 'random-forest'];
const METRICS = ['accuracy', 'precision', 'recall', 'f1', 'rocAuc'];

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${filePath}: ${error.message}`, { cause: error });
  }
};

const findResults = (root) => {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && entry.name === 'result.json') files.push(fullPath);
    }
  };
  visit(root);
  return files.sort();
};

const loadStudyRuns = (root) => {
  const runs = [];
  const excludedIncompleteRuns = [];
  for (const resultPath of findResults(root)) {
    const result = readJson(resultPath);
    if (result.status !== 'complete') {
      excludedIncompleteRuns.push({
        runId: result.runId || path.basename(path.dirname(resultPath)),
        status: result.status
      });
      continue;
    }
    if (result.auditVerified !== true) {
      throw new Error(`Completed run ${result.runId} did not pass the auditor`);
    }
    const directory = path.dirname(resultPath);
    const manifest = readJson(path.join(directory, 'manifest.json'));
    const audit = readJson(path.join(directory, 'auditor.json'));
    const operations = readJson(path.join(directory, 'operations.json'));
    const publicRecords = readJson(path.join(directory, 'public-records.json'));
    const privateLabels = readJson(path.join(directory, 'private-labels.json'));
    if (!Array.isArray(operations) || !Array.isArray(publicRecords) ||
        !Array.isArray(privateLabels)) {
      throw new Error(`Completed run ${result.runId} has malformed observation files`);
    }
    const repetition = Number.isInteger(manifest.repetition)
      ? manifest.repetition
      : Number(String(result.runId).match(/-r(\d+)$/)?.[1]);
    runs.push({
      result,
      manifest,
      audit,
      operations,
      publicRecords,
      privateLabels,
      repetition: Number.isInteger(repetition) && repetition > 0 ? repetition : null,
      campaignPath: path.relative(root, path.dirname(directory)).split(path.sep).join('/')
    });
  }
  return { runs, excludedIncompleteRuns };
};

const summarize = (values) => {
  const numeric = values.filter(Number.isFinite);
  if (!numeric.length) return null;
  const mean = numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
  const variance = numeric.length > 1
    ? numeric.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      (numeric.length - 1)
    : 0;
  return {
    count: numeric.length,
    mean,
    standardDeviation: Math.sqrt(variance),
    minimum: Math.min(...numeric),
    maximum: Math.max(...numeric)
  };
};

const activityCounts = (run, mechanism) => {
  const commitHashes = new Set(run.operations
    .filter(({ operation }) => operation === 'commit')
    .map(({ transactionHash }) => String(transactionHash).toLowerCase()));
  const counts = { ordinary: 0, revote: 0, panic: 0, decoy: 0, padding: 0 };
  for (const label of run.privateLabels) {
    if (!commitHashes.has(String(label.transactionHash).toLowerCase())) continue;
    if (Object.prototype.hasOwnProperty.call(counts, label.activity)) {
      counts[label.activity] += 1;
    }
  }
  return mechanism === 'revote'
    ? {
      ordinary: counts.ordinary,
      sensitive: counts.revote,
      replacementBallots: counts.revote
    }
    : {
      ordinary: counts.ordinary,
      sensitive: counts.panic + counts.decoy,
      panicCredentialBallots: counts.panic
    };
};

const runRateMetrics = (runs, mechanism, campaignPath, population, rate) => {
  const selected = runs.filter(({ manifest, campaignPath: runCampaignPath }) => (
    runCampaignPath === campaignPath &&
    manifest.population === population &&
    manifest.configuration.label === mechanism.configuration &&
    Number(manifest[mechanism.rateField]) === rate
  ));
  const actionCounts = selected.map((run) => activityCounts(run, mechanism.key));
  const count = (selector) => selected.map((run) => selector(run));
  const transactionCounts = selected.map(({ result, publicRecords }) => (
    Number(result.contractTransactionCount || publicRecords.length)
  ));
  const observations = {
    runCount: selected.length,
    repetitionGroups: [...new Set(selected
      .map(({ repetition }) => repetition)
      .filter(Number.isInteger))].sort((left, right) => left - right),
    configuredActivityRatePercent: rate,
    expectedSensitiveActionsPerRun: Math.round(population * rate / 100),
    actual: {
      ordinaryCommitCount: summarize(actionCounts.map(({ ordinary }) => ordinary)),
      sensitiveCommitCount: summarize(actionCounts.map(({ sensitive }) => sensitive)),
      replacementBallots: mechanism.key === 'revote'
        ? summarize(actionCounts.map(({ replacementBallots }) => replacementBallots))
        : null,
      panicCredentialBallots: mechanism.key === 'panic'
        ? summarize(actionCounts.map(({ panicCredentialBallots }) => panicCredentialBallots))
        : null
    },
    cost: {
      totalGas: summarize(count(({ result }) => Number(result.totalGas))),
      storageGrowthBytes: summarize(selected.map(
        ({ audit }) => Number(audit.storageGrowthBytes)
      )),
      contractTransactionCount: summarize(transactionCounts),
      committedBallotCount: summarize(selected.map(
        ({ audit }) => Number(audit.committedBallots)
      )),
      revealTransactionCount: summarize(selected.map(
        ({ audit }) => Number(audit.revealedBallots)
      )),
      auditorVerificationTimeMs: summarize(selected.map(
        ({ audit }) => Number(audit.verificationTimeMs)
      )),
      auditorBytesProcessed: summarize(selected.map(
        ({ audit }) => Number(audit.bytesProcessed)
      ))
    }
  };
  return { selected, observations };
};

const buildSweep = ({ runs, campaignPath, population, configuration, mechanismKey }) => {
  const mechanismDefinition = MECHANISMS[mechanismKey];
  const relevant = runs.filter(({ manifest, campaignPath: runCampaignPath }) => (
    runCampaignPath === campaignPath &&
    manifest.population === population &&
    manifest.configuration.label === configuration
  ));
  const rates = [...new Set(relevant.map(
    ({ manifest }) => Number(manifest[mechanismDefinition.rateField])
  ))].filter(Number.isFinite).sort((left, right) => left - right);
  if (rates.length < 2) return null;

  const rateSummaries = rates.map((rate) => {
    const { selected, observations } = runRateMetrics(
      runs,
      { ...mechanismDefinition, key: mechanismKey, configuration },
      campaignPath,
      population,
      rate
    );
    return { rate, selected, observations };
  });
  const repetitions = new Set(rateSummaries.flatMap(({ selected }) => (
    selected.map(({ repetition }) => repetition).filter(Number.isInteger)
  )));
  const pairedRepetitions = [...repetitions].filter((repetition) => (
    rateSummaries.every(({ selected }) => (
      selected.some((run) => run.repetition === repetition)
    ))
  )).sort((left, right) => left - right);
  const pairedRuns = rateSummaries.flatMap(({ rate, selected }) => (
    selected
      .filter((run) => pairedRepetitions.includes(run.repetition))
      .map((run) => ({
        runId: run.result.runId,
        groupId: `${campaignPath}:population-${population}:repetition-${run.repetition}`,
        configuration: `${configuration}@${rate}%`,
        paddingRatePercent: 0,
        operations: run.operations,
        publicRecords: run.publicRecords,
        privateLabels: run.privateLabels
      }))
  ));
  const samples = makeCommitFeatureRows({
    runs: pairedRuns,
    target: mechanismDefinition.target
  });
  const rateConfigurations = rates.map((rate) => `${configuration}@${rate}%`);
  const classifier = evaluateLeaveOneGroupOut({
    samples,
    configurations: rateConfigurations,
    seed: `${campaignPath}:${mechanismKey}:${population}`
  });
  const zeroRate = rateSummaries.find(({ rate }) => rate === 0);
  const baseline = zeroRate && zeroRate.observations;
  const ratesReport = rateSummaries.map(({ rate, observations }) => {
    const baselineGas = baseline && baseline.cost.totalGas && baseline.cost.totalGas.mean;
    const gas = observations.cost.totalGas && observations.cost.totalGas.mean;
    const classifierConfiguration = `${configuration}@${rate}%`;
    return {
      ratePercent: rate,
      ...observations,
      deltasFromZeroRate: baseline ? {
        totalGas: Number.isFinite(gas) && Number.isFinite(baselineGas)
          ? gas - baselineGas
          : null,
        totalGasPercent: Number.isFinite(gas) && Number.isFinite(baselineGas) &&
          baselineGas > 0
          ? ((gas - baselineGas) / baselineGas) * 100
          : null,
        storageGrowthBytes: gasDelta(
          observations.cost.storageGrowthBytes,
          baseline.cost.storageGrowthBytes
        ),
        contractTransactionCount: gasDelta(
          observations.cost.contractTransactionCount,
          baseline.cost.contractTransactionCount
        ),
        auditorVerificationTimeMs: gasDelta(
          observations.cost.auditorVerificationTimeMs,
          baseline.cost.auditorVerificationTimeMs
        )
      } : null,
      leakageClassifier: classifier.results
        ? Object.fromEntries(MODELS.map((modelName) => [
          modelName,
          classifier.results[modelName].metricsByConfiguration[classifierConfiguration] || null
        ]))
        : null
    };
  });

  return {
    campaignPath,
    population,
    mechanism: mechanismKey,
    configuration,
    targetDefinition: mechanismDefinition.label,
    repetitionsByRate: Object.fromEntries(ratesReport.map((row) => [
      String(row.ratePercent),
      row.repetitionGroups
    ])),
    pairedRepetitions,
    rates: ratesReport,
    classifier: {
      ...classifier,
      features: getLeakageFeatureNames('full'),
      metrics: METRICS,
      pairingNote: 'All activity rates for a repetition are held out together.'
    }
  };
};

const gasDelta = (current, baseline) => (
  current && baseline && Number.isFinite(current.mean) && Number.isFinite(baseline.mean)
    ? current.mean - baseline.mean
    : null
);

const analyzeActivityRates = ({ root, population = 1000, mechanism = 'both' }) => {
  const absoluteRoot = path.resolve(root);
  if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
    throw new Error(`Study directory does not exist: ${absoluteRoot}`);
  }
  if (!Number.isInteger(population) || population < 1) {
    throw new Error('Population must be a positive integer');
  }
  const mechanismKeys = mechanism === 'both' ? Object.keys(MECHANISMS) : [mechanism];
  if (mechanismKeys.some((key) => !MECHANISMS[key])) {
    throw new Error('Mechanism must be revote, panic, or both');
  }
  const { runs, excludedIncompleteRuns } = loadStudyRuns(absoluteRoot);
  const sweeps = [];
  const campaignPaths = [...new Set(runs.map(({ campaignPath }) => campaignPath))];
  for (const campaignPath of campaignPaths) {
    for (const mechanismKey of mechanismKeys) {
      const definition = MECHANISMS[mechanismKey];
      const configurations = [...new Set(runs
        .filter(({ manifest, campaignPath: runCampaignPath }) => (
          runCampaignPath === campaignPath &&
          manifest.population === population &&
          definition.configurations.includes(manifest.configuration.label)
        ))
        .map(({ manifest }) => manifest.configuration.label))];
      for (const configuration of configurations) {
        const sweep = buildSweep({
          runs,
          campaignPath,
          population,
          configuration,
          mechanismKey
        });
        if (sweep) sweeps.push(sweep);
      }
    }
  }
  if (!sweeps.length) {
    throw new Error(
      `No multi-rate revote/panic sweeps found for population ${population} under ${absoluteRoot}`
    );
  }
  return {
    schemaVersion: 'votechain-activity-rate-analysis-v1',
    evidence: 'completed auditor-verified EVM runs only; incomplete runs excluded',
    population,
    leakageEvaluation: 'leave-one-repetition-group-out cross-validation',
    metrics: METRICS,
    includedCompletedRunCount: runs.length,
    excludedIncompleteRuns,
    sweeps
  };
};

const csvValue = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const buildActivityRateCsv = (report) => {
  const columns = [
    'campaign_path',
    'population',
    'mechanism',
    'configuration',
    'rate_percent',
    'run_count',
    'paired_repetitions',
    'expected_sensitive_actions_per_run',
    'observed_ordinary_commits_mean',
    'observed_sensitive_commits_mean',
    'observed_replacement_ballots_mean',
    'observed_panic_credentials_mean',
    'total_gas_mean',
    'total_gas_sd',
    'total_gas_delta_from_0',
    'total_gas_percent_from_0',
    'storage_growth_bytes_mean',
    'storage_delta_from_0',
    'contract_transaction_count_mean',
    'transaction_count_delta_from_0',
    'committed_ballots_mean',
    'reveal_transactions_mean',
    'auditor_verification_time_ms_mean',
    'auditor_time_delta_from_0',
    'auditor_bytes_processed_mean',
    ...MODELS.flatMap((model) => METRICS.map((metric) => `${model}_${metric}`))
  ];
  const lines = [columns.join(',')];
  for (const sweep of report.sweeps) {
    for (const rate of sweep.rates) {
      const row = [
        sweep.campaignPath,
        sweep.population,
        sweep.mechanism,
        sweep.configuration,
        rate.ratePercent,
        rate.runCount,
        sweep.pairedRepetitions.length,
        rate.expectedSensitiveActionsPerRun,
        rate.actual.ordinaryCommitCount && rate.actual.ordinaryCommitCount.mean,
        rate.actual.sensitiveCommitCount && rate.actual.sensitiveCommitCount.mean,
        rate.actual.replacementBallots && rate.actual.replacementBallots.mean,
        rate.actual.panicCredentialBallots && rate.actual.panicCredentialBallots.mean,
        rate.cost.totalGas && rate.cost.totalGas.mean,
        rate.cost.totalGas && rate.cost.totalGas.standardDeviation,
        rate.deltasFromZeroRate && rate.deltasFromZeroRate.totalGas,
        rate.deltasFromZeroRate && rate.deltasFromZeroRate.totalGasPercent,
        rate.cost.storageGrowthBytes && rate.cost.storageGrowthBytes.mean,
        rate.deltasFromZeroRate && rate.deltasFromZeroRate.storageGrowthBytes,
        rate.cost.contractTransactionCount && rate.cost.contractTransactionCount.mean,
        rate.deltasFromZeroRate && rate.deltasFromZeroRate.contractTransactionCount,
        rate.cost.committedBallotCount && rate.cost.committedBallotCount.mean,
        rate.cost.revealTransactionCount && rate.cost.revealTransactionCount.mean,
        rate.cost.auditorVerificationTimeMs && rate.cost.auditorVerificationTimeMs.mean,
        rate.deltasFromZeroRate && rate.deltasFromZeroRate.auditorVerificationTimeMs,
        rate.cost.auditorBytesProcessed && rate.cost.auditorBytesProcessed.mean,
        ...MODELS.flatMap((modelName) => METRICS.map((metric) => {
          const metrics = rate.leakageClassifier &&
            rate.leakageClassifier[modelName];
          return metrics ? metrics[metric] : null;
        }))
      ];
      lines.push(row.map(csvValue).join(','));
    }
  }
  return `${lines.join('\r\n')}\r\n`;
};

const parseArguments = (argv) => {
  let root = 'research-runs';
  let outputDirectory;
  let population = 1000;
  let mechanism = 'both';
  let hasRoot = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--output-dir') {
      if (!argv[index + 1]) throw new Error('--output-dir requires a path');
      outputDirectory = argv[++index];
    } else if (argument === '--population') {
      if (!argv[index + 1]) throw new Error('--population requires a value');
      population = Number(argv[++index]);
    } else if (argument === '--mechanism') {
      if (!argv[index + 1]) throw new Error('--mechanism requires a value');
      mechanism = argv[++index];
    } else if (argument.startsWith('--')) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (!hasRoot) {
      root = argument;
      hasRoot = true;
    } else {
      throw new Error('Provide only one study directory');
    }
  }
  return { root, outputDirectory, population, mechanism };
};

if (require.main === module) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const report = analyzeActivityRates(options);
    const outputDirectory = path.resolve(options.outputDirectory || options.root);
    fs.mkdirSync(outputDirectory, { recursive: true });
    const jsonPath = path.join(outputDirectory, 'activity-rate-analysis.json');
    const csvPath = path.join(outputDirectory, 'activity-rate-analysis.csv');
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(csvPath, buildActivityRateCsv(report));
    console.log(JSON.stringify({
      json: jsonPath,
      csv: csvPath,
      includedCompletedRunCount: report.includedCompletedRunCount,
      excludedIncompleteRunCount: report.excludedIncompleteRuns.length,
      sweepCount: report.sweeps.length
    }, null, 2));
  } catch (error) {
    console.error(`Activity-rate analysis failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  analyzeActivityRates,
  buildActivityRateCsv,
  parseArguments
};
