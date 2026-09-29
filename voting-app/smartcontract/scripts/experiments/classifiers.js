const crypto = require('crypto');
const Web3 = require('web3');
const { calculateBinaryMetrics } = require('../../../backend/src/services/experiments/ObserverAccuracy');
const web3 = new Web3();
const METHOD_IDS = [
  ...[
    'commit(bytes32,bytes32,bytes32,uint64)',
    'reveal(bytes32,uint32,bytes32)',
    'startCommit()',
    'endCommit()',
    'finalize()'
  ].map((signature) => web3.eth.abi.encodeFunctionSignature(signature)),
  'other'
].sort();
const EVENT_NAMES = ['BallotCommitted', 'BallotSuperseded', 'BallotRevealed'];
const FEATURE_NAMES = [
  'log-gas-used',
  'calldata-bytes',
  'inter-transaction-seconds',
  'block-interval',
  'log-transactions-per-sender',
  'relative-election-position',
  ...METHOD_IDS.map((methodId) => `method:${methodId}`),
  ...EVENT_NAMES.map((eventName) => `event:${eventName}`)
];
const MODEL_CONFIGURATIONS = {
  'logistic-regression': {
    iterations: 400,
    learningRate: 0.08,
    l2Regularization: 0.01,
    threshold: 0.5
  },
  'decision-tree': {
    maxDepth: 5,
    minimumNodeSamples: 10,
    minimumLeafSamples: 5,
    thresholdCandidates: 15,
    minimumGiniGain: 1e-6
  },
  'random-forest': {
    trees: 31,
    maxDepth: 5,
    minimumNodeSamples: 10,
    minimumLeafSamples: 5,
    thresholdCandidates: 15,
    minimumGiniGain: 1e-6
  }
};
const MAX_SAMPLES_PER_RUN = 2000;
const LEAKAGE_FEATURE_NAMES = [
  'timestamp-unix',
  'inter-transaction-seconds',
  'block-interval',
  'log-gas-used',
  'calldata-bytes',
  'sender-transaction-count',
  'transaction-index',
  'block-number',
  ...METHOD_IDS.map((methodId) => `method:${methodId}`),
  ...EVENT_NAMES.map((eventName) => `event:${eventName}`)
];
const getLeakageFeatureNames = (featureView = 'full') => (
  featureView === 'full'
    ? [...LEAKAGE_FEATURE_NAMES]
    : LEAKAGE_FEATURE_NAMES.slice(0, -EVENT_NAMES.length)
);

const stableRandom = (seed) => {
  let state = Number.parseInt(
    crypto.createHash('sha256').update(seed).digest('hex').slice(0, 8),
    16
  ) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const makeFeatureRows = (runs, target) => {
  const methodIds = METHOD_IDS;
  const eventNames = EVENT_NAMES;
  const methodIndex = new Map(methodIds.map((method, index) => [method, index]));
  const labelsByRun = runs.map(({
    runId,
    groupId = runId,
    configuration,
    publicRecords,
    privateLabels
  }) => {
    const labelMap = new Map();
    for (const label of privateLabels) {
      if (typeof label.transactionHash !== 'string' ||
          !/^0x[0-9a-f]{64}$/i.test(label.transactionHash) ||
          labelMap.has(label.transactionHash.toLowerCase())) {
        throw new Error(`Run ${runId} has an invalid or duplicate private-label transaction hash`);
      }
      labelMap.set(label.transactionHash.toLowerCase(), label);
    }
    const senderCounts = new Map();
    publicRecords.forEach(({ submitter }) => {
      if (typeof submitter !== 'string' || !submitter) {
        throw new Error(`Run ${runId} has an invalid public-record submitter`);
      }
      senderCounts.set(submitter, (senderCounts.get(submitter) || 0) + 1);
    });
    const count = publicRecords.length;
    const featureRows = publicRecords.map((record, index) => {
      if (typeof record.transactionHash !== 'string' ||
          !/^0x[0-9a-f]{64}$/i.test(record.transactionHash)) {
        throw new Error(`Run ${runId} has an invalid public-record transaction hash`);
      }
      const label = labelMap.get(record.transactionHash.toLowerCase());
      if (!label) {
        throw new Error(`Run ${runId} has a public record without a private label`);
      }
      const numericFeatures = {
        gasUsed: Number(record.gasUsed),
        calldataBytes: Number(record.calldataBytes),
        interTransactionSeconds: Number(record.interTransactionSeconds),
        blockInterval: Number(record.blockInterval)
      };
      for (const [name, value] of Object.entries(numericFeatures)) {
        if (!Number.isFinite(value) || value < 0) {
          throw new Error(`Run ${runId} has invalid public feature ${name}`);
        }
      }
      if (!Array.isArray(record.eventNames) ||
          record.eventNames.some((eventName) => typeof eventName !== 'string')) {
        throw new Error(`Run ${runId} has invalid public feature eventNames`);
      }
      if (target === 'panicOrDecoy' &&
          (typeof label.panic !== 'boolean' || typeof label.decoy !== 'boolean')) {
        throw new Error(`Run ${runId} has an invalid private label for ${target}`);
      }
      const targetValue = target === 'panicOrDecoy'
        ? label.panic || label.decoy
        : label[target];
      if (typeof targetValue !== 'boolean') {
        throw new Error(`Run ${runId} has an invalid private label for ${target}`);
      }
      const vector = [
        Math.log1p(numericFeatures.gasUsed),
        numericFeatures.calldataBytes,
        numericFeatures.interTransactionSeconds,
        numericFeatures.blockInterval,
        Math.log1p(senderCounts.get(record.submitter) || 0),
        count < 2 ? 0 : index / (count - 1)
      ];
      const methodFeatures = Array(methodIds.length).fill(0);
      const method = methodIndex.has(record.methodId) ? record.methodId : 'other';
      methodFeatures[methodIndex.get(method)] = 1;
      const eventFeatures = eventNames.map((eventName) => (
        record.eventNames.includes(eventName) ? 1 : 0
      ));
      return {
        runId,
        groupId,
        transactionHash: record.transactionHash,
        configuration: configuration || 'unspecified',
        vector: [...vector, ...methodFeatures, ...eventFeatures],
        actual: targetValue
      };
    });
    const positives = featureRows.filter(({ actual }) => actual);
    const negatives = featureRows.filter(({ actual }) => !actual);
    const sampleClass = (rows) => rows.map((row) => ({
      row,
      rank: crypto.createHash('sha256')
        .update(`${runId}:${target}:${row.transactionHash}`)
        .digest('hex')
    })).sort((left, right) => left.rank.localeCompare(right.rank))
      .slice(0, 500)
      .map(({ row }) => row);
    return [
      ...sampleClass(positives),
      ...sampleClass(negatives)
    ];
  });
  return labelsByRun.flat();
};

const splitByCampaignGroup = (samples, seed) => {
  const groupsByConfiguration = new Map();
  for (const sample of samples) {
    if (!groupsByConfiguration.has(sample.configuration)) {
      groupsByConfiguration.set(sample.configuration, new Set());
    }
    groupsByConfiguration.get(sample.configuration).add(sample.groupId);
  }
  const testGroupIds = new Set();
  for (const [configuration, configurationGroupSet] of groupsByConfiguration) {
    const groupIds = [...configurationGroupSet].sort((left, right) => (
      crypto.createHash('sha256').update(`${seed}:${configuration}:${left}`).digest('hex')
        .localeCompare(crypto.createHash('sha256')
          .update(`${seed}:${configuration}:${right}`)
          .digest('hex'))
    ));
    if (groupIds.length < 2) {
      return {
        error: `At least two independent campaign/election groups are required for ${configuration}`
      };
    }
    const testCount = Math.min(
      groupIds.length - 1,
      Math.max(1, Math.ceil(groupIds.length * 0.2))
    );
    groupIds.slice(0, testCount).forEach((groupId) => testGroupIds.add(groupId));
  }
  if (testGroupIds.size === 0) {
    return { error: 'At least two independent campaign/election groups are required for held-out evaluation' };
  }
  const training = samples.filter(({ groupId }) => !testGroupIds.has(groupId));
  const test = samples.filter(({ groupId }) => testGroupIds.has(groupId));
  if (!training.some(({ actual }) => actual) ||
      !training.some(({ actual }) => !actual) ||
      !test.some(({ actual }) => actual) ||
      !test.some(({ actual }) => !actual)) {
    return {
      error: 'Campaign/election-level split does not contain both classes in train and test; collect more independent runs'
    };
  }
  const testRunIds = [...new Set(test.map(({ runId }) => runId))];
  return { training, test, testRunIds };
};

const normalizeTraining = (training) => {
  const dimensions = training[0].vector.length;
  const means = Array(dimensions).fill(0);
  const deviations = Array(dimensions).fill(0);
  for (const sample of training) {
    sample.vector.forEach((value, index) => { means[index] += value; });
  }
  means.forEach((_, index) => { means[index] /= training.length; });
  for (const sample of training) {
    sample.vector.forEach((value, index) => {
      deviations[index] += (value - means[index]) ** 2;
    });
  }
  deviations.forEach((value, index) => {
    deviations[index] = Math.sqrt(value / Math.max(1, training.length - 1)) || 1;
  });
  const transform = (vector) => vector.map(
    (value, index) => (value - means[index]) / deviations[index]
  );
  return {
    transform,
    training: training.map((sample) => ({
      ...sample,
      vector: transform(sample.vector)
    }))
  };
};

const logisticModel = (training, seed) => {
  const random = stableRandom(seed);
  const dimension = training[0].vector.length;
  const weights = Array.from({ length: dimension + 1 }, () => (
    (random() - 0.5) * 0.02
  ));
  const iterations = 400;
  const learningRate = 0.08;
  const regularization = 0.01;
  const sigmoid = (value) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradients = Array(weights.length).fill(0);
    for (const sample of training) {
      const prediction = sigmoid(weights[0] + sample.vector.reduce(
        (sum, feature, index) => sum + feature * weights[index + 1],
        0
      ));
      const error = prediction - Number(sample.actual);
      gradients[0] += error;
      sample.vector.forEach((feature, index) => {
        gradients[index + 1] += error * feature;
      });
    }
    weights[0] -= learningRate * gradients[0] / training.length;
    for (let index = 1; index < weights.length; index += 1) {
      weights[index] -= learningRate * (
        gradients[index] / training.length + regularization * weights[index]
      );
    }
  }
  return (vector) => sigmoid(weights[0] + vector.reduce(
    (sum, feature, index) => sum + feature * weights[index + 1],
    0
  ));
};

const gini = (samples) => {
  if (!samples.length) return 0;
  const positive = samples.reduce((sum, sample) => sum + Number(sample.actual), 0);
  const ratio = positive / samples.length;
  return 2 * ratio * (1 - ratio);
};

const buildTree = (samples, featureIndices, random, depth = 0) => {
  const positives = samples.reduce((sum, sample) => sum + Number(sample.actual), 0);
  const probability = positives / samples.length;
  const leaf = { probability };
  if (depth >= 5 || samples.length < 10 || probability === 0 || probability === 1) {
    return leaf;
  }
  const shuffled = [...featureIndices].sort(() => random() - 0.5);
  const selectedFeatures = shuffled.slice(0, Math.max(1, Math.ceil(Math.sqrt(featureIndices.length))));
  let best = null;
  for (const feature of selectedFeatures) {
    const values = [...new Set(samples.map(({ vector }) => vector[feature]))].sort(
      (left, right) => left - right
    );
    if (values.length < 2) continue;
    const positions = new Set();
    for (let point = 1; point <= 15; point += 1) {
      positions.add(Math.floor((values.length - 1) * point / 16));
    }
    for (const position of positions) {
      if (position < 0 || position >= values.length - 1) continue;
      const threshold = (values[position] + values[position + 1]) / 2;
      const left = samples.filter(({ vector }) => vector[feature] <= threshold);
      const right = samples.filter(({ vector }) => vector[feature] > threshold);
      if (left.length < 5 || right.length < 5) continue;
      const score = (left.length * gini(left) + right.length * gini(right)) / samples.length;
      if (!best || score < best.score) best = { feature, threshold, left, right, score };
    }
  }
  if (!best || gini(samples) - best.score < 1e-6) return leaf;
  return {
    feature: best.feature,
    threshold: best.threshold,
    left: buildTree(best.left, featureIndices, random, depth + 1),
    right: buildTree(best.right, featureIndices, random, depth + 1)
  };
};

const treeProbability = (tree, vector) => {
  if (tree.probability !== undefined) return tree.probability;
  return treeProbability(
    vector[tree.feature] <= tree.threshold ? tree.left : tree.right,
    vector
  );
};

const decisionTreeModel = (training, seed) => {
  const random = stableRandom(seed);
  const features = Array.from({ length: training[0].vector.length }, (_, index) => index);
  const tree = buildTree(training, features, random);
  return (vector) => treeProbability(tree, vector);
};

const forestModel = (training, seed) => {
  const random = stableRandom(seed);
  const features = Array.from({ length: training[0].vector.length }, (_, index) => index);
  const trees = Array.from({ length: 31 }, () => {
    const bootstrap = Array.from({ length: training.length }, () => (
      training[Math.floor(random() * training.length)]
    ));
    return buildTree(bootstrap, features, random);
  });
  return (vector) => trees.reduce(
    (sum, tree) => sum + treeProbability(tree, vector),
    0
  ) / trees.length;
};

const sampleByHash = (rows, runId, target, limit) => rows.map((row) => ({
  row,
  rank: crypto.createHash('sha256')
    .update(`${runId}:${target}:${row.transactionHash}`)
    .digest('hex')
})).sort((left, right) => left.rank.localeCompare(right.rank))
  .slice(0, limit)
  .map(({ row }) => row);

const makeCommitFeatureRows = ({ runs, target, featureView = 'full' }) => {
  if (!['revote', 'panicOrDecoy'].includes(target)) {
    throw new Error(`Unsupported leakage target: ${target}`);
  }
  if (!['full', 'without-events'].includes(featureView)) {
    throw new Error(`Unsupported leakage feature view: ${featureView}`);
  }

  const methodIndex = new Map(METHOD_IDS.map((method, index) => [method, index]));
  return runs.flatMap((run) => {
    const {
      runId,
      groupId = runId,
      configuration,
      paddingRatePercent = null,
      operations,
      publicRecords,
      privateLabels
    } = run;
    const publicByHash = new Map();
    for (const record of publicRecords) {
      if (typeof record.transactionHash !== 'string' ||
          !/^0x[0-9a-f]{64}$/i.test(record.transactionHash)) {
        throw new Error(`Run ${runId} has an invalid public transaction hash`);
      }
      publicByHash.set(record.transactionHash.toLowerCase(), record);
    }
    const labelsByHash = new Map();
    for (const label of privateLabels) {
      if (typeof label.transactionHash !== 'string' ||
          labelsByHash.has(label.transactionHash.toLowerCase())) {
        throw new Error(`Run ${runId} has invalid or duplicate private labels`);
      }
      labelsByHash.set(label.transactionHash.toLowerCase(), label);
    }

    const commitOperations = operations.filter(({ operation }) => operation === 'commit');
    const featureRows = [];
    for (const operation of commitOperations) {
      const transactionHash = operation.transactionHash;
      if (typeof transactionHash !== 'string' ||
          !/^0x[0-9a-f]{64}$/i.test(transactionHash)) {
        throw new Error(`Run ${runId} has a commit without a transaction hash`);
      }
      const hash = transactionHash.toLowerCase();
      const record = publicByHash.get(hash);
      const label = labelsByHash.get(hash);
      if (!record || !label) {
        throw new Error(`Run ${runId} is missing public metadata or a ground-truth label for commit ${hash}`);
      }
      let actual;
      if (target === 'revote') {
        if (!['ordinary', 'revote'].includes(label.activity)) continue;
        actual = label.activity === 'revote';
      } else {
        if (!['ordinary', 'panic', 'decoy'].includes(label.activity)) continue;
        actual = label.activity === 'panic' || label.activity === 'decoy';
      }

      const values = {
        timestampUnix: Number(record.timestamp),
        interTransactionSeconds: Number(record.interTransactionSeconds),
        blockInterval: Number(record.blockInterval),
        gasUsed: Number(operation.gasUsed || record.gasUsed),
        calldataBytes: Number(operation.calldataBytes || record.calldataBytes),
        senderTransactionCount: Number(record.senderTransactionCount),
        transactionIndex: Number(record.transactionIndex),
        blockNumber: Number(record.blockNumber)
      };
      for (const [name, value] of Object.entries(values)) {
        if (!Number.isFinite(value) || value < 0) {
          throw new Error(`Run ${runId} has invalid commit metadata ${name}`);
        }
      }
      if (typeof record.methodId !== 'string' ||
          !Array.isArray(record.eventNames) ||
          record.eventNames.some((eventName) => typeof eventName !== 'string')) {
        throw new Error(`Run ${runId} has invalid method/event metadata for ${hash}`);
      }
      const methodFeatures = Array(METHOD_IDS.length).fill(0);
      const methodId = methodIndex.has(record.methodId) ? record.methodId : 'other';
      methodFeatures[methodIndex.get(methodId)] = 1;
      const eventFeatures = EVENT_NAMES.map((eventName) => (
        record.eventNames.includes(eventName) ? 1 : 0
      ));
      const featureVector = [
        values.timestampUnix,
        values.interTransactionSeconds,
        values.blockInterval,
        Math.log1p(values.gasUsed),
        values.calldataBytes,
        values.senderTransactionCount,
        values.transactionIndex,
        values.blockNumber,
        ...methodFeatures,
        ...eventFeatures
      ];
      if (featureView === 'without-events') {
        featureVector.splice(featureVector.length - EVENT_NAMES.length, EVENT_NAMES.length);
      }
      featureRows.push({
        runId,
        groupId,
        configuration,
        paddingRatePercent,
        transactionHash: hash,
        vector: featureVector,
        actual
      });
    }

    if (featureRows.length <= MAX_SAMPLES_PER_RUN) return featureRows;
    const positives = featureRows.filter(({ actual }) => actual);
    const negatives = featureRows.filter(({ actual }) => !actual);
    const positiveLimit = Math.max(
      positives.length ? 1 : 0,
      Math.min(positives.length, Math.round(
        MAX_SAMPLES_PER_RUN * positives.length / featureRows.length
      ))
    );
    const negativeLimit = Math.min(
      negatives.length,
      MAX_SAMPLES_PER_RUN - positiveLimit
    );
    return [
      ...sampleByHash(positives, runId, target, positiveLimit),
      ...sampleByHash(negatives, runId, target, negativeLimit)
    ];
  });
};

const evaluateLeaveOneGroupOut = ({ samples, configurations, seed }) => {
  const groups = [...new Set(samples.map(({ groupId }) => groupId))].sort();
  if (groups.length < 2) {
    return {
      status: 'insufficient-independent-runs',
      groupCount: groups.length,
      error: 'Leave-one-run-out evaluation requires at least two independent repetition groups'
    };
  }
  const modelFunctions = {
    'logistic-regression': logisticModel,
    'decision-tree': decisionTreeModel,
    'random-forest': forestModel
  };
  const results = {};
  for (const [name, makeModel] of Object.entries(modelFunctions)) {
    const outOfFold = [];
    const foldReports = [];
    for (const groupId of groups) {
      const trainingSamples = samples.filter((sample) => sample.groupId !== groupId);
      const testSamples = samples.filter((sample) => sample.groupId === groupId);
      if (!trainingSamples.some(({ actual }) => actual) ||
          !trainingSamples.some(({ actual }) => !actual)) {
        return {
          status: 'insufficient-independent-runs',
          groupCount: groups.length,
          error: `Training fold ${groupId} does not contain both target classes`
        };
      }
      const normalized = normalizeTraining(trainingSamples);
      const predictScore = makeModel(
        normalized.training,
        `${seed}:${name}:${groupId}`
      );
      const predictions = testSamples.map((sample) => {
        const score = predictScore(normalized.transform(sample.vector));
        return {
          score,
          predicted: score >= 0.5,
          actual: sample.actual,
          configuration: sample.configuration,
          groupId: sample.groupId
        };
      });
      outOfFold.push(...predictions);
      foldReports.push({
        heldOutGroupId: groupId,
        sampleCount: predictions.length,
        metricsByConfiguration: Object.fromEntries(
          configurations.map((configuration) => {
            const observations = predictions.filter(
              (row) => row.configuration === configuration
            );
            return [
              configuration,
              observations.length ? calculateBinaryMetrics(observations) : null
            ];
          })
        )
      });
    }
    const metricsByConfiguration = Object.fromEntries(
      configurations.map((configuration) => {
        const observations = outOfFold.filter(
          (row) => row.configuration === configuration
        );
        return [
          configuration,
          observations.length ? calculateBinaryMetrics(observations) : null
        ];
      })
    );
    const foldMeansByConfiguration = Object.fromEntries(
      configurations.map((configuration) => {
        const foldMetrics = foldReports
          .map(({ metricsByConfiguration: metrics }) => metrics[configuration])
          .filter(Boolean);
        const metricNames = ['accuracy', 'precision', 'recall', 'f1', 'rocAuc'];
        return [configuration, Object.fromEntries(metricNames.map((metric) => {
          const values = foldMetrics
            .map((metrics) => metrics[metric])
            .filter(Number.isFinite);
          return [metric, values.length
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : null];
        }))];
      })
    );
    results[name] = {
      modelConfiguration: MODEL_CONFIGURATIONS[name],
      metricsByConfiguration,
      meanPerFoldMetricsByConfiguration: foldMeansByConfiguration,
      folds: foldReports,
      splitMethod: 'leave-one-repetition-group-out'
    };
  }
  return {
    status: 'complete',
    groupCount: groups.length,
    sampleCount: samples.length,
    samplesByConfiguration: Object.fromEntries(
      configurations.map((configuration) => [
        configuration,
        samples.filter((sample) => sample.configuration === configuration).length
      ])
    ),
    classesByConfiguration: Object.fromEntries(
      configurations.map((configuration) => {
        const selected = samples.filter((sample) => sample.configuration === configuration);
        return [configuration, {
          ordinary: selected.filter(({ actual }) => !actual).length,
          sensitive: selected.filter(({ actual }) => actual).length
        }];
      })
    ),
    folds: groups,
    sampling: `deterministic proportional sample capped at ${MAX_SAMPLES_PER_RUN} commit rows per run`,
    results
  };
};

const evaluateClassifiers = ({ runs, target, seed }) => {
  const samples = makeFeatureRows(runs, target);
  const split = splitByCampaignGroup(samples, seed);
  if (split.error) {
    return {
      status: 'insufficient-independent-runs',
      target,
      seed,
      sampleCount: samples.length,
      error: split.error
    };
  }
  const normalized = normalizeTraining(split.training);
  const training = normalized.training;
  const test = split.test.map((sample) => ({
    ...sample,
    vector: normalized.transform(sample.vector)
  }));
  const modelFunctions = {
    'logistic-regression': logisticModel,
    'decision-tree': decisionTreeModel,
    'random-forest': forestModel
  };
  const results = {};
  for (const [name, makeModel] of Object.entries(modelFunctions)) {
    const predictScore = makeModel(training, `${seed}:${name}`);
    const observations = test.map((sample) => {
      const score = predictScore(sample.vector);
      return {
        score,
        predicted: score >= 0.5,
        actual: sample.actual,
        configuration: sample.configuration
      };
    });
    const metricsByConfiguration = Object.fromEntries(
      [...new Set(observations.map(({ configuration }) => configuration))]
        .map((configuration) => [configuration, calculateBinaryMetrics(
          observations.filter((observation) => observation.configuration === configuration)
        )])
    );
    results[name] = {
      ...calculateBinaryMetrics(observations),
      modelConfiguration: MODEL_CONFIGURATIONS[name],
      seed: `${seed}:${name}`,
      metricsByConfiguration,
      heldOutRunIds: split.testRunIds,
      splitMethod: 'deterministic campaign/election-level holdout'
    };
  }
  return {
    status: 'complete',
    target,
    seed,
    features: FEATURE_NAMES,
    sampleCount: samples.length,
    sampling: 'deterministic class-stratified hash sample, capped at 500 per class per run',
    standardization: 'z-score parameters fitted on training rows only',
    trainingSamples: training.length,
    testSamples: test.length,
    heldOutRunIds: split.testRunIds,
    results
  };
};

module.exports = {
  evaluateClassifiers,
  evaluateLeaveOneGroupOut,
  makeCommitFeatureRows,
  getLeakageFeatureNames
};
