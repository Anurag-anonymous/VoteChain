const crypto = require('crypto');
const CredentialProvider = require('./CredentialProvider');

// RFC 3526 group 14. The subgroup order is q=(p-1)/2 and g=2.
const P = BigInt(`0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1
                   29024E088A67CC74020BBEA63B139B22514A08798E3404DD
                   EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245
                   E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED
                   EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC
                   2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655
                   D23DCA3AD961C62F356208552BB9ED529077096966D670C354E
                   4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E
                   86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF695581718
                   3995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFF
                   FFFFFFFF`.replace(/\s+/g, ''));
const Q = (P - 1n) / 2n;
const G = 2n;

const modPow = (base, exponent, modulus) => {
  let result = 1n;
  let value = base % modulus;
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = (result * value) % modulus;
    value = (value * value) % modulus;
    power >>= 1n;
  }
  return result;
};

const hashToScalar = (...parts) => {
  const digest = crypto.createHash('sha256')
    .update(parts.map((part) => String(part)).join(':'))
    .digest('hex');
  return BigInt(`0x${digest}`) % Q;
};

const encode = (value) => value.toString(16).padStart(512, '0');
const decode = (value) => {
  if (typeof value !== 'string' || !/^[a-f\d]+$/i.test(value)) {
    throw new Error('Invalid JCJ group element');
  }
  return BigInt(`0x${value}`);
};

class JcjCivitasCredentialProvider extends CredentialProvider {
  constructor({ issuerSecret = process.env.C0_CREDENTIAL_ISSUER_SECRET } = {}) {
    super();
    if (!issuerSecret && process.env.NODE_ENV === 'production') {
      throw new Error('C0_CREDENTIAL_ISSUER_SECRET must be configured in production');
    }
    this.issuerSecret = issuerSecret || 'development-jcj-issuer-secret';
    this.revokedCredentials = new Set();
  }

  issueCredential({ subjectId, electionId, credentialType = 'genuine' } = {}) {
    if (!subjectId || !electionId) throw new Error('subjectId and electionId are required');
    const x = hashToScalar('credential', this.issuerSecret, subjectId, electionId, crypto.randomBytes(32).toString('hex')) || 1n;
    const commitment = modPow(G, x, P);
    const credentialCommitment = encode(commitment);
    const credentialId = crypto.createHmac('sha256', this.issuerSecret)
      .update(`jcj:${electionId}:${credentialCommitment}`)
      .digest('hex');
    return {
      provider: 'jcj-civitas-v1',
      credentialId,
      credentialValue: encode(x),
      credentialCommitment,
      electionId,
      credentialType: credentialType === 'panic' ? 'panic' : 'genuine',
      issuedAt: new Date().toISOString()
    };
  }

  deriveElectionScopedIdentifier({ credential, electionId, scope = 'vote' }) {
    if (!credential || credential.electionId !== electionId) {
      throw new Error('Credential is not valid for this election');
    }
    const x = decode(credential.credentialValue);
    return crypto.createHash('sha256')
      .update(`jcj-nullifier:${electionId}:${scope}:${encode(x)}`)
      .digest('hex');
  }

  proveEligibility({ credential, electionId, scope = 'vote', sequence = 1 } = {}) {
    if (!credential || credential.electionId !== electionId) {
      throw new Error('Credential is not valid for this election');
    }
    if (this.revokedCredentials.has(credential.credentialId)) {
      throw new Error('Credential has been revoked');
    }
    const x = decode(credential.credentialValue);
    const commitment = decode(credential.credentialCommitment);
    const nonce = hashToScalar('nonce', crypto.randomBytes(32).toString('hex')) || 1n;
    const announcement = modPow(G, nonce, P);
    const nullifier = this.deriveElectionScopedIdentifier({ credential, electionId, scope });
    const challenge = hashToScalar('proof', electionId, scope, sequence, encode(commitment), encode(announcement), nullifier);
    const response = (nonce + (challenge * x)) % Q;
    return {
      provider: 'jcj-civitas-v1',
      scheme: 'schnorr-fiat-shamir',
      electionId,
      scope,
      sequence,
      credentialCommitment: encode(commitment),
      nullifier,
      announcement: encode(announcement),
      response: encode(response),
      proof: encode(challenge)
    };
  }

  verifyEligibilityProof({ proof, electionId }) {
    try {
      if (!proof || proof.provider !== 'jcj-civitas-v1' || proof.electionId !== electionId ||
          !proof.credentialCommitment || !proof.announcement || !proof.response ||
          !proof.nullifier || !proof.proof) return false;
      const commitment = decode(proof.credentialCommitment);
      const announcement = decode(proof.announcement);
      const response = decode(proof.response);
      const challenge = decode(proof.proof);
      if ([commitment, announcement, response].some((value) => value <= 1n || value >= P) ||
          challenge >= Q || response >= Q) return false;
      const expectedChallenge = hashToScalar(
        'proof', electionId, proof.scope || 'vote', proof.sequence || 1,
        encode(commitment), encode(announcement), proof.nullifier
      );
      if (expectedChallenge !== challenge) return false;
      return modPow(G, response, P) === (
        (announcement * modPow(commitment, challenge, P)) % P
      );
    } catch {
      return false;
    }
  }

  revoke({ credentialId }) {
    if (!credentialId) throw new Error('credentialId is required');
    this.revokedCredentials.add(credentialId);
  }
}

module.exports = JcjCivitasCredentialProvider;
