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
    const record = {
      voterId,
      identityRef,
      electionId,
      eligible: false,
      credentialIssued: false,
      credentialId: null,
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

  issueCredential({ voterId, electionId, credentialProvider }) {
    const record = this.requireRecord(voterId, electionId);

    if (!record.eligible || record.revoked) {
      throw new Error('Cannot issue credential for an ineligible or revoked voter');
    }

    const credential = credentialProvider.issueCredential({
      subjectId: voterId,
      electionId
    });

    record.credentialIssued = true;
    record.credentialId = credential.credentialId;
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

  getCredentialStatus({ voterId, electionId }) {
    const record = this.requireRecord(voterId, electionId);
    return {
      voterId,
      electionId,
      eligible: record.eligible,
      credentialIssued: record.credentialIssued,
      credentialId: record.credentialId,
      revoked: record.revoked
    };
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
