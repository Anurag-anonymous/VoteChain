const crypto = require('crypto');
const EligibilityAuthority = require('../services/eligibility-authority/EligibilityAuthority');
const ElectionCredentialProvider = require('../services/credentials/ElectionCredentialProvider');
const PrivateCredentialRegistry = require('../services/credentials/PrivateCredentialRegistry');

const makeMemoryModel = () => {
  const records = [];
  return {
    records,
    async create(record) {
      const duplicate = records.some((item) => (
        item.electionId === record.electionId && item.voterId === record.voterId
      ));
      if (duplicate) {
        const error = new Error('duplicate key');
        error.code = 11000;
        throw error;
      }
      records.push(record);
      return record;
    },
    async updateOne(filter, update) {
      const record = records.find((item) => (
        item.electionId === filter.electionId && item.voterId === filter.voterId
      ));
      if (record) {
        Object.assign(record, update.$set);
      }
    },
    findOne(filter) {
      return {
        select: async () => records.find((record) => (
          record.electionId === filter.electionId && record.voterId === filter.voterId
        )) || null
      };
    },
    find(filter) {
      return {
        select: async () => records.filter((record) => (
          !filter.electionId || record.electionId === filter.electionId
        ))
      };
    }
  };
};

const registerEligibleVoter = (authority, voterId, electionId) => {
  authority.registerVoter({ voterId, identityRef: `identity:${voterId}`, electionId });
  authority.verifyEligibility({ voterId, electionId });
};

describe('PrivateCredentialRegistry', () => {
  test('requires a persistent-format key before using C2/C3', () => {
    const registry = new PrivateCredentialRegistry({
      model: makeMemoryModel(),
      databaseReady: () => true,
      encryptionKey: 'replace-with-64-hex-characters'
    });

    expect(() => registry.assertReady()).toThrow(/32-byte hex key/);
  });

  test('persists both credential modes encrypted and recovers them after restart', async () => {
    const model = makeMemoryModel();
    const encryptionKey = crypto.randomBytes(32).toString('hex');
    const electionId = 'c2-election';
    const voterId = 'voter-1';
    const firstAuthority = new EligibilityAuthority();
    const credentialProvider = new ElectionCredentialProvider({ issuerSecret: 'test-issuer-key' });
    registerEligibleVoter(firstAuthority, voterId, electionId);

    const firstRegistry = new PrivateCredentialRegistry({
      model,
      databaseReady: () => true,
      encryptionKey
    });
    const firstCredential = await firstRegistry.issueOrLoadCredential({
      voterId,
      electionId,
      credentialProvider,
      eligibilityAuthority: firstAuthority,
      credentialType: 'panic',
      requirePersistence: true
    });

    expect(model.records).toHaveLength(1);
    expect(model.records[0]).not.toHaveProperty('credentialType');
    expect(model.records[0].encryptedCredential).not.toContain(firstCredential.credentialValue);
    expect(model.records[0].encryptedCredential).not.toContain('panic');

    const firstGenuineCredential = await firstRegistry.issueOrLoadCredential({
      voterId,
      electionId,
      credentialProvider,
      eligibilityAuthority: firstAuthority,
      credentialType: 'genuine',
      requirePersistence: true
    });
    expect(firstGenuineCredential.credentialCommitment).not.toBe(firstCredential.credentialCommitment);

    const restartedAuthority = new EligibilityAuthority();
    registerEligibleVoter(restartedAuthority, voterId, electionId);
    const restartedRegistry = new PrivateCredentialRegistry({
      model,
      databaseReady: () => true,
      encryptionKey
    });
    const recoveredCredential = await restartedRegistry.issueOrLoadCredential({
      voterId,
      electionId,
      credentialProvider,
      eligibilityAuthority: restartedAuthority,
      credentialType: 'panic',
      requirePersistence: true
    });

    expect(recoveredCredential).toEqual(firstCredential);
    await expect(restartedRegistry.getPanicCredentialCommitments({
      electionId,
      eligibilityAuthority: restartedAuthority
    })).resolves.toEqual([firstCredential.credentialCommitment]);

    await expect(restartedRegistry.issueOrLoadCredential({
      voterId,
      electionId,
      credentialProvider,
      eligibilityAuthority: restartedAuthority,
      credentialType: 'genuine',
      requirePersistence: true
    })).resolves.toEqual(firstGenuineCredential);
  });

  test('fails closed when C2 cannot persist its private credential mapping', async () => {
    const authority = new EligibilityAuthority();
    registerEligibleVoter(authority, 'voter-2', 'c2-election');
    const registry = new PrivateCredentialRegistry({
      model: makeMemoryModel(),
      databaseReady: () => false,
      encryptionKey: crypto.randomBytes(32).toString('hex')
    });

    await expect(registry.issueOrLoadCredential({
      voterId: 'voter-2',
      electionId: 'c2-election',
      credentialProvider: new ElectionCredentialProvider({ issuerSecret: 'test-issuer-key' }),
      eligibilityAuthority: authority,
      randomizeCredentialType: true,
      requirePersistence: true
    })).rejects.toThrow(/requires the database/);
  });
});
