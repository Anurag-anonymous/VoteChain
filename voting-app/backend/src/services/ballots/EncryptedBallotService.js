const crypto = require('crypto');
const BallotService = require('./BallotService');

class EncryptedBallotService extends BallotService {
  constructor({ encryptionSecret = process.env.C0_BALLOT_ENCRYPTION_SECRET } = {}) {
    super();
    if (!encryptionSecret && process.env.NODE_ENV === 'production') {
      throw new Error('C0_BALLOT_ENCRYPTION_SECRET must be configured in production');
    }
    encryptionSecret = encryptionSecret || 'development-c0-ballot-secret';
    this.key = crypto.createHash('sha256').update(encryptionSecret).digest();
    this.proofKey = crypto.createHash('sha256').update(`proof:${encryptionSecret}`).digest();
  }

  createEncryptedBallot({ electionId, candidateId, eligibilityProof }) {
    if (!electionId || !candidateId || !eligibilityProof) {
      throw new Error('electionId, candidateId, and eligibilityProof are required');
    }

    const iv = crypto.randomBytes(12);
    const plaintext = Buffer.from(JSON.stringify({
      electionId,
      candidateId,
      issuedAt: new Date().toISOString()
    }));
    const aad = Buffer.from(`${electionId}:${eligibilityProof.nullifier}`);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const encryptedCandidate = Buffer.from(JSON.stringify({
      alg: 'AES-256-GCM',
      iv: iv.toString('base64url'),
      tag: tag.toString('base64url'),
      ciphertext: ciphertext.toString('base64url')
    })).toString('base64url');
    const ballotId = this.hash('ballot', electionId, encryptedCandidate, eligibilityProof.nullifier);

    return {
      ballotId,
      electionId,
      encryptedCandidate,
      randomnessCommitment: this.hash('iv', iv.toString('base64url'), tag.toString('base64url')),
      eligibilityProof,
      proof: this.generateBallotProof({ electionId, encryptedCandidate, eligibilityProof }),
      provider: 'aes-256-gcm'
    };
  }

  generateBallotProof({ electionId, encryptedCandidate, eligibilityProof }) {
    if (!electionId || !encryptedCandidate || !eligibilityProof) {
      throw new Error('Cannot generate ballot proof without ballot metadata');
    }

    return {
      proofType: 'aes-gcm-integrity-hmac',
      proof: crypto
        .createHmac('sha256', this.proofKey)
        .update(`${electionId}:${encryptedCandidate}:${eligibilityProof.nullifier}`)
        .digest('hex')
    };
  }

  verifyBallot({ ballot, credentialProvider }) {
    if (!ballot || !ballot.electionId || !ballot.encryptedCandidate || !ballot.eligibilityProof || !ballot.proof) {
      return false;
    }

    const expectedProof = this.generateBallotProof({
      electionId: ballot.electionId,
      encryptedCandidate: ballot.encryptedCandidate,
      eligibilityProof: ballot.eligibilityProof
    });

    const expectedProofBuffer = Buffer.from(expectedProof.proof, 'hex');
    const actualProofBuffer = Buffer.from(ballot.proof.proof || '', 'hex');

    if (expectedProofBuffer.length !== actualProofBuffer.length) {
      return false;
    }

    const proofMatches = crypto.timingSafeEqual(expectedProofBuffer, actualProofBuffer);

    if (!proofMatches) {
      return false;
    }

    if (credentialProvider) {
      return credentialProvider.verifyEligibilityProof({
        proof: ballot.eligibilityProof,
        electionId: ballot.electionId
      });
    }

    return true;
  }

  decryptBallot(ballot) {
    const payload = JSON.parse(Buffer.from(ballot.encryptedCandidate, 'base64url').toString('utf8'));
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(payload.iv, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'));
    decipher.setAAD(Buffer.from(`${ballot.electionId}:${ballot.eligibilityProof.nullifier}`));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, 'base64url')),
      decipher.final()
    ]);
    return JSON.parse(plaintext.toString('utf8'));
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

module.exports = EncryptedBallotService;
