const crypto = require('crypto');

const CONFIGURATIONS = Object.freeze({
  C0: {
    label: 'C0',
    protocolVersion: 'c0-encrypted',
    revoting: false,
    panicCredentials: false,
    padding: false
  },
  C1: {
    label: 'C1',
    protocolVersion: 'c0-encrypted',
    revoting: true,
    panicCredentials: false,
    padding: false
  },
  C2: {
    label: 'C2',
    protocolVersion: 'c2-private-decoy',
    revoting: false,
    panicCredentials: true,
    padding: false
  },
  C3: {
    label: 'C3',
    protocolVersion: 'c3-revoting-decoy',
    revoting: true,
    panicCredentials: true,
    padding: false
  },
  C1p: {
    label: 'C1p',
    protocolVersion: 'c1p-revoting-padding',
    revoting: true,
    panicCredentials: false,
    padding: true
  },
  C2p: {
    label: 'C2p',
    protocolVersion: 'c2p-private-decoy-padding',
    revoting: false,
    panicCredentials: true,
    padding: true
  }
});

const NETWORKS = Object.freeze({
  anvil: { key: 'anvil', chainId: 31337, confirmationCampaign: true },
  'polygon-amoy': { key: 'polygon-amoy', chainId: 80002, confirmationCampaign: true }
});

const CAMPAIGN_MATRIX = Object.freeze({
  anvil: Object.freeze([
    ...['C0', 'C1', 'C2', 'C3'].flatMap((configuration) => (
      [100, 1000, 5000].map((population) => ({ configuration, population, repetitions: 5 }))
    )),
    ...['C1p', 'C2p'].map((configuration) => ({
      configuration,
      population: 1000,
      repetitions: 5
    }))
  ]),
  'polygon-amoy': Object.freeze([
    ...['C0', 'C1', 'C2', 'C3'].flatMap((configuration) => (
      [
        { population: 100, repetitions: 5 },
        { population: 1000, repetitions: 3 },
        { population: 5000, repetitions: 1 }
      ].map((run) => ({ configuration, ...run }))
    )),
    ...['C1p', 'C2p'].map((configuration) => ({
      configuration,
      population: 1000,
      repetitions: 3
    }))
  ])
});

const getConfiguration = (label) => {
  const configuration = CONFIGURATIONS[label];
  if (!configuration) {
    throw new Error(`Unknown research configuration. Use one of: ${Object.keys(CONFIGURATIONS).join(', ')}`);
  }
  return { ...configuration };
};

const getNetwork = (key = 'anvil') => {
  const network = NETWORKS[key];
  if (!network) throw new Error(`Unknown research network: ${Object.keys(NETWORKS).join(', ')}`);
  return { ...network };
};

const parsePositiveInteger = (value, name, maximum) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
};

const createRunManifest = ({
  configuration = 'C0',
  network = 'anvil',
  population = 100,
  repetitions = 1,
  seed = 'votechain-study',
  optionCount = 2,
  durationSeconds = null,
  commitDurationSeconds = 1800,
  revealDurationSeconds = 1800,
  paddingConfig = null,
  revoteRatePercent = 20,
  panicRatePercent = 10,
  tallyMode = process.env.RESEARCH_TALLY_MODE || 'single'
} = {}) => {
  const selected = getConfiguration(configuration);
  const selectedNetwork = getNetwork(network);
  if (!['single', 'threshold-3-of-5'].includes(tallyMode)) {
    throw new Error('tallyMode must be single or threshold-3-of-5');
  }
  for (const [name, value] of [
    ['revoteRatePercent', revoteRatePercent],
    ['panicRatePercent', panicRatePercent]
  ]) {
    if (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100) {
      throw new Error(`${name} must be a number between 0 and 100`);
    }
  }
  const actualDuration = parsePositiveInteger(
    durationSeconds === null
      ? Number(commitDurationSeconds) + Number(revealDurationSeconds)
      : durationSeconds,
    'durationSeconds',
    604800
  );
  if (actualDuration !== Number(commitDurationSeconds) + Number(revealDurationSeconds)) {
    throw new Error('durationSeconds must equal commitDurationSeconds plus revealDurationSeconds');
  }
  if (selected.padding && !paddingConfig) {
    throw new Error(`${configuration} requires an explicit paddingConfig`);
  }
  if (selected.padding && (
    typeof paddingConfig !== 'object' ||
    !Number.isFinite(Number(paddingConfig.paddingRatePercent)) ||
    Number(paddingConfig.paddingRatePercent) < 0 ||
    Number(paddingConfig.paddingRatePercent) > 100 ||
    !['population-sample', 'per-ballot'].includes(paddingConfig.selectionStrategy) ||
    !['immediate', 'fixed', 'uniform', 'exponential'].includes(paddingConfig.timingDistribution) ||
    !Number.isInteger(Number(paddingConfig.timingWindowSeconds)) ||
    Number(paddingConfig.timingWindowSeconds) < 0 ||
    Number(paddingConfig.timingWindowSeconds) > 60 ||
    !Number.isInteger(Number(paddingConfig.dummyTransactionsPerBallot)) ||
    Number(paddingConfig.dummyTransactionsPerBallot) < 0 ||
    Number(paddingConfig.dummyTransactionsPerBallot) > 20 ||
    !Number.isInteger(Number(paddingConfig.electionPopulation)) ||
    Number(paddingConfig.electionPopulation) < 1 ||
    Number(paddingConfig.electionPopulation) > 10000
  )) {
    throw new Error(`${configuration} requires all valid paddingConfig parameters`);
  }
  if (selected.padding &&
      Number(commitDurationSeconds) <= Number(paddingConfig.timingWindowSeconds)) {
    throw new Error('commitDurationSeconds must exceed the padding timing window');
  }
  const normalizedPaddingConfig = selected.padding
    ? {
      paddingRatePercent: Number(paddingConfig.paddingRatePercent),
      selectionStrategy: paddingConfig.selectionStrategy,
      timingDistribution: paddingConfig.timingDistribution,
      timingWindowSeconds: Number(paddingConfig.timingWindowSeconds),
      dummyTransactionsPerBallot: Number(paddingConfig.dummyTransactionsPerBallot),
      electionPopulation: Number(paddingConfig.electionPopulation)
    }
    : null;
  const manifest = {
    schemaVersion: 'votechain-research-run-v1',
    configuration: selected,
    network: selectedNetwork,
    population: parsePositiveInteger(population, 'population', 5000),
    repetitions: parsePositiveInteger(repetitions, 'repetitions', 100),
    seed: String(seed),
    electionId: `0x${crypto.createHash('sha256').update(String(seed)).digest('hex')}`,
    optionCount: parsePositiveInteger(optionCount, 'optionCount', 100),
    durationSeconds: actualDuration,
    commitDurationSeconds: parsePositiveInteger(commitDurationSeconds, 'commitDurationSeconds', 604800),
    revealDurationSeconds: parsePositiveInteger(revealDurationSeconds, 'revealDurationSeconds', 604800),
    revoteRatePercent: Number(revoteRatePercent),
    panicRatePercent: Number(panicRatePercent),
    tallyMode,
    paddingConfig: normalizedPaddingConfig,
    createdAt: new Date().toISOString(),
    measurements: [
      'gasPerOrdinaryVote',
      'gasPerRevote',
      'gasPerPanicAction',
      'gasPerPaddingTransaction',
      'totalElectionGas',
      'storageGrowth',
      'auditorVerificationTime',
      'verificationDataVolume',
      'observerAccuracy',
      'observerPrecision',
      'observerRecall',
      'observerF1',
      'observerRocAuc'
    ]
  };
  return manifest;
};

const createCampaignPlan = ({
  network = 'anvil',
  seed = 'votechain-study',
  paddingConfig,
  revoteRatePercent = 20,
  panicRatePercent = 10,
  commitDurationSeconds = 1800,
  revealDurationSeconds = 1800,
  configurations = Object.keys(CONFIGURATIONS),
  populations = [100, 1000, 5000]
} = {}) => {
  getNetwork(network);
  if (!Array.isArray(configurations) || configurations.length === 0) {
    throw new Error('configurations must contain at least one study condition');
  }
  configurations.forEach((configuration) => getConfiguration(configuration));
  if (!Array.isArray(populations) || populations.length === 0 ||
      populations.some((population) => ![100, 1000, 5000].includes(Number(population)))) {
    throw new Error('populations must contain only 100, 1000, and 5000');
  }
  const selectedConfigurations = new Set(configurations);
  const selectedPopulations = new Set(populations.map(Number));
  return CAMPAIGN_MATRIX[network]
    .filter((condition) => (
      selectedConfigurations.has(condition.configuration) &&
      selectedPopulations.has(condition.population)
    ))
    .flatMap((condition) => (
    Array.from({ length: condition.repetitions }, (_, index) => {
      const repetition = index + 1;
      const runSeed = `${seed}-${network}-${condition.configuration}-${condition.population}-r${repetition}`;
      return {
        runId: runSeed,
        repetition,
        ...createRunManifest({
          ...condition,
          repetitions: 1,
          network,
          seed: runSeed,
          revoteRatePercent,
          panicRatePercent,
          commitDurationSeconds,
          revealDurationSeconds,
          paddingConfig: condition.configuration.endsWith('p') ? paddingConfig : null
        })
      };
    })
  ));
};

module.exports = {
  CONFIGURATIONS,
  NETWORKS,
  CAMPAIGN_MATRIX,
  getConfiguration,
  getNetwork,
  createRunManifest,
  createCampaignPlan
};
