const {
  BallotPaddingService,
  normalizePaddingConfig
} = require('../services/experiments/BallotPaddingService');
const { calculateAccuracy } = require('../services/experiments/ObserverAccuracy');
const {
  PROTOCOL_VERSIONS,
  isEncryptedProtocolVersion,
  usesC1Revoting,
  usesPaddedActivity,
  usesPanicCredentials
} = require('../protocol');

const makePoll = (paddingConfig) => ({
  _id: { toString: () => 'election-1' },
  paddingConfig,
  paddingParticipants: [],
  paddingLedger: [],
  save: jest.fn().mockResolvedValue(undefined)
});

describe('padded protocol controls', () => {
  test('C1p combines revoting and padding; C2p combines decoys and padding', () => {
    expect(isEncryptedProtocolVersion(PROTOCOL_VERSIONS.C1P_PADDED)).toBe(true);
    expect(isEncryptedProtocolVersion(PROTOCOL_VERSIONS.C2P_PADDED)).toBe(true);
    expect(usesC1Revoting(PROTOCOL_VERSIONS.C1P_PADDED)).toBe(true);
    expect(usesC1Revoting(PROTOCOL_VERSIONS.C2P_PADDED)).toBe(false);
    expect(usesPanicCredentials(PROTOCOL_VERSIONS.C1P_PADDED)).toBe(false);
    expect(usesPanicCredentials(PROTOCOL_VERSIONS.C2P_PADDED)).toBe(true);
    expect(usesPaddedActivity(PROTOCOL_VERSIONS.C1P_PADDED)).toBe(true);
    expect(usesPaddedActivity(PROTOCOL_VERSIONS.C2P_PADDED)).toBe(true);
  });

  test('validates all configurable padding parameters', () => {
    expect(normalizePaddingConfig({
      paddingRatePercent: 30,
      selectionStrategy: 'population-sample',
      timingDistribution: 'exponential',
      timingWindowSeconds: 15,
      dummyTransactionsPerBallot: 3,
      electionPopulation: 250
    })).toEqual({
      paddingRatePercent: 30,
      selectionStrategy: 'population-sample',
      timingDistribution: 'exponential',
      timingWindowSeconds: 15,
      dummyTransactionsPerBallot: 3,
      electionPopulation: 250
    });
    expect(() => normalizePaddingConfig({
      paddingRatePercent: 101,
      selectionStrategy: 'population-sample',
      timingDistribution: 'uniform',
      timingWindowSeconds: 1,
      dummyTransactionsPerBallot: 1,
      electionPopulation: 10
    })).toThrow(/paddingRatePercent/);
    expect(() => normalizePaddingConfig({
      paddingRatePercent: 10,
      selectionStrategy: 'population-sample',
      timingDistribution: 'unknown',
      timingWindowSeconds: 1,
      dummyTransactionsPerBallot: 1,
      electionPopulation: 10
    })).toThrow(/timingDistribution/);
  });

  test('selects the configured share of the declared population without replacement', () => {
    const service = new BallotPaddingService({ randomInt: () => 0 });
    const poll = makePoll({
      paddingRatePercent: 50,
      selectionStrategy: 'population-sample',
      timingDistribution: 'immediate',
      timingWindowSeconds: 0,
      dummyTransactionsPerBallot: 1,
      electionPopulation: 4
    });

    const selections = ['voter-1', 'voter-2', 'voter-3', 'voter-4']
      .map((voterId) => service.selectParticipant(poll, voterId));
    expect(selections.filter(Boolean)).toHaveLength(2);
    expect(service.selectParticipant(poll, 'voter-1')).toBe(selections[0]);
  });

  test('supports independent per-ballot padding rather than selecting permanent participants', () => {
    const draws = [0, 9999];
    const service = new BallotPaddingService({
      randomInt: () => draws.shift()
    });
    const poll = makePoll({
      paddingRatePercent: 50,
      selectionStrategy: 'per-ballot',
      timingDistribution: 'immediate',
      timingWindowSeconds: 0,
      dummyTransactionsPerBallot: 1,
      electionPopulation: 1
    });

    expect(service.selectParticipant(poll, 'voter-1')).toBe(true);
    expect(service.selectParticipant(poll, 'voter-1')).toBe(false);
    expect(poll.paddingParticipants).toHaveLength(1);
  });

  test('rejects padded elections that would exceed the private receipt ledger cap', () => {
    const service = new BallotPaddingService();
    const poll = makePoll({
      paddingRatePercent: 100,
      selectionStrategy: 'population-sample',
      timingDistribution: 'immediate',
      timingWindowSeconds: 0,
      dummyTransactionsPerBallot: 2,
      electionPopulation: 10
    });
    poll.paddingLedger = Array(4997).fill({});

    expect(() => service.assertLedgerCapacity(poll, true)).not.toThrow();
    poll.paddingLedger.push({});
    expect(() => service.assertLedgerCapacity(poll, true)).toThrow(/limit \(5000\)/);
  });

  test('submits indistinguishable padding receipts using each configured timing distribution', async () => {
    const receipts = [];
    const waits = [];
    const service = new BallotPaddingService({
      random: () => 0.5,
      wait: async (duration) => waits.push(duration),
      anchorDummyReceipt: async ({ pollId }) => {
        const receipt = {
          transactionHash: `tx-${receipts.length + 1}`,
          blockNumber: receipts.length + 1,
          timestamp: new Date().toISOString(),
          gasUsed: '55000',
          calldataBytes: 132,
          from: '0xobserver-visible'
        };
        receipts.push({ pollId, ...receipt });
        return receipt;
      }
    });

    for (const timingDistribution of ['immediate', 'fixed', 'uniform', 'exponential']) {
      const poll = makePoll({
        paddingRatePercent: 100,
        selectionStrategy: 'population-sample',
        timingDistribution,
        timingWindowSeconds: 1,
        dummyTransactionsPerBallot: 2,
        electionPopulation: 1
      });
      const result = await service.submitPadding({
        poll,
        voterId: 'voter-1',
        walletPrivateKey: 'test-only',
        participantSelected: true
      });
      expect(result.submitted).toBe(2);
      expect(poll.paddingLedger).toHaveLength(2);
      expect(poll.paddingLedger[0].label).toBe('padding');
    }
    expect(receipts).toHaveLength(8);
    expect(waits.every((duration) => duration >= 0)).toBe(true);
  });
});

describe('observer prediction accuracy', () => {
  test('padding can lower repeated-submitter heuristic accuracy against sensitive activity', () => {
    const baseline = calculateAccuracy({
      publicRecords: [
        { transactionHash: 'a1', timestamp: '2026-01-01T00:00:00Z', submitter: 'wallet-a' },
        { transactionHash: 'a2', timestamp: '2026-01-01T00:00:01Z', submitter: 'wallet-a' },
        { transactionHash: 'b1', timestamp: '2026-01-01T00:00:10Z', submitter: 'wallet-b' }
      ],
      privateLabels: [
        { transactionHash: 'a1', sensitiveActivity: true },
        { transactionHash: 'a2', sensitiveActivity: true },
        { transactionHash: 'b1', sensitiveActivity: false }
      ]
    });
    const padded = calculateAccuracy({
      publicRecords: [
        { transactionHash: 'a1', timestamp: '2026-01-01T00:00:00Z', submitter: 'wallet-a' },
        { transactionHash: 'a2', timestamp: '2026-01-01T00:00:01Z', submitter: 'wallet-a' },
        { transactionHash: 'b1', timestamp: '2026-01-01T00:00:10Z', submitter: 'wallet-b' },
        { transactionHash: 'd1', timestamp: '2026-01-01T00:00:11Z', submitter: 'wallet-b' },
        { transactionHash: 'd2', timestamp: '2026-01-01T00:00:12Z', submitter: 'wallet-a' },
        { transactionHash: 'd3', timestamp: '2026-01-01T00:00:13Z', submitter: 'wallet-b' }
      ],
      privateLabels: [
        { transactionHash: 'a1', sensitiveActivity: true },
        { transactionHash: 'a2', sensitiveActivity: true },
        { transactionHash: 'b1', sensitiveActivity: false },
        { transactionHash: 'd1', sensitiveActivity: false },
        { transactionHash: 'd2', sensitiveActivity: false },
        { transactionHash: 'd3', sensitiveActivity: false }
      ]
    });

    expect(padded.accuracy).toBeLessThan(baseline.accuracy);
    expect(padded.precision).toBeDefined();
    expect(padded.recall).toBeDefined();
    expect(padded.f1).toBeDefined();
    expect(padded.rocAuc).toBeDefined();
    expect(padded.confusionMatrix.falsePositive).toBeGreaterThanOrEqual(0);
  });

  test('reports lower per-target accuracy for revoting, panic activity, and cleansing after padding', () => {
    const createDataset = (includePadding) => {
      const activities = [
        { prefix: 'r', submitter: 'wallet-revote', activity: 'revote' },
        { prefix: 'p', submitter: 'wallet-panic', activity: 'panic' },
        { prefix: 'c', submitter: 'wallet-control', activity: 'genuine' }
      ];
      const records = [];
      const labels = [];

      for (const { prefix, submitter, activity } of activities) {
        const count = activity === 'genuine' ? 1 : 2;
        for (let index = 0; index < count; index += 1) {
          const transactionHash = `${prefix}${index}`;
          records.push({
            transactionHash,
            timestamp: `2026-01-01T00:00:0${records.length}Z`,
            submitter
          });
          labels.push({
            transactionHash,
            activity,
            sensitiveActivity: activity !== 'genuine',
            revote: activity === 'revote',
            panic: activity === 'panic',
            excludedDuringCleansing: activity === 'panic'
          });
        }
      }

      if (includePadding) {
        for (let index = 0; index < 4; index += 1) {
          const transactionHash = `d${index}`;
          records.push({
            transactionHash,
            timestamp: `2026-01-01T00:00:0${records.length}Z`,
            submitter: 'wallet-padding'
          });
          labels.push({
            transactionHash,
            activity: 'padding',
            sensitiveActivity: false,
            revote: false,
            panic: false,
            excludedDuringCleansing: false
          });
        }
      }

      return { publicRecords: records, privateLabels: labels };
    };

    const baseline = calculateAccuracy(createDataset(false));
    const padded = calculateAccuracy(createDataset(true));

    for (const target of ['revote', 'panic', 'excludedDuringCleansing']) {
      expect(padded.accuracyByTarget[target].accuracy)
        .toBeLessThan(baseline.accuracyByTarget[target].accuracy);
    }
  });
});
