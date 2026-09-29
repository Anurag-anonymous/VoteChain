const crypto = require('crypto');

class ThresholdTallyCoordinator {
  constructor({ trusteeCount = 5, threshold = 3 } = {}) {
    if (trusteeCount !== 5 || threshold !== 3) {
      throw new Error('Production tally requires a 3-of-5 trustee set');
    }
    this.trustees = new Map();
    this.shares = new Map();
  }

  registerTrustee({ trusteeId, publicKey }) {
    if (!trusteeId || !publicKey || this.trustees.size >= 5) {
      throw new Error('Exactly five trustees with public keys are required');
    }
    if (this.trustees.has(trusteeId)) {
      throw new Error('Trustee already registered');
    }
    this.trustees.set(trusteeId, { trusteeId, publicKey });
    return { trusteeId };
  }

  submitShare({ electionId, trusteeId, commitment, share, signature }) {
    if (!electionId || !trusteeId || !commitment || !share || !signature) {
      throw new Error('electionId, trusteeId, commitment, share, and signature are required');
    }
    const trustee = this.trustees.get(trusteeId);
    if (!trustee) throw new Error('Unknown trustee');
    const payload = `${electionId}:${commitment}:${share}`;
    const verified = crypto.verify(
      null,
      Buffer.from(payload),
      trustee.publicKey,
      Buffer.from(signature, 'base64')
    );
    if (!verified) throw new Error('Invalid trustee share signature');

    const electionShares = this.shares.get(electionId) || new Map();
    if (electionShares.size > 0 && electionShares.values().next().value.commitment !== commitment) {
      throw new Error('Tally commitment mismatch');
    }
    electionShares.set(trusteeId, { commitment, share });
    this.shares.set(electionId, electionShares);
    return { electionId, acceptedShares: electionShares.size, threshold: 3 };
  }

  canFinalize({ electionId }) {
    const shares = this.shares.get(electionId);
    return this.trustees.size === 5 && !!shares && shares.size >= 3;
  }

  finalizeTally({ electionId, publicBallotCount }) {
    if (!this.canFinalize({ electionId })) {
      throw new Error('A verified 3-of-5 trustee quorum is required');
    }
    return {
      electionId,
      finalized: true,
      publicBallotCount,
      acceptedShares: this.shares.get(electionId).size,
      coordinator: 'threshold-3-of-5'
    };
  }
}

module.exports = ThresholdTallyCoordinator;
