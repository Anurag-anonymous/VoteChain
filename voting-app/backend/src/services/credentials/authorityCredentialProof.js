'use strict';

const crypto = require('crypto');

const P = BigInt(`0xFFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFFFFFFFFFF`);
const Q = (P - 1n) / 2n;
const G = 2n;
const ENCODING_WIDTH = 512;
const SCHEME = 'votechain-chaum-pedersen-v1';

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

const encode = (value) => value.toString(16).padStart(ENCODING_WIDTH, '0');

const parseGroupElement = (value) => {
  if (typeof value !== 'string' ||
      value.length !== ENCODING_WIDTH ||
      !/^[a-f\d]+$/i.test(value)) {
    throw new Error('Invalid anonymous credential proof group element');
  }
  const parsed = BigInt(`0x${value}`);
  if (parsed <= 1n || parsed >= P || modPow(parsed, Q, P) !== 1n) {
    throw new Error('Anonymous credential proof element is outside the expected subgroup');
  }
  return parsed;
};

const parseScalar = (value) => {
  if (typeof value !== 'string' ||
      value.length !== ENCODING_WIDTH ||
      !/^[a-f\d]+$/i.test(value)) {
    throw new Error('Invalid anonymous credential proof scalar');
  }
  const parsed = BigInt(`0x${value}`);
  if (parsed >= Q) throw new Error('Anonymous credential proof scalar is out of range');
  return parsed;
};

const hashScalar = (label, value) => (
  BigInt(`0x${crypto.createHash('sha256').update(`${label}\0${value}`).digest('hex')}`) % Q
);

const hashToGroup = (electionId) => {
  for (let counter = 0; counter < 256; counter += 1) {
    const digest = crypto.createHash('sha256')
      .update(`votechain-election-base-v1\0${electionId}\0${counter}`)
      .digest('hex');
    const candidate = BigInt(`0x${digest}`) % P;
    const element = (candidate * candidate) % P;
    if (element > 1n) return element;
  }
  throw new Error('Could not derive an election-specific proof base');
};

const nullifierFor = (electionId, nullifierPoint) => crypto.createHash('sha256')
  .update(`votechain-election-nullifier-v1\0${electionId}\0${encode(nullifierPoint)}`)
  .digest('hex');

const createCommitment = (credential) => {
  const secret = parseScalar(credential);
  if (secret === 0n) throw new Error('Anonymous credential secret must be nonzero');
  return encode(modPow(G, secret, P));
};

const createEligibilityProof = ({ credential, credentialCommitment, electionId }) => {
  if (typeof electionId !== 'string' || !electionId) {
    throw new Error('electionId is required for an anonymous credential proof');
  }
  const secret = parseScalar(credential);
  if (secret === 0n) throw new Error('Anonymous credential secret must be nonzero');
  const commitment = parseGroupElement(credentialCommitment);
  if (modPow(G, secret, P) !== commitment) {
    throw new Error('Anonymous credential does not match its registered commitment');
  }

  const electionBase = hashToGroup(electionId);
  const nullifierPoint = modPow(electionBase, secret, P);
  const nonce = (BigInt(`0x${crypto.randomBytes(32).toString('hex')}`) % (Q - 1n)) + 1n;
  const announcementG = modPow(G, nonce, P);
  const announcementElection = modPow(electionBase, nonce, P);
  const challenge = hashScalar(
    'votechain-chaum-pedersen-challenge-v1',
    [
      electionId,
      encode(commitment),
      encode(electionBase),
      encode(nullifierPoint),
      encode(announcementG),
      encode(announcementElection)
    ].join('\0')
  );
  const response = (nonce + challenge * secret) % Q;

  return {
    scheme: SCHEME,
    electionId,
    nullifier: nullifierFor(electionId, nullifierPoint),
    nullifierPoint: encode(nullifierPoint),
    announcementG: encode(announcementG),
    announcementElection: encode(announcementElection),
    response: encode(response)
  };
};

const verifyEligibilityProof = ({ proof, credentialCommitment, electionId }) => {
  try {
    if (!proof || proof.scheme !== SCHEME || proof.electionId !== electionId ||
        typeof electionId !== 'string' || !electionId) return false;

    const commitment = parseGroupElement(credentialCommitment);
    const nullifierPoint = parseGroupElement(proof.nullifierPoint);
    const announcementG = parseGroupElement(proof.announcementG);
    const announcementElection = parseGroupElement(proof.announcementElection);
    const response = parseScalar(proof.response);
    const electionBase = hashToGroup(electionId);

    if (proof.nullifier !== nullifierFor(electionId, nullifierPoint)) return false;
    const challenge = hashScalar(
      'votechain-chaum-pedersen-challenge-v1',
      [
        electionId,
        encode(commitment),
        encode(electionBase),
        encode(nullifierPoint),
        encode(announcementG),
        encode(announcementElection)
      ].join('\0')
    );

    return modPow(G, response, P) === (
      (announcementG * modPow(commitment, challenge, P)) % P
    ) && modPow(electionBase, response, P) === (
      (announcementElection * modPow(nullifierPoint, challenge, P)) % P
    );
  } catch {
    return false;
  }
};

module.exports = {
  SCHEME,
  createCommitment,
  createEligibilityProof,
  verifyEligibilityProof
};
