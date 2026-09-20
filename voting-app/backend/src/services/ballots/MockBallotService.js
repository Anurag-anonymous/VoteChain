const crypto = require('crypto');
const BallotService = require('./BallotService');

class MockBallotService extends BallotService {
  createEncryptedBallot({ electionId, candidateId, eligibilityProof }) {
    if (!electionId || !candidateId || !eligibilityProof) {
      throw new Error('electionId, candidateId, and eligibilityProof are required');
    }

    const randomness = crypto.randomBytes(32).toString('hex');
    const encryptedCandidate = this.hash('mock-ciphertext', electionId, candidateId, randomness);
    const ballotId = this.hash('ballot', electionId, encryptedCandidate, randomness);

    return {
      ballotId,
      electionId,
      encryptedCandidate,
      randomnessCommitment: this.hash('randomness', randomness),
      eligibilityProof,
      proof: this.generateBallotProof({ electionId, encryptedCandidate, eligibilityProof }),
      provider: 'mock',
      securityNotice: 'Mock ballot only. It is not encryption and is not production secure.'
    };
  }

  generateBallotProof({ electionId, encryptedCandidate, eligibilityProof }) {
    if (!electionId || !encryptedCandidate || !eligibilityProof) {
      throw new Error('Cannot generate ballot proof without ballot metadata');
    }

    return {
      proofType: 'mock-validity-proof',
      proof: this.hash('ballot-proof', electionId, encryptedCandidate, eligibilityProof.nullifier || ''),
      securityNotice: 'Mock proof only. Replace with a real validity proof.'
    };
  }

  verifyBallot({ ballot, credentialProvider }) {
    if (!ballot || !ballot.electionId || !ballot.encryptedCandidate || !ballot.eligibilityProof) {
      return false;
    }

    if (credentialProvider) {
      return credentialProvider.verifyEligibilityProof({
        proof: ballot.eligibilityProof,
        electionId: ballot.electionId
      });
    }

    return !!ballot.proof;
  }

  serializeBallot(ballot) {
    return JSON.stringify(ballot);
  }

  deserializeBallot(serializedBallot) {
    return JSON.parse(serializedBallot);
  }

  hash(...parts) {
    return crypto.createHash('sha256').update(parts.join(':')).digest('hex');
  }
}

module.exports = MockBallotService;
