const crypto = require('crypto');
const CredentialProvider = require('./CredentialProvider');

class ElectionCredentialProvider extends CredentialProvider {
  constructor({ issuerSecret = process.env.C0_CREDENTIAL_ISSUER_SECRET } = {}) {
    super();
    if (!issuerSecret && process.env.NODE_ENV === 'production') {
      throw new Error('C0_CREDENTIAL_ISSUER_SECRET must be configured in production');
    }
    this.issuerSecret = issuerSecret || 'development-c0-credential-secret';
    this.revokedCredentials = new Set();
  }

  normalizeCredentialType(credentialType) {
    if (typeof credentialType !== 'string') {
      return 'genuine';
    }
    const normalized = credentialType.trim().toLowerCase();
    if (normalized === 'panic' || normalized === 'decoy') {
      return 'panic';
    }
    return normalized === 'real' || normalized === 'genuine' ? 'genuine' : 'genuine';
  }

  deriveCredentialCommitment({ subjectId, electionId, credentialValue, credentialType = 'genuine' }) {
    return crypto
      .createHash('sha256')
      .update(`${electionId}:${subjectId}:${this.normalizeCredentialType(credentialType)}:${credentialValue || ''}`)
      .digest('hex');
  }

  issueCredential({ subjectId, electionId, credentialType = 'genuine', randomizeCredentialType = false } = {}) {
    if (!subjectId || !electionId) {
      throw new Error('subjectId and electionId are required');
    }

    const selectedType = randomizeCredentialType
      ? (crypto.randomInt(0, 2) === 0 ? 'panic' : 'genuine')
      : this.normalizeCredentialType(credentialType);
    const credentialValue = crypto.randomBytes(32).toString('hex');
    const credentialCommitment = this.deriveCredentialCommitment({
      subjectId,
      electionId,
      credentialValue,
      credentialType: selectedType
    });
    const credentialId = this.sign('credential', electionId, subjectId, credentialCommitment, selectedType);

    return {
      credentialId,
      credentialCommitment,
      electionId,
      credentialType: selectedType,
      credentialValue,
      issuedAt: new Date().toISOString(),
      provider: 'election-hmac'
    };
  }

  proveEligibility({ credential, electionId, scope = 'vote' }) {
    if (!credential || credential.electionId !== electionId) {
      throw new Error('Credential is not valid for this election');
    }

    if (this.revokedCredentials.has(credential.credentialId)) {
      throw new Error('Credential has been revoked');
    }

    const credentialCommitment = credential.credentialCommitment || this.deriveCredentialCommitment({
      subjectId: credential.subjectId || credential.credentialId,
      electionId,
      credentialValue: credential.credentialValue || credential.credentialId,
      credentialType: credential.credentialType
    });
    const nullifier = this.deriveElectionScopedIdentifier({ credential, electionId, scope });
    return {
      electionId,
      credentialId: credential.credentialId,
      scope,
      credentialCommitment,
      nullifier,
      proof: this.sign('proof', credential.credentialId, credentialCommitment, electionId, scope, nullifier),
      provider: 'election-hmac'
    };
  }

  verifyEligibilityProof({ proof, electionId }) {
    if (!proof || proof.electionId !== electionId || !proof.credentialId ||
        !proof.nullifier || !proof.proof || !proof.credentialCommitment) {
      return false;
    }

    if (this.revokedCredentials.has(proof.credentialId)) {
      return false;
    }

    const expected = this.sign(
      'proof',
      proof.credentialId,
      proof.credentialCommitment,
      electionId,
      proof.scope || 'vote',
      proof.nullifier
    );
    const expectedBuffer = Buffer.from(expected, 'hex');
    const actualBuffer = Buffer.from(proof.proof, 'hex');
    return actualBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  }

  deriveElectionScopedIdentifier({ credential, electionId, scope = 'vote' }) {
    if (!credential || credential.electionId !== electionId) {
      throw new Error('Credential is not valid for this election');
    }

    const credentialCommitment = credential.credentialCommitment || this.deriveCredentialCommitment({
      subjectId: credential.subjectId || credential.credentialId,
      electionId,
      credentialValue: credential.credentialValue || credential.credentialId,
      credentialType: credential.credentialType
    });

    return this.sign('nullifier', credentialCommitment, electionId, scope);
  }

  revoke({ credentialId }) {
    if (!credentialId) {
      throw new Error('credentialId is required');
    }
    this.revokedCredentials.add(credentialId);
  }

  sign(...parts) {
    return crypto
      .createHmac('sha256', this.issuerSecret)
      .update(parts.join(':'))
      .digest('hex');
  }
}

module.exports = ElectionCredentialProvider;
