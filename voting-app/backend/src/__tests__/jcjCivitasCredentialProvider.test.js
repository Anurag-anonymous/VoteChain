const JcjCivitasCredentialProvider = require('../services/credentials/JcjCivitasCredentialProvider');

describe('JCJ/Civitas credential provider', () => {
  test('issues and verifies a non-linkable knowledge proof', () => {
    const provider = new JcjCivitasCredentialProvider({ issuerSecret: 'test-jcj-secret' });
    const credential = provider.issueCredential({ subjectId: 'voter-1', electionId: 'election-1' });
    const proof = provider.proveEligibility({ credential, electionId: 'election-1', sequence: 1 });

    expect(credential.provider).toBe('jcj-civitas-v1');
    expect(proof.provider).toBe('jcj-civitas-v1');
    expect(provider.verifyEligibilityProof({ proof, electionId: 'election-1' })).toBe(true);
    expect(provider.verifyEligibilityProof({
      proof: { ...proof, response: proof.response.replace(/^0/, '1') },
      electionId: 'election-1'
    })).toBe(false);
  });

  test('supports fake credentials and private cleansing by commitment', () => {
    const provider = new JcjCivitasCredentialProvider({ issuerSecret: 'test-jcj-secret' });
    const genuine = provider.issueCredential({ subjectId: 'voter-1', electionId: 'election-1', credentialType: 'genuine' });
    const fake = provider.issueCredential({ subjectId: 'coercer-visible', electionId: 'election-1', credentialType: 'panic' });
    const genuineProof = provider.proveEligibility({ credential: genuine, electionId: 'election-1' });
    const fakeProof = provider.proveEligibility({ credential: fake, electionId: 'election-1' });

    expect(provider.verifyEligibilityProof({ proof: genuineProof, electionId: 'election-1' })).toBe(true);
    expect(provider.verifyEligibilityProof({ proof: fakeProof, electionId: 'election-1' })).toBe(true);
    expect(genuine.credentialCommitment).not.toBe(fake.credentialCommitment);
    expect(genuineProof.credentialCommitment).not.toBe(fakeProof.credentialCommitment);
  });

  test('rejects wrong election and revoked credentials', () => {
    const provider = new JcjCivitasCredentialProvider({ issuerSecret: 'test-jcj-secret' });
    const credential = provider.issueCredential({ subjectId: 'voter-1', electionId: 'election-1' });
    expect(() => provider.proveEligibility({ credential, electionId: 'election-2' })).toThrow();
    provider.revoke({ credentialId: credential.credentialId });
    expect(() => provider.proveEligibility({ credential, electionId: 'election-1' })).toThrow();
  });
});
