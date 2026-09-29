const fs = require('fs');
const path = require('path');
const { calculateAccuracy } = require('../../../backend/src/services/experiments/ObserverAccuracy');
const { evaluateClassifiers } = require('./classifiers');

const T_CRITICAL_95 = [
  null, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262,
  2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093,
  2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045,
  2.042
];

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const summarize = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.length > 1
    ? values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1)
    : 0;
  const percentile = (fraction) => sorted[Math.min(
    sorted.length - 1,
    Math.floor((sorted.length - 1) * fraction)
  )];
  const tCritical = values.length > 1
    ? T_CRITICAL_95[Math.min(values.length - 1, 30)] || 1.96
    : null;
  const standardError = Math.sqrt(variance / values.length);
  return {
    count: values.length,
    mean,
    median: percentile(0.5),
    standardDeviation: Math.sqrt(variance),
    interquartileRange: percentile(0.75) - percentile(0.25),
    confidenceInterval95: values.length > 1
      ? [mean - tCritical * standardError, mean + tCritical * standardError]
      : null
  };
};

const loadCompletedRuns = (campaignRoot) => {
  const runs = [];
  for (const entry of fs.readdirSync(campaignRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runDirectory = path.join(campaignRoot, entry.name);
    const resultPath = path.join(runDirectory, 'result.json');
    if (!fs.existsSync(resultPath)) continue;
    const result = readJson(resultPath);
    if (result.status !== 'complete' || result.auditVerified !== true) {
      throw new Error(`Incomplete or unaudited run cannot be analyzed: ${entry.name}`);
    }
    const manifest = readJson(path.join(runDirectory, 'manifest.json'));
    runs.push({
      result,
      manifest,
      operations: readJson(path.join(runDirectory, 'operations.json')),
      publicRecords: readJson(path.join(runDirectory, 'public-records.json')),
      privateLabels: readJson(path.join(runDirectory, 'private-labels.json')),
      audit: readJson(path.join(runDirectory, 'auditor.json'))
    });
  }
  if (!runs.length) throw new Error(`No completed runs found in ${campaignRoot}`);
  return runs;
};

const metricFor = (run, metric) => {
  if (metric === 'totalGas') return Number(run.result.totalGas);
  if (metric === 'auditTimeMs') return run.audit.verificationTimeMs;
  if (metric === 'observerRocAuc') {
    return calculateAccuracy({
      publicRecords: run.publicRecords,
      privateLabels: run.privateLabels
    }).rocAuc;
  }
  return null;
};

const compareAtPopulation = (runs, population, left, right, metric) => {
  const summarized = {};
  for (const configuration of [left, right]) {
    const values = runs.filter(({ manifest }) => (
      manifest.population === population &&
      manifest.configuration.label === configuration
    )).map((run) => metricFor(run, metric)).filter(Number.isFinite);
    summarized[configuration] = summarize(values);
  }
  if (!summarized[left] || !summarized[right]) return null;
  return {
    population,
    left,
    right,
    meanDifferenceRightMinusLeft: summarized[right].mean - summarized[left].mean,
    [left]: summarized[left],
    [right]: summarized[right]
  };
};

const meanAt = (runs, population, configuration, metric) => {
  const values = runs.filter(({ manifest }) => (
    manifest.population === population &&
    manifest.configuration.label === configuration
  )).map((run) => metricFor(run, metric)).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
};

const differenceInDifferencesAt = (runs, population, metric) => {
  const [baseline, revoting, panic, combined] = ['C0', 'C1', 'C2', 'C3'].map(
    (configuration) => meanAt(runs, population, configuration, metric)
  );
  if ([baseline, revoting, panic, combined].some((value) => value === null)) return null;
  return combined - revoting - panic + baseline;
};

const buildParetoFrontier = (runs) => {
  const candidates = [];
  const populations = [...new Set(runs.map(({ manifest }) => manifest.population))];
  const configurations = [...new Set(runs.map(({ manifest }) => manifest.configuration.label))];
  for (const population of populations) {
    for (const configuration of configurations) {
      const rows = runs.filter(({ manifest }) => (
        manifest.population === population &&
        manifest.configuration.label === configuration
      ));
      if (!rows.length) continue;
      const metrics = ['totalGas', 'auditTimeMs', 'observerRocAuc'].map((metric) => (
        summarize(rows.map((run) => metricFor(run, metric)).filter(Number.isFinite))
      ));
      if (metrics.some((metric) => metric === null)) continue;
      candidates.push({
        configuration,
        population,
        totalGas: metrics[0].mean,
        auditTimeMs: metrics[1].mean,
        observerRocAuc: metrics[2].mean
      });
    }
  }
  return candidates.filter((candidate) => !candidates.some((other) => (
    other !== candidate &&
    other.population === candidate.population &&
    other.totalGas <= candidate.totalGas &&
    other.auditTimeMs <= candidate.auditTimeMs &&
    other.observerRocAuc <= candidate.observerRocAuc &&
    (other.totalGas < candidate.totalGas ||
      other.auditTimeMs < candidate.auditTimeMs ||
      other.observerRocAuc < candidate.observerRocAuc)
  )));
};

const analyzeCampaign = (campaignRoot) => {
  const runs = loadCompletedRuns(path.resolve(campaignRoot));
  const groups = {};
  for (const run of runs) {
    const configuration = run.manifest.configuration.label;
    if (!groups[configuration]) groups[configuration] = [];
    if (!run.operations.length) throw new Error(`Run ${run.result.runId} has no operations`);
    const labelsByHash = new Map(run.privateLabels.map((label) => [
      label.transactionHash.toLowerCase(),
      label.activity
    ]));
    const actionGas = {};
    for (const operation of run.operations) {
      if (!['commit', 'reveal'].includes(operation.operation)) continue;
      const activity = labelsByHash.get(operation.transactionHash.toLowerCase());
      if (!activity || activity === 'unlabeled') {
        throw new Error(`Missing private activity label for ${operation.transactionHash}`);
      }
      if (!actionGas[activity]) actionGas[activity] = [];
      actionGas[activity].push(Number(operation.gasUsed));
    }
    const observer = calculateAccuracy({
      publicRecords: run.publicRecords,
      privateLabels: run.privateLabels
    });
    groups[configuration].push({
      runId: run.result.runId,
      population: run.manifest.population,
      totalGas: Number(run.result.totalGas),
      storageGrowthBytes: run.audit.storageGrowthBytes,
      auditTimeMs: run.audit.verificationTimeMs,
      auditorBytesProcessed: run.audit.bytesProcessed,
      observer,
      actionGas,
      exceptionRecords: run.audit.exceptionalRecords
    });
  }

  const summaryByConfiguration = {};
  for (const [configuration, records] of Object.entries(groups)) {
    const actions = [...new Set(records.flatMap(({ actionGas }) => Object.keys(actionGas)))];
    const perActionGas = {};
    for (const action of actions) {
      perActionGas[action] = summarize(records
        .map(({ actionGas }) => actionGas[action])
        .filter((values) => values && values.length)
        .map((values) => values.reduce((sum, value) => sum + value, 0) / values.length));
    }
    summaryByConfiguration[configuration] = {
      runs: records.length,
      population: summarize(records.map(({ population }) => population)),
      totalGas: summarize(records.map(({ totalGas }) => totalGas)),
      storageGrowthBytes: summarize(records.map(({ storageGrowthBytes }) => storageGrowthBytes)),
      auditTimeMs: summarize(records.map(({ auditTimeMs }) => auditTimeMs)),
      auditorBytesProcessed: summarize(records.map(({ auditorBytesProcessed }) => auditorBytesProcessed)),
      observerAccuracy: summarize(records.map(({ observer }) => observer.accuracy)),
      observerPrecision: summarize(records.map(({ observer }) => observer.precision)),
      observerRecall: summarize(records.map(({ observer }) => observer.recall)),
      observerF1: summarize(records.map(({ observer }) => observer.f1)),
      observerRocAuc: summarize(records.map(({ observer }) => observer.rocAuc).filter(Number.isFinite)),
      exceptionRecords: summarize(records.map(({ exceptionRecords }) => exceptionRecords)),
      gasByAction: perActionGas
    };
  }

  const comparisons = [];
  const populations = [...new Set(runs.map(({ manifest }) => manifest.population))].sort(
    (left, right) => left - right
  );
  for (const [left, right] of [
    ['C1', 'C1p'],
    ['C2', 'C2p'],
    ['C0', 'C1'],
    ['C0', 'C2'],
    ['C3', 'C1'],
    ['C3', 'C2']
  ]) {
    comparisons.push({
      left,
      right,
      populations: populations.map((population) => ({
        totalGas: compareAtPopulation(runs, population, left, right, 'totalGas'),
        auditTime: compareAtPopulation(runs, population, left, right, 'auditTimeMs'),
        observerAuc: compareAtPopulation(runs, population, left, right, 'observerRocAuc')
      }))
    });
  }

  const interactionEffects = populations.map((population) => ({
    population,
    gasDifferenceInDifferences: differenceInDifferencesAt(runs, population, 'totalGas'),
    auditTimeDifferenceInDifferences: differenceInDifferencesAt(runs, population, 'auditTimeMs')
  }));
  const classifierReports = [];
  const classifierGroups = [
    { configurations: ['C1', 'C1p'], target: 'revote' },
    { configurations: ['C2', 'C2p'], target: 'panicOrDecoy' },
    { configurations: ['C3'], target: 'revote' },
    { configurations: ['C3'], target: 'panicOrDecoy' }
  ];
  for (const population of populations) {
    for (const { configurations, target } of classifierGroups) {
      const selectedRuns = runs
        .filter(({ manifest }) => (
          configurations.includes(manifest.configuration.label) &&
          manifest.population === population
        ))
        .map((run) => {
          const repetitionMatch = String(run.result.runId).match(/-r(\d+)$/);
          const repetition = run.manifest.repetition || (
            repetitionMatch ? Number(repetitionMatch[1]) : null
          );
          return {
            runId: run.result.runId,
            groupId: repetition === null
              ? run.manifest.electionId || run.result.runId
              : `${path.basename(path.resolve(campaignRoot))}:${population}:r${repetition}`,
            configuration: run.manifest.configuration.label,
            publicRecords: run.publicRecords,
            privateLabels: run.privateLabels
          };
        });
      classifierReports.push({
        population,
        configurations,
        ...evaluateClassifiers({
          runs: selectedRuns,
          target,
          seed: `${configurations.join('-')}:${population}:${target}`
        })
      });
    }
  }

  return {
    schemaVersion: 'votechain-research-analysis-v1',
    evidence: 'executed EVM runs only; no imputed or synthetic observations',
    runCount: runs.length,
    summaryByConfiguration,
    comparisons,
    interactionEffects,
    paretoFrontier: buildParetoFrontier(runs),
    classifiers: {
      algorithms: ['logistic-regression', 'decision-tree', 'random-forest'],
      dataSplit: 'deterministic held-out campaign/election groups; paired configurations from one repetition stay in one partition',
      reports: classifierReports
    }
  };
};

if (require.main === module) {
  const campaignRoot = process.argv[2];
  if (!campaignRoot) {
    console.error('Usage: npm run experiment:analyze -- <campaign-directory> [--output report.json]');
    process.exitCode = 1;
  } else {
    const analysis = analyzeCampaign(campaignRoot);
    const outputIndex = process.argv.indexOf('--output');
    const output = outputIndex >= 0
      ? path.resolve(process.argv[outputIndex + 1])
      : path.join(path.resolve(campaignRoot), 'analysis.json');
    fs.writeFileSync(output, `${JSON.stringify(analysis, null, 2)}\n`, { flag: 'wx' });
    console.log(JSON.stringify({
      output,
      runCount: analysis.runCount,
      configurations: Object.keys(analysis.summaryByConfiguration)
    }, null, 2));
  }
}

module.exports = { analyzeCampaign, loadCompletedRuns, summarize };
