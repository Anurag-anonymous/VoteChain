const crypto = require('crypto');
const CredentialProvider = require('./CredentialProvider');

class MockCredentialProvider extends CredentialProvider {
  constructor({
    issuerSecret = 'mock-credential-provider-do-not-use-in-production',
    deterministicCredentialIds = false
  } = {}) {
    super();
    this.issuerSecret = issuerSecret;
    this.deterministicCredentialIds = deterministicCredentialIds;
    this.revokedCredentials = new Set();
  }

  issueCredential({ subjectId, electionId, credentialType = 'genuine' }) {
    if (!subjectId || !electionId) {
      throw new Error('subjectId and electionId are required');
    }

    const credentialId = this.deterministicCredentialIds
      ? this.hash('credential', electionId, subjectId)
      : this.hash('credential', electionId, subjectId, crypto.randomUUID());
    return {
      credentialId,
      electionId,
      credentialType,
      issuedAt: new Date().toISOString(),
      provider: 'mock',
      securityNotice: 'Mock credential only. Not anonymous and not production secure.'
    };
  }

  proveEligibility({ credential, electionId, scope = 'vote' }) {
    if (!credential || credential.electionId !== electionId) {
      throw new Error('Credential is not valid for this election');
    }

    if (this.revokedCredentials.has(credential.credentialId)) {
      throw new Error('Credential has been revoked');
    }

    const nullifier = this.deriveElectionScopedIdentifier({ credential, electionId, scope });
    const proof = this.hash('proof', credential.credentialId, electionId, scope, nullifier);

    return {
      electionId,
      nullifier,
      proof,
      provider: 'mock',
      securityNotice: 'Mock proof only. Replace with an established anonymous credential proof.'
    };
  }

  verifyEligibilityProof({ proof, electionId }) {
    return !!proof && proof.electionId === electionId && !!proof.nullifier && !!proof.proof;
  }

  deriveElectionScopedIdentifier({ credential, electionId, scope = 'vote' }) {
    if (!credential || credential.electionId !== electionId) {
      throw new Error('Credential is not valid for this election');
    }

    return this.hash('nullifier', credential.credentialId, electionId, scope);
  }

  revoke({ credentialId }) {
    if (!credentialId) {
      throw new Error('credentialId is required');
    }
    this.revokedCredentials.add(credentialId);
  }

  hash(...parts) {
    return crypto
      .createHmac('sha256', this.issuerSecret)
      .update(parts.join(':'))
      .digest('hex');
  }
}

module.exports = MockCredentialProvider;
