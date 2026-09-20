class BallotService {
  createEncryptedBallot() {
    throw new Error('createEncryptedBallot must be implemented by a ballot service');
  }

  generateBallotProof() {
    throw new Error('generateBallotProof must be implemented by a ballot service');
  }

  verifyBallot() {
    throw new Error('verifyBallot must be implemented by a ballot service');
  }

  serializeBallot() {
    throw new Error('serializeBallot must be implemented by a ballot service');
  }

  deserializeBallot() {
    throw new Error('deserializeBallot must be implemented by a ballot service');
  }
}

module.exports = BallotService;
