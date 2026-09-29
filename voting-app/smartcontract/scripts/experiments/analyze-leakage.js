const fs = require('fs');
const path = require('path');
const {
  evaluateLeaveOneGroupOut,
  makeCommitFeatureRows,
  getLeakageFeatureNames
} = require('./classifiers');

const TARGET_COMPARISONS = [
  {
    baseline: 'C1',
    padded: 'C1p',
    target: 'revote',
    label: 'ordinary commit vs revote commit'
  },
  {
    baseline: 'C2',
    padded: 'C2p',
    target: 'panicOrDecoy',
    label: 'ordinary commit vs panic/decoy commit'
  }
];
const FEATURE_VIEWS = ['full', 'without-events'];
const METRICS = ['accuracy', 'precision', 'recall', 'f1', 'rocAuc'];

const readJson = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read study output ${filePath}: ${error.message}`, {
      cause: error
    });
  }
};

const findRunResults = (root) => {
  const results = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && entry.name === 'result.json') results.push(fullPath);
    }
  };
  visit(root);
  return results.sort();
};

const loadRuns = (root) => {
  const runs = [];
  const incompleteRuns = [];
  for (const resultPath of findRunResults(root)) {
    const result = readJson(resultPath);
    if (result.status !== 'complete') {
      incompleteRuns.push({
        runId: result.runId || path.basename(path.dirname(resultPath)),
        status: result.status
      });
      continue;
    }
    if (result.auditVerified !== true) {
      throw new Error(`Refusing unaudited completed run ${result.runId}`);
    }
    const directory = path.dirname(resultPath);
    const manifestPath = path.join(directory, 'manifest.json');
    for (const requiredFile of [
      manifestPath,
      path.join(directory, 'operations.json'),
      path.join(directory, 'public-records.json'),
      path.join(directory, 'private-labels.json'),
      path.join(directory, 'auditor.json')
    ]) {
      if (!fs.existsSync(requiredFile)) {
        throw new Error(`Completed run ${result.runId} is missing ${requiredFile}`);
      }
    }
    const manifest = readJson(manifestPath);
    if (!manifest.configuration || !manifest.network || !manifest.population) {
      throw new Error(`Completed run ${result.runId} has an incomplete manifest`);
    }
    const repetition = Number.isInteger(manifest.repetition)
      ? manifest.repetition
      : Number(String(result.runId).match(/-r(\d+)$/)?.[1]);
    runs.push({
      result,
      manifest,
      operations: readJson(path.join(directory, 'operations.json')),
      publicRecords: readJson(path.join(directory, 'public-records.json')),
      privateLabels: readJson(path.join(directory, 'private-labels.json')),
      audit: readJson(path.join(directory, 'auditor.json')),
      repetition: Number.isInteger(repetition) && repetition > 0
        ? repetition
        : null
    });
  }
  return { runs, incompleteRuns };
};

const summarize = (values) => {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return null;
  const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length;
  const variance = valid.length > 1
    ? valid.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (valid.length - 1)
    : 0;
  return {
    count: valid.length,
    mean,
    standardDeviation: Math.sqrt(variance),
    minimum: Math.min(...valid),
    maximum: Math.max(...valid)
  };
};

const comparisonRows = (runs, comparison, population, paddingRatePercent) => {
  const selected = runs.filter(({ manifest }) => (
    Number(manifest.population) === population &&
    [comparison.baseline, comparison.padded].includes(manifest.configuration.label) &&
    (manifest.configuration.label !== comparison.padded ||
      Number(manifest.paddingConfig && manifest.paddingConfig.paddingRatePercent) === paddingRatePercent)
  ));
  const groups = new Map();
  for (const run of selected) {
    if (run.repetition === null) continue;
    const groupId = `${population}:repetition-${run.repetition}`;
    if (!groups.has(groupId)) groups.set(groupId, new Set());
    groups.get(groupId).add(run.manifest.configuration.label);
  }
  const pairedGroups = [...groups.entries()]
    .filter(([, configurations]) => (
      configurations.has(comparison.baseline) && configurations.has(comparison.padded)
    ))
    .map(([groupId]) => groupId);

  return selected
    .filter(({ repetition }) => (
      repetition !== null && pairedGroups.includes(`${population}:repetition-${repetition}`)
    ))
    .map((run) => ({
      runId: run.result.runId,
      groupId: `${population}:repetition-${run.repetition}`,
      configuration: run.manifest.configuration.label,
      paddingRatePercent: run.manifest.configuration.label === comparison.padded
        ? paddingRatePercent
        : 0,
      operations: run.operations,
      publicRecords: run.publicRecords,
      privateLabels: run.privateLabels
    }));
};

const summarizeCost = (
  runs,
  configuration,
  population,
  paddingRatePercent,
  includedRunIds
) => {
  const selected = runs.filter(({ manifest }) => (
    Number(manifest.population) === population &&
    manifest.configuration.label === configuration &&
    includedRunIds.has(manifest.runId) &&
    (configuration !== 'C1p' && configuration !== 'C2p' ||
      Number(manifest.paddingConfig && manifest.paddingConfig.paddingRatePercent) === paddingRatePercent)
  ));
  return {
    runCount: selected.length,
    totalGas: summarize(selected.map(({ result }) => Number(result.totalGas))),
    auditTimeMs: summarize(selected.map(({ audit }) => Number(audit.verificationTimeMs))),
    storageGrowthBytes: summarize(selected.map(({ audit }) => Number(audit.storageGrowthBytes)))
  };
};

const makeTradeoff = ({
  baseline,
  padded,
  baselineCost,
  paddedCost,
  classifier
}) => {
  const baselineGas = baselineCost.totalGas && baselineCost.totalGas.mean;
  const paddedGas = paddedCost.totalGas && paddedCost.totalGas.mean;
  const models = {};
  for (const [modelName, model] of Object.entries(classifier.results)) {
    const baselineAuc = model.metricsByConfiguration[baseline].rocAuc;
    const paddedAuc = model.metricsByConfiguration[padded].rocAuc;
    const pairedFoldDifferences = model.folds
      .map(({ metricsByConfiguration }) => ({
        baseline: metricsByConfiguration[baseline] &&
          metricsByConfiguration[baseline].rocAuc,
        padded: metricsByConfiguration[padded] &&
          metricsByConfiguration[padded].rocAuc
      }))
      .filter(({ baseline: baselineFold, padded: paddedFold }) => (
        Number.isFinite(baselineFold) && Number.isFinite(paddedFold)
      ));
    models[modelName] = {
      baselineRocAuc: baselineAuc,
      paddedRocAuc: paddedAuc,
      leakageReduction: Number.isFinite(baselineAuc) && Number.isFinite(paddedAuc)
        ? baselineAuc - paddedAuc
        : null,
      pairedFoldAucDifferencePaddedMinusBaseline: summarize(pairedFoldDifferences.map(
        ({ baseline: baselineFold, padded: paddedFold }) => paddedFold - baselineFold
      )),
      pairedFoldLeakageReduction: summarize(pairedFoldDifferences.map(
        ({ baseline: baselineFold, padded: paddedFold }) => baselineFold - paddedFold
      )),
      meanPerFold: {
        baselineRocAuc: model.meanPerFoldMetricsByConfiguration[baseline].rocAuc,
        paddedRocAuc: model.meanPerFoldMetricsByConfiguration[padded].rocAuc
      }
    };
  }
  return {
    baseline,
    padded,
    baselineGasMean: baselineGas || null,
    paddedGasMean: paddedGas || null,
    gasOverhead: Number.isFinite(baselineGas) && Number.isFinite(paddedGas)
      ? paddedGas - baselineGas
      : null,
    gasOverheadPercent: Number.isFinite(baselineGas) && baselineGas > 0 &&
      Number.isFinite(paddedGas)
      ? ((paddedGas - baselineGas) / baselineGas) * 100
      : null,
    models
  };
};

const analyzeComparison = ({
  runs,
  comparison,
  population,
  paddingRatePercent,
  privateDatasetSink
}) => {
  const selectedRuns = comparisonRows(
    runs,
    comparison,
    population,
    paddingRatePercent
  );
  const configurations = [comparison.baseline, comparison.padded];
  const includedRunIds = new Set(selectedRuns.map(({ runId }) => runId));
  const featureViews = {};
  for (const featureView of FEATURE_VIEWS) {
    const samples = makeCommitFeatureRows({
      runs: selectedRuns,
      target: comparison.target,
      featureView
    });
    if (featureView === 'full' && privateDatasetSink) {
      for (const sample of samples) {
        privateDatasetSink.push({
          ...sample,
          target: comparison.target
        });
      }
    }
    featureViews[featureView] = {
      status: 'complete',
      target: comparison.target,
      targetDefinition: comparison.label,
      configurations,
      featureView,
      groups: [...new Set(selectedRuns.map(({ groupId }) => groupId))].sort(),
      classBalanceByConfiguration: Object.fromEntries(configurations.map((configuration) => {
        const selected = samples.filter((sample) => sample.configuration === configuration);
        return [configuration, {
          total: selected.length,
          ordinary: selected.filter(({ actual }) => !actual).length,
          sensitive: selected.filter(({ actual }) => actual).length
        }];
      })),
      features: featureView === 'full'
        ? 'timestamp_unix, inter_transaction_seconds, block_interval, log1p(gas_used), calldata_bytes, method_id, event_names_json, sender_transaction_count, transaction_index, block_number'
        : 'same public features, excluding event_names_json',
      ...evaluateLeaveOneGroupOut({
        samples,
        configurations,
        seed: `${comparison.baseline}:${comparison.padded}:${population}:${paddingRatePercent}:${featureView}`
      })
    };
  }

  const baselineCost = summarizeCost(
    runs,
    comparison.baseline,
    population,
    paddingRatePercent,
    includedRunIds
  );
  const paddedCost = summarizeCost(
    runs,
    comparison.padded,
    population,
    paddingRatePercent,
    includedRunIds
  );
  const tradeoffs = Object.fromEntries(Object.entries(featureViews).map(
    ([featureView, classifier]) => [featureView, makeTradeoff({
      baseline: comparison.baseline,
      padded: comparison.padded,
      baselineCost,
      paddedCost,
      classifier
    })]
  ));
  return {
    population,
    paddingRatePercent,
    target: comparison.target,
    targetDefinition: comparison.label,
    configurations,
    pairedRepetitionGroups: featureViews.full.groups.length,
    runIds: Object.fromEntries(configurations.map((configuration) => [
      configuration,
      selectedRuns
        .filter((run) => run.configuration === configuration)
        .map((run) => run.runId)
    ])),
    cost: {
      [comparison.baseline]: baselineCost,
      [comparison.padded]: paddedCost
    },
    featureViews,
    tradeoffs
  };
};

const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  const text = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const buildPrivateDatasetCsv = (samples) => {
  const features = getLeakageFeatureNames('full');
  const columns = [
    'target',
    'configuration',
    'padding_rate_percent',
    'run_id',
    'repetition_group',
    'transaction_hash',
    'label',
    ...features
  ];
  const lines = [columns.join(',')];
  for (const sample of samples) {
    const row = [
      sample.target,
      sample.configuration,
      sample.paddingRatePercent,
      sample.runId,
      sample.groupId,
      sample.transactionHash,
      Number(sample.actual),
      ...sample.vector
    ];
    lines.push(row.map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
};

const buildTradeoffCsv = (report) => {
  const columns = [
    'population',
    'target',
    'baseline_configuration',
    'padded_configuration',
    'padding_rate_percent',
    'feature_view',
    'model',
    'fold_count',
    'baseline_roc_auc',
    'padded_roc_auc',
    'roc_auc_change_padded_minus_baseline',
    'mean_paired_fold_auc_change_padded_minus_baseline',
    'mean_paired_fold_leakage_reduction',
    'baseline_accuracy',
    'padded_accuracy',
    'baseline_precision',
    'padded_precision',
    'baseline_recall',
    'padded_recall',
    'baseline_f1',
    'padded_f1',
    'baseline_mean_fold_roc_auc',
    'padded_mean_fold_roc_auc',
    'baseline_mean_gas',
    'padded_mean_gas',
    'gas_overhead',
    'gas_overhead_percent'
  ];
  const lines = [columns.join(',')];
  for (const comparison of report.comparisons) {
    for (const [featureView, analysis] of Object.entries(comparison.featureViews)) {
      for (const [modelName, result] of Object.entries(analysis.results || {})) {
        const baseline = result.metricsByConfiguration[comparison.configurations[0]] || {};
        const padded = result.metricsByConfiguration[comparison.configurations[1]] || {};
        const tradeoff = comparison.tradeoffs[featureView];
        const modelTradeoff = tradeoff.models[modelName] || {};
        const row = [
          comparison.population,
          comparison.target,
          comparison.configurations[0],
          comparison.configurations[1],
          comparison.paddingRatePercent,
          featureView,
          modelName,
          analysis.groupCount,
          baseline.rocAuc,
          padded.rocAuc,
          Number.isFinite(baseline.rocAuc) && Number.isFinite(padded.rocAuc)
            ? padded.rocAuc - baseline.rocAuc
            : null,
          modelTradeoff.pairedFoldAucDifferencePaddedMinusBaseline &&
            modelTradeoff.pairedFoldAucDifferencePaddedMinusBaseline.mean,
          modelTradeoff.pairedFoldLeakageReduction &&
            modelTradeoff.pairedFoldLeakageReduction.mean,
          baseline.accuracy,
          padded.accuracy,
          baseline.precision,
          padded.precision,
          baseline.recall,
          padded.recall,
          baseline.f1,
          padded.f1,
          modelTradeoff.meanPerFold && modelTradeoff.meanPerFold.baselineRocAuc,
          modelTradeoff.meanPerFold && modelTradeoff.meanPerFold.paddedRocAuc,
          tradeoff.baselineGasMean,
          tradeoff.paddedGasMean,
          tradeoff.gasOverhead,
          tradeoff.gasOverheadPercent
        ];
        lines.push(row.map(csvCell).join(','));
      }
    }
  }
  return `${lines.join('\r\n')}\r\n`;
};

const analyzeLeakage = ({
  root,
  populations = [1000],
  privateDatasetSink = null
}) => {
  const absoluteRoot = path.resolve(root);
  if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
    throw new Error(`Study output directory does not exist: ${absoluteRoot}`);
  }
  const { runs, incompleteRuns } = loadRuns(absoluteRoot);
  const comparisons = [];
  for (const population of populations) {
    for (const comparison of TARGET_COMPARISONS) {
      const rates = [...new Set(runs
        .filter(({ manifest }) => (
          Number(manifest.population) === population &&
          manifest.configuration.label === comparison.padded
        ))
        .map(({ manifest }) => Number(
          manifest.paddingConfig && manifest.paddingConfig.paddingRatePercent
        ))
        .filter(Number.isFinite))].sort((left, right) => left - right);
      for (const paddingRatePercent of rates) {
        comparisons.push(analyzeComparison({
          runs,
          comparison,
          population,
          paddingRatePercent,
          privateDatasetSink
        }));
      }
    }
  }
  return {
    schemaVersion: 'votechain-leakage-analysis-v1',
    evidence: 'completed audited EVM runs; incomplete runs excluded',
    dataSplit: 'leave-one-repetition-group-out; each held-out repetition is excluded from both paired configurations during training',
    labelConstruction: {
      revote: 'commit operations only; ordinary activity is 0 and revote activity is 1; padding, panic, and decoy commits excluded',
      panicOrDecoy: 'commit operations only; ordinary activity is 0 and panic or decoy activity is 1; padding commits excluded'
    },
    classifierAlgorithms: ['logistic-regression', 'decision-tree', 'random-forest'],
    metrics: METRICS,
    featureViews: {
      full: 'all requested public transaction metadata, including public event names',
      withoutEvents: 'event-name ablation to distinguish direct public event leakage from other metadata'
    },
    numericPreprocessing: 'z-score normalization fitted independently on each training fold only; gas used is log1p transformed',
    includedCompletedRunCount: runs.length,
    excludedIncompleteRuns: incompleteRuns,
    comparisons
  };
};

const parseArguments = (argv) => {
  let root = 'research-runs';
  let outputDirectory;
  let populations = [1000];
  let exportPrivateDatasets = false;
  let hasRoot = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--export-private-datasets') {
      exportPrivateDatasets = true;
    } else if (argument === '--output-dir') {
      if (!argv[index + 1]) throw new Error('--output-dir requires a path');
      outputDirectory = argv[++index];
    } else if (argument === '--population' || argument === '--populations') {
      if (!argv[index + 1]) throw new Error(`${argument} requires comma-separated values`);
      populations = argv[++index].split(',').map(Number);
    } else if (argument.startsWith('--')) {
      throw new Error(`Unknown option: ${argument}`);
    } else if (!hasRoot) {
      root = argument;
      hasRoot = true;
    } else {
      throw new Error('Provide only one study output directory');
    }
  }
  if (!populations.length || populations.some((value) => (
    !Number.isInteger(value) || value < 1
  ))) {
    throw new Error('Population values must be positive integers');
  }
  return { root, outputDirectory, populations, exportPrivateDatasets };
};

if (require.main === module) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const privateDatasetRows = options.exportPrivateDatasets ? [] : null;
    const report = analyzeLeakage({
      ...options,
      privateDatasetSink: privateDatasetRows
    });
    const outputDirectory = path.resolve(options.outputDirectory || options.root);
    fs.mkdirSync(outputDirectory, { recursive: true });
    const jsonPath = path.join(outputDirectory, 'leakage-analysis.json');
    const csvPath = path.join(outputDirectory, 'leakage-tradeoff.csv');
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(csvPath, buildTradeoffCsv(report));
    const privateDatasetPath = privateDatasetRows
      ? path.join(outputDirectory, 'private-leakage-dataset.csv')
      : null;
    if (privateDatasetPath) {
      fs.writeFileSync(privateDatasetPath, buildPrivateDatasetCsv(privateDatasetRows));
    }
    console.log(JSON.stringify({
      json: jsonPath,
      csv: csvPath,
      privateDataset: privateDatasetPath,
      privateDatasetRows: privateDatasetRows ? privateDatasetRows.length : 0,
      includedCompletedRunCount: report.includedCompletedRunCount,
      excludedIncompleteRunCount: report.excludedIncompleteRuns.length,
      comparisonCount: report.comparisons.length
    }, null, 2));
  } catch (error) {
    console.error(`Leakage analysis failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
analyzeLeakage,
buildPrivateDatasetCsv,
buildTradeoffCsv,
parseArguments
};
