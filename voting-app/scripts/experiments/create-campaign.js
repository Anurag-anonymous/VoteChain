const fs = require('fs');
const path = require('path');
const { createCampaignPlan } = require('../../backend/src/config/researchStudy');

const argumentsByName = {};
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (!argument.startsWith('--')) continue;
  const [name, inlineValue] = argument.slice(2).split('=');
  argumentsByName[name] = inlineValue === undefined ? process.argv[++index] : inlineValue;
}

const network = argumentsByName.network || 'anvil';
const paddingConfig = {
  paddingRatePercent: argumentsByName['padding-rate'],
  selectionStrategy: argumentsByName['selection-strategy'],
  timingDistribution: argumentsByName['timing-distribution'],
  timingWindowSeconds: argumentsByName['timing-window-seconds'],
  dummyTransactionsPerBallot: argumentsByName['dummy-transactions-per-ballot'],
  electionPopulation: argumentsByName['election-population']
};
const plan = createCampaignPlan({
  network,
  seed: argumentsByName.seed || 'votechain-study',
  paddingConfig,
  revoteRatePercent: argumentsByName['revote-rate'] || 20,
  panicRatePercent: argumentsByName['panic-rate'] || 10,
  commitDurationSeconds: argumentsByName['commit-duration'] || 1800,
  revealDurationSeconds: argumentsByName['reveal-duration'] || 1800,
  configurations: argumentsByName.configurations
    ? String(argumentsByName.configurations).split(',').map((item) => item.trim())
    : undefined,
  populations: argumentsByName.populations
    ? String(argumentsByName.populations).split(',').map(Number)
    : undefined
});
const output = path.resolve(argumentsByName.output || path.join(
  process.cwd(),
  'research-runs',
  `${network}-campaign-plan.json`
));

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
console.log(JSON.stringify({
  output,
  network,
  plannedRuns: plan.length,
  executionStatus: 'planned-not-executed'
}, null, 2));
