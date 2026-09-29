const TallyCoordinator = require('./TallyCoordinator');

class SingleTrusteeTallyCoordinator extends TallyCoordinator {
  constructor() {
    super();
    this.trustees = new Map();
    this.shares = new Map();
  }

  registerTrustee({ trusteeId, publicKey }) {
    if (!trusteeId || !publicKey) throw new Error('trusteeId and publicKey are required');
    this.trustees.set(trusteeId, { trusteeId, publicKey });
    return this.trustees.get(trusteeId);
  }

  submitShare({ electionId, trusteeId, share }) {
    if (!electionId || !trusteeId || !share) {
      throw new Error('electionId, trusteeId, and share are required');
    }
    if (!this.trustees.has(trusteeId)) throw new Error('Unknown trustee');
    const electionShares = this.shares.get(electionId) || new Map();
    electionShares.set(trusteeId, share);
    this.shares.set(electionId, electionShares);
    return { electionId, acceptedShares: electionShares.size, threshold: 1 };
  }

  canFinalize({ electionId }) {
    const shares = this.shares.get(electionId);
    return Boolean(shares && shares.size >= 1);
  }

  finalizeTally({ electionId, publicBallotCount }) {
    if (!this.canFinalize({ electionId })) throw new Error('Trustee share is required');
    return {
      electionId,
      finalized: true,
      publicBallotCount,
      acceptedShares: this.shares.get(electionId).size,
      coordinator: 'single-trustee-research'
    };
  }
}

module.exports = SingleTrusteeTallyCoordinator;
