const crypto = require('crypto');
const {
  createCommitment,
  createEligibilityProof,
  verifyEligibilityProof
} = require('../services/credentials/authorityCredentialProof');

describe('authority credential zero-knowledge proof', () => {
  const credential = crypto.randomBytes(32).toString('hex').padStart(512, '0');
  const credentialCommitment = createCommitment(credential);

  test('proves credential possession with an election-scoped nullifier without including the secret', () => {
    const proof = createEligibilityProof({
      credential,
      credentialCommitment,
      electionId: 'election-1'
    });

    expect(verifyEligibilityProof({
      proof,
      credentialCommitment,
      electionId: 'election-1'
    })).toBe(true);
    expect(proof).not.toHaveProperty('credential');
    expect(JSON.stringify(proof)).not.toContain(credential);

    const otherElectionProof = createEligibilityProof({
      credential,
      credentialCommitment,
      electionId: 'election-2'
    });
    expect(otherElectionProof.nullifier).not.toBe(proof.nullifier);
  });

  test('rejects changed proof values, wrong commitments, and cross-election replay', () => {
    const proof = createEligibilityProof({
      credential,
      credentialCommitment,
      electionId: 'election-1'
    });

    expect(verifyEligibilityProof({
      proof: { ...proof, response: '0'.repeat(512) },
      credentialCommitment,
      electionId: 'election-1'
    })).toBe(false);
    expect(verifyEligibilityProof({
      proof: { ...proof, nullifier: '0'.repeat(64) },
      credentialCommitment,
      electionId: 'election-1'
    })).toBe(false);
    expect(verifyEligibilityProof({
      proof,
      credentialCommitment: createCommitment('2'.padStart(512, '0')),
      electionId: 'election-1'
    })).toBe(false);
    expect(verifyEligibilityProof({
      proof,
      credentialCommitment,
      electionId: 'election-2'
    })).toBe(false);
  });
});
