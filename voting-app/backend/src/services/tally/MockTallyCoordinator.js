const TallyCoordinator = require('./TallyCoordinator');

class MockTallyCoordinator extends TallyCoordinator {
  constructor({ threshold = 3 } = {}) {
    super();
    this.threshold = threshold;
    this.trustees = new Map();
    this.shares = new Map();
  }

  registerTrustee({ trusteeId, publicKey }) {
    if (!trusteeId || !publicKey) {
      throw new Error('trusteeId and publicKey are required');
    }

    this.trustees.set(trusteeId, { trusteeId, publicKey });
    return this.trustees.get(trusteeId);
  }

  submitShare({ electionId, trusteeId, share }) {
    if (!electionId || !trusteeId || !share) {
      throw new Error('electionId, trusteeId, and share are required');
    }

    if (!this.trustees.has(trusteeId)) {
      throw new Error('Unknown trustee');
    }

    const electionShares = this.shares.get(electionId) || new Map();
    electionShares.set(trusteeId, share);
    this.shares.set(electionId, electionShares);

    return {
      electionId,
      trusteeId,
      acceptedShares: electionShares.size,
      threshold: this.threshold
    };
  }

  canFinalize({ electionId }) {
    const electionShares = this.shares.get(electionId);
    return !!electionShares && electionShares.size >= this.threshold;
  }

  finalizeTally({ electionId, publicBallotCount }) {
    if (!this.canFinalize({ electionId })) {
      throw new Error('Not enough trustee shares to finalize tally');
    }

    return {
      electionId,
      finalized: true,
      publicBallotCount,
      acceptedShares: this.shares.get(electionId).size,
      securityNotice: 'Mock tally only. It does not decrypt or prove tally correctness.'
    };
  }
}

module.exports = MockTallyCoordinator;
