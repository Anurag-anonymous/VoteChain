const classifyPublicActivity = (records) => {
  const ordered = [...records].sort((left, right) => (
    new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
  ));
  const counts = new Map();
  for (const record of ordered) {
    if (record.submitter) {
      counts.set(record.submitter, (counts.get(record.submitter) || 0) + 1);
    }
  }

  return ordered.map((record) => ({
    transactionHash: record.transactionHash,
    score: Number(Boolean(record.submitter && counts.get(record.submitter) > 1)),
    prediction: Boolean(record.submitter && counts.get(record.submitter) > 1)
  }));
};

const calculateBinaryMetrics = (observations) => {
  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  const positives = [];
  const negatives = [];

  for (const observation of observations) {
    if (observation.actual) {
      positives.push(observation.score);
      if (observation.predicted) truePositive += 1;
      else falseNegative += 1;
    } else {
      negatives.push(observation.score);
      if (observation.predicted) falsePositive += 1;
      else trueNegative += 1;
    }
  }

  const total = observations.length;
  const precision = truePositive + falsePositive === 0
    ? 0
    : truePositive / (truePositive + falsePositive);
  const recall = truePositive + falseNegative === 0
    ? 0
    : truePositive / (truePositive + falseNegative);
  const auc = positives.length && negatives.length
    ? positives.reduce((sum, positive) => (
      sum + negatives.reduce((innerSum, negative) => (
        innerSum + (positive > negative ? 1 : (positive === negative ? 0.5 : 0))
      ), 0)
    ), 0) / (positives.length * negatives.length)
    : null;

  return {
    total,
    correct: truePositive + trueNegative,
    accuracy: total ? (truePositive + trueNegative) / total : 0,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
    rocAuc: auc,
    confusionMatrix: { truePositive, trueNegative, falsePositive, falseNegative }
  };
};

const calculateAccuracy = ({ publicRecords, privateLabels }) => {
  if (!Array.isArray(publicRecords) || !Array.isArray(privateLabels)) {
    throw new Error('publicRecords and privateLabels must both be arrays');
  }

  const labelsByTransaction = new Map();
  for (const label of privateLabels) {
    if (!label || typeof label.transactionHash !== 'string' || labelsByTransaction.has(label.transactionHash)) {
      throw new Error('privateLabels must have unique transactionHash values');
    }
    labelsByTransaction.set(label.transactionHash, label);
  }
  const predictions = classifyPublicActivity(publicRecords);
  const matched = predictions.filter((prediction) => (
    labelsByTransaction.has(prediction.transactionHash)
  ));
  if (matched.length === 0) {
    throw new Error('No observer records matched the private ground-truth labels');
  }
  const scoreTarget = (target) => calculateBinaryMetrics(matched
    .filter(({ transactionHash }) => (
      target === 'sensitiveActivity' ||
      typeof labelsByTransaction.get(transactionHash)[target] === 'boolean'
    ))
    .map((prediction) => ({
      score: prediction.score,
      predicted: prediction.prediction,
      actual: Boolean(labelsByTransaction.get(prediction.transactionHash)[target])
    })));
  const overallMetrics = scoreTarget('sensitiveActivity');
  const accuracyByTarget = {};
  for (const target of ['revote', 'panic', 'excludedDuringCleansing']) {
    const targetMetrics = scoreTarget(target);
    if (targetMetrics.total > 0) {
      accuracyByTarget[target] = targetMetrics;
    }
  }

  return {
    total: matched.length,
    ...overallMetrics,
    overallMetrics,
    accuracyByTarget,
    predictions
  };
};

module.exports = {
  classifyPublicActivity,
  calculateAccuracy,
  calculateBinaryMetrics
};
