const {
  CONFIGURATIONS,
  CAMPAIGN_MATRIX,
  createCampaignPlan,
  createRunManifest
} = require('../config/researchStudy');
const SingleTrusteeTallyCoordinator = require('../services/tally/SingleTrusteeTallyCoordinator');

describe('research study configuration', () => {
  test('exposes the six paper configurations independently', () => {
    expect(Object.keys(CONFIGURATIONS)).toEqual(['C0', 'C1', 'C2', 'C3', 'C1p', 'C2p']);
    expect(CONFIGURATIONS.C0.revoting).toBe(false);
    expect(CONFIGURATIONS.C1.revoting).toBe(true);
    expect(CONFIGURATIONS.C2.panicCredentials).toBe(true);
    expect(CONFIGURATIONS.C1p.padding).toBe(true);
  });

  test('creates reproducible run metadata with one-trustee default', () => {
    const manifest = createRunManifest({
      configuration: 'C1p',
      population: 1000,
      repetitions: 5,
      seed: 'seed-1',
      paddingConfig: {
        paddingRatePercent: 30,
        selectionStrategy: 'population-sample',
        timingDistribution: 'fixed',
        timingWindowSeconds: 10,
        dummyTransactionsPerBallot: 2,
        electionPopulation: 1000
      }
    });
    expect(manifest.configuration.label).toBe('C1p');
    expect(manifest.population).toBe(1000);
    expect(manifest.repetitions).toBe(5);
    expect(manifest.tallyMode).toBe('single');
    expect(manifest.measurements).toContain('observerRocAuc');
  });

  test('matches the paper campaign matrix and emits unique one-repetition run IDs', () => {
    expect(CAMPAIGN_MATRIX.anvil.reduce((sum, run) => sum + run.repetitions, 0)).toBe(70);
    expect(CAMPAIGN_MATRIX['polygon-amoy'].reduce((sum, run) => sum + run.repetitions, 0)).toBe(42);

    const plan = createCampaignPlan({
      network: 'anvil',
      seed: 'paper',
      paddingConfig: {
        paddingRatePercent: 20,
        selectionStrategy: 'population-sample',
        timingDistribution: 'uniform',
        timingWindowSeconds: 10,
        dummyTransactionsPerBallot: 1,
        electionPopulation: 1000
      }
    });
    expect(plan).toHaveLength(70);
    expect(new Set(plan.map((run) => run.runId)).size).toBe(70);
    expect(plan.every((run) => run.repetitions === 1)).toBe(true);
    expect(plan.find((run) => run.configuration.label === 'C1p').paddingConfig.paddingRatePercent).toBe(20);
  });

  test('requires explicit padding parameters for padded run manifests', () => {
    expect(() => createRunManifest({ configuration: 'C2p' }))
      .toThrow(/requires an explicit paddingConfig/);
  });

  test('single trustee can finalize while threshold coordinator remains separate', () => {
    const coordinator = new SingleTrusteeTallyCoordinator();
    coordinator.registerTrustee({ trusteeId: 'trustee-1', publicKey: 'research-key' });
    coordinator.submitShare({ electionId: 'election-1', trusteeId: 'trustee-1', share: 'share' });
    expect(coordinator.canFinalize({ electionId: 'election-1' })).toBe(true);
    expect(coordinator.finalizeTally({
      electionId: 'election-1',
      publicBallotCount: 10
    }).coordinator).toBe('single-trustee-research');
  });
});
