const fs = require('fs');
const path = require('path');
const { calculateAccuracy } = require('../../backend/src/services/experiments/ObserverAccuracy');

const readDataset = (filePath) => JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));

const [baselinePath, paddedPath] = process.argv.slice(2);
if (!baselinePath || !paddedPath) {
  console.error('Usage: node scripts/experiments/analyze-observer.js <baseline.json> <padded.json>');
  process.exitCode = 1;
} else {
  const baseline = calculateAccuracy(readDataset(baselinePath));
  const padded = calculateAccuracy(readDataset(paddedPath));
  const change = padded.accuracy - baseline.accuracy;
  console.log(JSON.stringify({
    observer: 'repeated-submitter heuristic',
    baseline: {
      total: baseline.total,
      correct: baseline.correct,
      accuracy: baseline.accuracy,
      precision: baseline.precision,
      recall: baseline.recall,
      f1: baseline.f1,
      rocAuc: baseline.rocAuc,
      confusionMatrix: baseline.confusionMatrix,
      accuracyByTarget: baseline.accuracyByTarget
    },
    padded: {
      total: padded.total,
      correct: padded.correct,
      accuracy: padded.accuracy,
      precision: padded.precision,
      recall: padded.recall,
      f1: padded.f1,
      rocAuc: padded.rocAuc,
      confusionMatrix: padded.confusionMatrix,
      accuracyByTarget: padded.accuracyByTarget
    },
    accuracyChange: change,
    paddingReducedAccuracy: change < 0
  }, null, 2));
}
