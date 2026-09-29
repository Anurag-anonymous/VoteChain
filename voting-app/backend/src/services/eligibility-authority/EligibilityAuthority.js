const crypto = require('crypto');

class EligibilityAuthority {
  constructor({ store } = {}) {
    this.store = store || new Map();
  }

  registerVoter({ voterId, identityRef, electionId }) {
    if (!voterId || !identityRef || !electionId) {
      throw new Error('voterId, identityRef, and electionId are required');
    }

    const key = this.getRecordKey(voterId, electionId);

    // If a record already exists for this voter+election, keep it (idempotent)
    const existing = this.store.get(key);
    if (existing) {
      return { ...existing };
    }

    const record = {
      voterId,
      identityRef,
      electionId,
      eligible: false,
      credentialIssued: false,
      credentialId: null,
      credentialType: null,
      credentialValue: null,
      credentialCommitment: null,
      isPanicCredential: false,
      revoked: false,
      createdAt: new Date().toISOString()
    };

    this.store.set(key, record);
    return { ...record };
  }

  verifyEligibility({ voterId, electionId, eligible = true }) {
    const record = this.requireRecord(voterId, electionId);
    record.eligible = !!eligible;
    record.verifiedAt = new Date().toISOString();
    this.store.set(this.getRecordKey(voterId, electionId), record);
    return { ...record };
  }

  issueCredential({ voterId, electionId, credentialProvider, credentialType, randomizeCredentialType = true, forceRefresh = false }) {
    const record = this.requireRecord(voterId, electionId);

    if (!record.eligible || record.revoked) {
      throw new Error('Cannot issue credential for an ineligible or revoked voter');
    }

    if (record.credentialIssued && !forceRefresh && record.credentialId && record.credentialCommitment) {
      return {
        credentialId: record.credentialId,
        credentialValue: record.credentialValue,
        credentialCommitment: record.credentialCommitment,
        electionId,
        credentialType: record.credentialType,
        issuedAt: record.issuedAt,
        provider: 'election-hmac'
      };
    }

    if (typeof credentialType === 'string') {
      const normalizedCredentialType = credentialType.trim().toLowerCase();
      if (normalizedCredentialType === 'panic' || normalizedCredentialType === 'decoy') {
        credentialType = 'panic';
      } else if (normalizedCredentialType === 'real' || normalizedCredentialType === 'genuine') {
        credentialType = 'genuine';
      } else {
        credentialType = undefined;
      }
    }

    const selectedType = typeof credentialType === 'string'
      ? credentialType
      : (randomizeCredentialType && crypto.randomInt(0, 2) === 0 ? 'panic' : 'genuine');

    const credential = credentialProvider.issueCredential({
      subjectId: voterId,
      electionId,
      credentialType: selectedType,
      randomizeCredentialType: false
    });

    record.credentialIssued = true;
    record.credentialId = credential.credentialId;
    record.credentialType = credential.credentialType;
    record.credentialValue = credential.credentialValue;
    record.credentialCommitment = credential.credentialCommitment;
    record.isPanicCredential = credential.credentialType === 'panic';
    record.issuedAt = new Date().toISOString();
    this.store.set(this.getRecordKey(voterId, electionId), record);

    return credential;
  }

  revokeCredential({ voterId, electionId }) {
    const record = this.requireRecord(voterId, electionId);
    record.revoked = true;
    record.revokedAt = new Date().toISOString();
    this.store.set(this.getRecordKey(voterId, electionId), record);
    return { ...record };
  }

  getCredentialStatus({ voterId, electionId, credentialCommitment }) {
    const record = this.requireRecord(voterId, electionId);
    const selectedCredentialCommitment = credentialCommitment || record.credentialCommitment;
    return {
      voterId,
      electionId,
      eligible: record.eligible,
      credentialIssued: record.credentialIssued,
      credentialId: record.credentialId,
      credentialType: record.credentialType,
      credentialCommitment: selectedCredentialCommitment,
      isPanicCredential: record.isPanicCredential,
      revoked: record.revoked
    };
  }

  isPanicCredential({ voterId, electionId, credentialCommitment }) {
    if (voterId && electionId) {
      const record = this.requireRecord(voterId, electionId);
      return !!record.isPanicCredential;
    }

    if (!credentialCommitment) {
      return false;
    }

    for (const record of this.store.values()) {
      if (record.credentialCommitment === credentialCommitment) {
        return !!record.isPanicCredential;
      }
    }

    return false;
  }

  getPanicCredentialCommitments({ electionId } = {}) {
    const matchingRecords = Array.from(this.store.values()).filter((record) => {
      if (!record.credentialCommitment) {
        return false;
      }
      if (!record.isPanicCredential) {
        return false;
      }
      return !electionId || record.electionId === electionId;
    });

    return matchingRecords
      .map((record) => record.credentialCommitment)
      .filter(Boolean)
      .filter((value, index, arr) => arr.indexOf(value) === index);
  }

  getRecordKey(voterId, electionId) {
    return crypto.createHash('sha256').update(`${electionId}:${voterId}`).digest('hex');
  }

  requireRecord(voterId, electionId) {
    const record = this.store.get(this.getRecordKey(voterId, electionId));
    if (!record) {
      throw new Error('Voter record not found for election');
    }
    return record;
  }
}

module.exports = EligibilityAuthority;
