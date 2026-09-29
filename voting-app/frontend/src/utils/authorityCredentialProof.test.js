import createAuthorityCredentialProof from './authorityCredentialProof';
const { webcrypto } = require('crypto');
const { TextEncoder } = require('util');

const {
  createCommitment,
  verifyEligibilityProof
} = require('../../../backend/src/services/credentials/authorityCredentialProof');

beforeAll(() => {
  global.TextEncoder = TextEncoder;
  Object.defineProperty(window, 'crypto', {
    configurable: true,
    value: webcrypto
  });
});

test('browser-generated proof verifies with the backend verifier', async () => {
  const credential = '123456789abcdef'.padStart(512, '0');
  const credentialCommitment = createCommitment(credential);
  const proof = await createAuthorityCredentialProof({
    credential,
    credentialCommitment,
    electionId: 'browser-backend-proof-test'
  });

  expect(verifyEligibilityProof({
    proof,
    credentialCommitment,
    electionId: 'browser-backend-proof-test'
  })).toBe(true);
});
