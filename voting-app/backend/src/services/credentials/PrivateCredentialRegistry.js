const crypto = require('crypto');
const mongoose = require('mongoose');
const PrivateCredentialRecord = require('../../models/PrivateCredentialRecord');

class PrivateCredentialRegistry {
  constructor({
    model = PrivateCredentialRecord,
    databaseReady = () => mongoose.connection.readyState === 1,
    encryptionKey = process.env.C2_REGISTRY_ENCRYPTION_KEY
  } = {}) {
    this.model = model;
    this.databaseReady = databaseReady;
    this.encryptionKey = encryptionKey;
  }

  getEncryptionKey() {
    if (typeof this.encryptionKey !== 'string' || !/^[0-9a-f]{64}$/i.test(this.encryptionKey)) {
      throw new Error('C2_REGISTRY_ENCRYPTION_KEY must be a stable 32-byte hex key before using C2/C3. For local Windows setup, run .\\scripts\\ensure-c2-registry-key.ps1 from the repository root, then restart the backend.');
    }
    return Buffer.from(this.encryptionKey, 'hex');
  }

  assertReady() {
    if (!this.databaseReady()) {
      throw new Error('C2/C3 requires a connected database for its private credential registry');
    }
    this.getEncryptionKey();
  }

  encryptCredential(credential) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.getEncryptionKey(), iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(credential), 'utf8'),
      cipher.final()
    ]);
    return [
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      ciphertext.toString('base64')
    ].join('.');
  }

  decryptCredential(encryptedCredential) {
    const [ivValue, authTagValue, ciphertextValue] = encryptedCredential.split('.');
    if (!ivValue || !authTagValue || !ciphertextValue) {
      throw new Error('Private credential registry record is malformed');
    }

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.getEncryptionKey(),
      Buffer.from(ivValue, 'base64')
    );
    decipher.setAuthTag(Buffer.from(authTagValue, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64')),
      decipher.final()
    ]).toString('utf8');
    return JSON.parse(plaintext);
  }

  async findRecord(electionId, voterId) {
    return this.model.findOne({ electionId, voterId }).select('+encryptedCredential');
  }

  decryptCredentialSet(encryptedCredential) {
    const storedValue = this.decryptCredential(encryptedCredential);
    if (storedValue && storedValue.credentials) {
      return storedValue.credentials;
    }
    if (storedValue && storedValue.credentialType) {
      return { [storedValue.credentialType]: storedValue };
    }
    throw new Error('Private credential registry record is malformed');
  }

  createCredentialSet({ voterId, electionId, credentialProvider }) {
    return {
      genuine: credentialProvider.issueCredential({
        subjectId: voterId,
        electionId,
        credentialType: 'genuine'
      }),
      panic: credentialProvider.issueCredential({
        subjectId: voterId,
        electionId,
        credentialType: 'panic'
      })
    };
  }

  async storeCredentialSet(record, credentials, electionId, voterId) {
    const encryptedCredential = this.encryptCredential({ credentials });
    const update = {
      encryptedCredential,
      credentialCommitment: credentials.genuine.credentialCommitment
    };
    if (typeof this.model.updateOne === 'function') {
      await this.model.updateOne({ electionId, voterId }, { $set: update });
    } else {
      Object.assign(record, update);
    }
  }

  async issueOrLoadCredential({
    voterId,
    electionId,
    credentialProvider,
    eligibilityAuthority,
    credentialType = 'genuine',
    randomizeCredentialType = false,
    requirePersistence = false
  }) {
    const requestedType = typeof credentialType === 'string'
      ? credentialType.trim().toLowerCase()
      : '';
    const selectedType = requestedType === 'panic' || requestedType === 'decoy'
      ? 'panic'
      : requestedType === 'genuine' || requestedType === 'real' || (!requestedType && !randomizeCredentialType)
        ? 'genuine'
        : '';
    if (!selectedType) {
      throw new Error('credentialType must be genuine or panic');
    }

    if (!this.databaseReady()) {
      if (requirePersistence) {
        throw new Error('C2/C3 requires the database so private credential labels survive backend restarts');
      }
      return eligibilityAuthority.issueCredential({
        voterId,
        electionId,
        credentialProvider,
        credentialType: selectedType,
        randomizeCredentialType: false
      });
    }

    const existing = await this.findRecord(electionId, voterId);
    if (existing) {
      const credentials = this.decryptCredentialSet(existing.encryptedCredential);
      const primaryCredential = credentials.genuine || credentials.panic;
      if (
        !primaryCredential ||
        primaryCredential.electionId !== electionId ||
        primaryCredential.credentialCommitment !== existing.credentialCommitment
      ) {
        throw new Error('Private credential registry record failed integrity validation');
      }
      if (credentials.genuine && credentials.panic) {
        for (const [type, credential] of Object.entries(credentials)) {
          if (
            credential.electionId !== electionId ||
            credential.credentialType !== type
          ) {
            throw new Error('Private credential registry record failed integrity validation');
          }
        }
      } else {
        const missingCredentials = this.createCredentialSet({
          voterId,
          electionId,
          credentialProvider
        });
        if (!credentials.genuine) {
          credentials.genuine = missingCredentials.genuine;
        }
        if (!credentials.panic) {
          credentials.panic = missingCredentials.panic;
        }
        await this.storeCredentialSet(existing, credentials, electionId, voterId);
      }
      return credentials[selectedType];
    }

    const credentials = this.createCredentialSet({
      voterId,
      electionId,
      credentialProvider
    });
    const record = {
      electionId,
      voterId,
      credentialCommitment: credentials.genuine.credentialCommitment,
      encryptedCredential: this.encryptCredential({ credentials }),
      issuedAt: credentials.genuine.issuedAt
    };

    try {
      await this.model.create(record);
      return credentials[selectedType];
    } catch (error) {
      if (error.code !== 11000) {
        throw error;
      }

      const winningRecord = await this.findRecord(electionId, voterId);
      if (!winningRecord) {
        throw error;
      }
      const winningCredentials = this.decryptCredentialSet(winningRecord.encryptedCredential);
      if (!winningCredentials[selectedType]) {
        throw new Error('Concurrent private credential issuance did not store the requested credential');
      }
      return winningCredentials[selectedType];
    }
  }

  async getPanicCredentialCommitments({ electionId, eligibilityAuthority } = {}) {
    if (!this.databaseReady()) {
      return eligibilityAuthority.getPanicCredentialCommitments({ electionId });
    }

    const query = electionId ? { electionId } : {};
    const records = await this.model.find(query).select('+encryptedCredential');
    return records.reduce((commitments, record) => {
      const credentials = this.decryptCredentialSet(record.encryptedCredential);
      if (credentials.panic) {
        commitments.push(credentials.panic.credentialCommitment);
      } else if (credentials.credentialType === 'panic') {
        commitments.push(credentials.credentialCommitment);
      }
      return commitments;
    }, []);
  }
}

module.exports = PrivateCredentialRegistry;
