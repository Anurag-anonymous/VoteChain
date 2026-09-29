const crypto = require('crypto');

const DISTRIBUTIONS = ['immediate', 'fixed', 'uniform', 'exponential'];
const SELECTION_STRATEGIES = ['population-sample', 'per-ballot'];
const MAX_POPULATION = 10000;
const MAX_DUMMY_TRANSACTIONS_PER_BALLOT = 20;
const MAX_TIMING_WINDOW_SECONDS = 60;
const MAX_PADDING_LEDGER_ENTRIES = 5000;

const normalizePaddingConfig = (value = {}) => {
  const {
    paddingRatePercent,
    selectionStrategy,
    timingDistribution,
    timingWindowSeconds,
    dummyTransactionsPerBallot,
    electionPopulation
  } = value;
  const config = {
    paddingRatePercent: Number(paddingRatePercent),
    selectionStrategy,
    timingDistribution,
    timingWindowSeconds: Number(timingWindowSeconds),
    dummyTransactionsPerBallot: Number(dummyTransactionsPerBallot),
    electionPopulation: Number(electionPopulation)
  };

  if (!Number.isFinite(config.paddingRatePercent) || config.paddingRatePercent < 0 || config.paddingRatePercent > 100) {
    throw new Error('paddingRatePercent must be between 0 and 100');
  }
  if (!SELECTION_STRATEGIES.includes(config.selectionStrategy)) {
    throw new Error(`selectionStrategy must be one of: ${SELECTION_STRATEGIES.join(', ')}`);
  }
  if (!DISTRIBUTIONS.includes(config.timingDistribution)) {
    throw new Error(`timingDistribution must be one of: ${DISTRIBUTIONS.join(', ')}`);
  }
  if (!Number.isInteger(config.timingWindowSeconds) || config.timingWindowSeconds < 0 || config.timingWindowSeconds > MAX_TIMING_WINDOW_SECONDS) {
    throw new Error(`timingWindowSeconds must be an integer between 0 and ${MAX_TIMING_WINDOW_SECONDS}`);
  }
  if (!Number.isInteger(config.dummyTransactionsPerBallot) || config.dummyTransactionsPerBallot < 0 || config.dummyTransactionsPerBallot > MAX_DUMMY_TRANSACTIONS_PER_BALLOT) {
    throw new Error(`dummyTransactionsPerBallot must be an integer between 0 and ${MAX_DUMMY_TRANSACTIONS_PER_BALLOT}`);
  }
  if (!Number.isInteger(config.electionPopulation) || config.electionPopulation < 1 || config.electionPopulation > MAX_POPULATION) {
    throw new Error(`electionPopulation must be an integer between 1 and ${MAX_POPULATION}`);
  }

  return config;
};

class BallotPaddingService {
  constructor({
    randomInt = crypto.randomInt,
    random = Math.random,
    wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    anchorDummyReceipt
  } = {}) {
    this.randomInt = randomInt;
    this.random = random;
    this.wait = wait;
    this.anchorDummyReceipt = anchorDummyReceipt;
  }

  selectParticipant(poll, voterId) {
    const config = poll.paddingConfig;
    if (!config || config.electionPopulation < 1) {
      throw new Error('Padding configuration is missing from this election');
    }

    poll.paddingParticipants = poll.paddingParticipants || [];
    poll.paddingParticipantSalt = poll.paddingParticipantSalt || crypto.randomBytes(32).toString('hex');
    const voterRef = crypto
      .createHmac('sha256', poll.paddingParticipantSalt)
      .update(`${poll._id.toString()}:${voterId}`)
      .digest('hex');
    const existing = poll.paddingParticipants.find((item) => item.voterRef === voterRef);
    if (existing) {
      return config.selectionStrategy === 'population-sample'
        ? existing.selected
        : this.randomInt(10000) < config.paddingRatePercent * 100;
    }

    const enrolledCount = poll.paddingParticipants.length;
    if (enrolledCount >= config.electionPopulation) {
      return false;
    }
    if (config.selectionStrategy === 'per-ballot') {
      poll.paddingParticipants.push({ voterRef, selected: false });
      return this.randomInt(10000) < config.paddingRatePercent * 100;
    }

    const selectedCount = poll.paddingParticipants.filter((item) => item.selected).length;
    const targetSelectedCount = Math.round(config.electionPopulation * config.paddingRatePercent / 100);
    const remainingPopulation = Math.max(0, config.electionPopulation - enrolledCount);
    const remainingSelections = Math.max(0, targetSelectedCount - selectedCount);
    const selected = remainingPopulation > 0 &&
      remainingSelections > 0 &&
      this.randomInt(remainingPopulation) < remainingSelections;
    poll.paddingParticipants.push({ voterRef, selected });
    return selected;
  }

  assertLedgerCapacity(poll, participantSelected) {
    const config = normalizePaddingConfig(poll.paddingConfig);
    const requiredEntries = 1 + (participantSelected ? config.dummyTransactionsPerBallot : 0);
    const currentEntries = (poll.paddingLedger || []).length;
    if (currentEntries + requiredEntries > MAX_PADDING_LEDGER_ENTRIES) {
      throw new Error(`Padding experiment receipt limit (${MAX_PADDING_LEDGER_ENTRIES}) would be exceeded`);
    }
  }

  createOffsets(count, distribution, windowMs) {
    if (count <= 0) {
      return [];
    }
    if (distribution === 'immediate' || windowMs <= 0) {
      return Array(count).fill(0);
    }
    if (distribution === 'fixed') {
      return Array.from({ length: count }, (_, index) => (
        Math.round(((index + 1) / count) * windowMs)
      ));
    }
    if (distribution === 'uniform') {
      return Array.from({ length: count }, () => Math.floor(this.random() * (windowMs + 1)))
        .sort((left, right) => left - right);
    }
    if (distribution === 'exponential') {
      const intervals = Array.from({ length: count }, () => -Math.log(1 - this.random()));
      const total = intervals.reduce((sum, interval) => sum + interval, 0);
      let elapsed = 0;
      return intervals.map((interval) => {
        elapsed += interval;
        return Math.round((elapsed / total) * windowMs);
      });
    }
    throw new Error(`Unsupported padding timing distribution: ${distribution}`);
  }

  async submitPadding({ poll, walletPrivateKey, participantSelected }) {
    if (!participantSelected) {
      return { submitted: 0 };
    }
    if (typeof this.anchorDummyReceipt !== 'function') {
      throw new Error('Dummy receipt anchor is not configured');
    }

    const config = normalizePaddingConfig(poll.paddingConfig);
    const count = config.dummyTransactionsPerBallot;
    const offsets = this.createOffsets(
      count,
      config.timingDistribution,
      config.timingWindowSeconds * 1000
    );
    const start = Date.now();
    let submitted = 0;
    poll.paddingLedger = poll.paddingLedger || [];

    for (const offset of offsets) {
      const remainingDelay = start + offset - Date.now();
      if (remainingDelay > 0) {
        await this.wait(remainingDelay);
      }
      const receipt = await this.anchorDummyReceipt({
        pollId: poll._id.toString(),
        walletPrivateKey
      });
      poll.paddingLedger.push({
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        timestamp: receipt.timestamp,
        gasUsed: receipt.gasUsed,
        calldataBytes: receipt.calldataBytes,
        submitter: receipt.from,
        label: 'padding',
      });
      submitted += 1;
      await poll.save();
    }

    return { submitted };
  }
}

module.exports = {
  BallotPaddingService,
  normalizePaddingConfig,
  DISTRIBUTIONS,
  SELECTION_STRATEGIES,
  MAX_PADDING_LEDGER_ENTRIES
};
