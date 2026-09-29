const fs = require('fs');
const path = require('path');
const { createRunManifest, CONFIGURATIONS } = require('../../backend/src/config/researchStudy');

const argumentsByName = {};
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (!argument.startsWith('--')) continue;
  const [name, inlineValue] = argument.slice(2).split('=');
  argumentsByName[name] = inlineValue === undefined ? process.argv[++index] : inlineValue;
}

const output = argumentsByName.output || path.join(
  process.cwd(),
  'research-runs',
  `${argumentsByName.configuration || 'C0'}-${argumentsByName.seed || Date.now()}.json`
);
const isPaddedConfiguration = (argumentsByName.configuration || 'C0').endsWith('p');
const paddingConfig = isPaddedConfiguration
  ? {
    paddingRatePercent: argumentsByName['padding-rate'],
    selectionStrategy: argumentsByName['selection-strategy'],
    timingDistribution: argumentsByName['timing-distribution'],
    timingWindowSeconds: argumentsByName['timing-window-seconds'],
    dummyTransactionsPerBallot: argumentsByName['dummy-transactions-per-ballot'],
    electionPopulation: argumentsByName['election-population']
  }
  : null;

const manifest = createRunManifest({
  configuration: argumentsByName.configuration || 'C0',
  network: argumentsByName.network || 'anvil',
  population: argumentsByName.population || 100,
  repetitions: argumentsByName.repetitions || 1,
  seed: argumentsByName.seed || 'votechain-study',
  optionCount: argumentsByName.options || 2,
  durationSeconds: argumentsByName.duration,
  commitDurationSeconds: argumentsByName['commit-duration'] || 1800,
  revealDurationSeconds: argumentsByName['reveal-duration'] || 1800,
  revoteRatePercent: argumentsByName['revote-rate'] || 20,
  panicRatePercent: argumentsByName['panic-rate'] || 10,
  paddingConfig,
  tallyMode: argumentsByName.tallyMode || 'single'
});

fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(path.resolve(output), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({
  output: path.resolve(output),
  configurations: Object.keys(CONFIGURATIONS),
  manifest
}, null, 2));
